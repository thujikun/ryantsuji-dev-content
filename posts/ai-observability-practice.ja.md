---
title: "AI時代のObservability設計 - PIIとAIの検索性を両立させ、自動修復する（実践編）"
publishedAt: "2026-07-14T08:30:00+09:00"
updatedAt: "2026-07-14T08:30:00+09:00"
slug: "ai-observability-practice"
summary: "前編で4つの監視対象 (アプリ / インフラ / CI / LLM) をそれぞれ別の形に shape する設計判断を書きました。 実践編では、 そこに**本番データ (PII込み)** が流れることを前提に、 ハッシュ化を書き込み側と検索側の両端で同じロジックで通す多層 PII 設計、 同じ shape を「人間 = Web ダッシュボード / AI = MCP」 の二重消費者から引かせる統合面設計、 そして CI 失敗を起点に PR まで自動修復する Self-Healing 駆動の話を扱います。"
emoji: "🛡️"
tags:
  - "ai"
  - "observability"
  - "mcp"
  - "typescript"
lang: "ja"
series: "ai-observability"
seriesOrder: 2
draft: true
syndication:
  zenn:
    publishAt: "2026-07-14T08:30:00+09:00"
  devto:
    publishAt: "2026-07-14T08:30:00+09:00"
cover: /images/posts/ai-observability-practice.ja.cover.png
---

みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

[設計編](/posts/ai-observability-design)では、 アプリケーション / インフラ / CI / LLM の4軸を、 それぞれの問いの性質に合わせて別の形に shape する話を書きました。 観測スタックの**書き込み側**の話としては一旦完結する内容です。

ただし、 「shape を作っただけ」 で話は終わりません。 観測スタックには**本番データが流れる**以上、 ここに PII が混入する経路を断たないといけない。 そしてその上で **AI が観測スタックを引ける状態**を保たないと、 「AI に渡せる observability」 という前編の目標が成立しません。

実践編ではこの2つの両立 ── **PII を守りつつ、 AI から検索できる**── をどう実現したか、 そしてその結果として **CI 失敗から PR 提案までを自動でつなぐ Self-Healing** がどう成立したかを書きます。

## 観測スタックは PII の通り道になりやすい

アプリケーションがログを出す → Loki に流れる → AI が MCP 経由で引く ── という素直な流れを引いただけだと、 そこに何が混入するかというと:

- お客様の email や電話番号がエラーログに含まれる
- 注文情報のレスポンスが trace の payload に乗る
- DB クエリログにテーブル全行が出る

平文 PII が観測スタックに溜まると、 そのまま AI から検索可能になります。 これは AI の能力以前の話で、 **観測スタックが PII の通り道になっている**こと自体がリスク。 そして同時に、 PII を完全に消してしまうと **「お客様A の問い合わせを調査したい」 という当然のサポート業務ができなくなる**。

cortex（社内AIプラットフォーム[^cortex]）では、 この対立をどう解いたか。 大事なのは **「PII の通り道を断つ」 と「PII で検索できる」 を二者択一にしない**設計です。

[^cortex]: 「cortex」 はairCloset社内で独自開発したAIプラットフォームの内部コードネームです。 Snowflake CortexやPalo Alto Networks Cortex等の既存商用サービスとは無関係です。

## 多層 PII 設計 ── 6つの層で守る

cortex の PII 対応は、 役割の違う 6 つの層が組み合わさっています:

| 層 | 目的 | 仕組み |
|---|---|---|
| **書き込み: BQ Policy Tag** | 列レベルの access control | `pii_high` / `pii_medium` / `pii_low` の 3 層 taxonomy。 fine-grained reader を持たない権限から SELECT すると NULL が返る |
| **書き込み: ETL DLP** | 平文 PII を派生テーブルに残さない | Cloud DLP でカスタマーサポートデータ等を変換時に redact。 `[EMAIL_ADDRESS]` / `[PHONE_NUMBER]` の placeholder で **構造**は残す |
| **書き込み: ログハッシュ化** | Loki に平文を残さない | アプリケーション側で `hashEmail` (SHA256 deterministic、 12-char prefix) を通してから log 出力 |
| **検索: 同関数で照合** | 平文を介さず特定顧客のログ抽出 | クエリ側も同じ `hashEmail` を通してから Loki に投げる |
| **出力: MCP マスキング** | AI に渡る時点で隠す | カラム名検出で `***@***.com` などの placeholder に置換 |
| **Identity 分離** | 社員 email は PII 扱いしない | Edge Router で HMAC 署名された認証 email として attribution に使う |

このうち**4 つ目の「検索: 同関数で照合」** が、 セキュリティと使いやすさの両立で一番美味しいパターンです。

## ハッシュ化を「書き込み」 と「検索」 の両端で通す

普通に「ログから PII を消す」 と、 後で「お客様 A のログを探したい」 ができなくなります。 でも、 **書き込み時にハッシュ化した値をログに残しておけば、 検索クエリ側でも同じハッシュ関数を通すことで該当ログをヒットさせられる**。 平文の email は両端のどこにも流れない。

![ハッシュ化を書き込みと検索の両端で通すことで、平文PIIを観測スタックに入れずに検索できる](/images/posts/ai-observability-practice/pii-round-trip.png)

具体的にはこういう流れになります。

**書き込み側:**

```ts
// アプリケーションコード
logger.info("Subscription updated", {
  user: hashEmail(user.email), // → '7a3f9c2e0b1d' (SHA256 12-char prefix)
  plan: "monthly",
});
// → Loki には hashEmail の結果しか残らない
```

**検索側 (カスタマーサポートから「お客様 A の最近のログを見たい」):**

```ts
// 内部 MCP / 検索ツール側
const hash = hashEmail("customer.a@example.com");
// → '7a3f9c2e0b1d'
const logs = await loki.query(`{app="subscription"} |~ "${hash}"`);
// → 該当の hash が含まれるログを返す
```

両端で **同じ `hashEmail` 関数を通す**ので、 同じ顧客から出たログは同じ hash でヒットする。 一方で:

- Loki に**平文の email は一度も入らない**
- 検索クエリの中にも**平文 email は履歴に残らない**(ハッシュ化後の値だけが残る)
- ログ漏洩しても**逆引きが構造的に難しい** (SHA256 単方向、 ただし内部だけで使う前提なので salt は最小限)

これは deterministic hashing を「**両端で同じロジックを通せば検索成立する**」 という性質に再利用した形です。 セキュリティとデバッグ利便性のトレードオフをぐっと圧縮できる。

そして当然ですが、 この仕組みは「アプリログ層」 だけの話で、 BQ 側はまた別の Policy Tag による列レベル access control で守られている (上の表の1〜2行目)、 という多層構造になっています。

## 統合面 ── 「人間 = Web、 AI = MCP」 で同じ裏側を共有する

3つの shape を作って、 PII もちゃんと守る形にした。 次の問題は、 **誰がどう引くか**。 ここでよくある罠は、 「人間向けのダッシュボード集計」 と「AI 向けのデータ提供」 を別々に作ってしまうことです。 そうすると:

- 同じ問いに対して 2 つの集計実装を抱える
- 数字が微妙にずれ始める
- どっちが正なのか分からなくなる
- AI 用の集計の更新と人間用の集計の更新が非同期になる

cortex はここを **「同じ shape を共有して、 消費者向けインターフェースだけ分ける」** という設計にしています。

![同じ shape (Prometheus / BQ / Loki) を、人間は Web ダッシュボードから、AI は MCP から引く](/images/posts/ai-observability-practice/integrated-surface.png)

### 人間側: AI運用ポータル

社内向けに **AI運用ポータル** (内部呼称: PI Lab) があり、 ここに観測対象別のダッシュボードが集約されています:

- **Claude Code 利用量** (設計編で見せた cc-usage 画面)
- **MCP ツール利用量** (server別 / tool別 / user別 / team別)
- **インフラコスト** (Gemini / GCP / AWS / GitHub を1画面で)
- アラート状況、 デプロイ履歴、 等々

例えば MCP 利用ダッシュボードは実物だとこんな感じです:

![MCP ツール利用量ダッシュボード — server別 / tool別 の呼び出し回数 + 平均実行時間](/images/posts/ai-observability-practice/mcp-usage-dashboard.png)

過去30日で `service-product-graph` が 37,458 calls (うちエラー 7,024)、 `gws` が 19,339 calls、 `db-graph` が 17,037 calls ── という形で、 **どの MCP がどれだけ使われているか、 どこで失敗が出てるか**が毎日眺められる状態になっています。 前回の連載 ([code-graph deep dive 後編](/posts/code-graph-46-repos-part2)) で「annotation graph の MCP が 約50,000 calls / 73 users に使われている」 と書いた数字も、 ここから引いています。

これらの React 側のページは、 内部 API 経由で BQ / Prometheus / Loki を引いて表示する構造。 集計ロジックは API 側に集約されています。

### AI 側: MCP

同じデータソースを AI エージェントが叩く時は、 用途別の MCP を経由します:

- **Grafana MCP** ── Loki / Mimir / Prometheus / Tempo に自然言語クエリで投げる。 「先週、 サービス X で error が一番多かった時間帯は？」 のような問いをそのまま投げられる
- **BQ MCP** (cortex-product-graph 経由) ── `claude_usage.claude_usage` / `cortex.mcp_tool_calls` を SQL で引く

ここの設計のミソは、 **人間ダッシュボードと AI MCP が同じ backend を共有している**点です。 「AI 用の集計テーブル」 と「人間用の集計テーブル」 を分けない。 shape は1つだけ作って、 そこに対する **消費者ごとのインターフェース層** (Web ダッシュボード / MCP) を別に提供する、 という形。

これがあるからこそ、 「観測スタックが AI から見えている」 が成立しています。 shape だけあっても AI が引けなければ意味がない、 という意味では **MCP こそが「AI に渡す」 を本当に成立させる最後のピース**です。

## Self-Healing の本当の駆動源

ここまで設計した観測スタックを「単なる見るための画面」 で終わらせない層が Self-Healing です。 これは [AI Harness 連載Part 4](/posts/cortex-self-healing) で全体は書いたので詳細は省きますが、 観測スタック側から見ると、 起点と末端は明確です。

![CI 失敗 / 本番アラートから自動的に修正 PR が起票されるまでの連鎖](/images/posts/ai-observability-practice/self-healing-chain.png)

具体的な流れ:

1. **検知**: 本番アラート / CI 失敗が Loki LogQL alert で発火
2. **配送**: event-relay (社内 webhook ハブ) に POST
3. **起動**: auto-review bot (= Claude Code を背負ったエージェント) が起動
4. **コンテキスト収集**: bot が **Grafana MCP** で full log を取得、 **Product Graph MCP** で関連 PR / commit / コードを辿る
5. **修正提案**: 修正 PR を起票
6. **検証**: CI が通れば bot 自身が auto-merge、 通らなければ別の bot が更にレビュー

つまり Self-Healing の起点は **観測スタックが「何が壊れたか」 を正しい形で渡せる状態**にあるかどうか、 です。 もし

- error として認識されない壊れ方がある → AI は気付けない
- ログはあるが stacktrace が落ちている → AI は原因に辿り着けない
- 関連 PR / commit / コードが graph に乗っていない → AI は文脈を持てない

のどれかが欠けていたら、 Self-Healing は止まります。 別の言い方をすると、

> **観測の質が AI 自律運用の天井になる**

これが実践編で一番伝えたい主張です。 観測スタックは「監視するための仕組み」 ではなく、 「**AI を動かすための入力**」 だと位置づけ直すと、 設計判断の順位が変わります。

## 残課題 ── 「何を error として扱うか」 と stacktrace 設計こそ命

最後に、 ここまで作っても残っている一番大きな課題を素直に書きます。

観測スタックの shape をいくら作り込んでも、 **そもそも何を error として扱うか、 そのとき stacktrace が残っているか**の設計が崩れていると全部無駄になります。 これは [AI Harness 連載Part 2](/posts/cortex-product-graph) でも cortex 内部のナレッジグラフの文脈で触れた話ですが、 同じ問題が観測スタック側でも本筋にいます。

具体的にどう崩れるか:

- `try ~ catch` で握り潰してログすら出ない → 観測スタックに何も残らない
- catch ではログしているが、 `console.log` 相当の info レベルで出していて、 error と認識されない
- error として出しているが、 `error.message` だけ書いて stacktrace を出していない → 原因コードに辿り着けない
- そもそも非同期エラーが unhandled で落ちている

これらは **すべて、 観測スタックの問題ではなく、 観測の入口を作るコード側の問題**です。 観測スタックがどれだけ完成度高くても、 入口の蛇口が崩れていればそこから何も流れてこない。

現状の対策は最低限の lint だけです:

- `try ~ catch` の catch ブロック内で stacktrace ログ出力がない場合に lint error にする ── 入っている
- でもこれは catch 内だけが対象で、 「そもそも catch するべきところを catch していない」 や、 「`Promise.reject` を握り潰している」 のような落ち方は拾えない

そして本物のギャップは、 **新規コードが書かれる時点で「ここは error として扱う / stacktrace 残す」 を AI が自動で設定するハーネスが組めていない**こと。 cortex 内では Auto Review がコードレビュー時に拾ってはくれますが、 「観測の入口」 の設計を AI が能動的に提案・補完する仕掛けまでは整っていません。

「観測スタックは整った、 だが**観測対象の設計自体は人間が頑張っている**」 ── ここが現状の正直な絵です。 ここをハーネス化するのが次のステップになります。

## 閉じ ── 静的編 + 動的編 が揃って "事実として渡す" が完成

[code-graph 連載](/posts/code-graph-46-repos) で書いた「静的解析グラフを AI から引ける形にする」 が、 **コードの構造を事実として渡す**話だったとすると、 今回の前後編は **本番でいま起きていることを事実として渡す**話でした。

両者が揃って、 ようやく cortex が標榜する 「**AI には推論させない、 事実として渡す**」 という設計思想が完成形になります。

| | shape | 何を渡すか |
|---|---|---|
| 静的編 (code-graph + db-graph + annotation graph) | 3グラフ並列接続 + SAME_ENTITY | コードと意味 |
| 動的編 (前編 + 本記事) | Prometheus / BQ / Loki + MCP | 本番の挙動とコスト |

そしてこの静的編・動的編の上に Self-Healing が乗って初めて、 「AI が自律的に運用する」 が成立する、 という構造になっています。

最後に、 観測スタックそのものより**観測対象 (＝何を error として扱うか、 stacktrace 残すか) の設計こそ命**、 という話。 ハーネス化の次の宿題は ここ になります。

長文をお読みいただきありがとうございました。
