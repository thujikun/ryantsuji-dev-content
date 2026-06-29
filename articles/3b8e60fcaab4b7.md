---
title: "AI時代のObservability設計 - PIIとAIの検索性を両立させ、自動修復する（実践編）"
emoji: "🛡️"
type: tech
topics: ["ai", "mcp", "observability", "typescript"]
published: false
publication_name: "aircloset"
---

みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

[設計編](https://zenn.dev/aircloset/articles/d4c32cff8cb230)では、アプリケーション / インフラ / CI / LLMの4軸を、それぞれの問いの性質に合わせて別々の形でObservableにする話を書きました。観測スタックの**書き込み側**の話としては一旦完結する内容です。

ただし、「Observableにしただけ」で話は終わりません。観測スタックには**本番データが流れる**以上、ここにPIIが混入する経路を断たないといけない。そしてその上で**AIが観測スタックを引ける状態**を保たないと、「AIに渡せるobservability」という前編の目標が成立しません。

実践編ではこの2つの両立 ── **PIIを守りつつ、AIから検索できる**── をどう実現したか、そしてその結果として**CI失敗からPR提案までを自動でつなぐSelf-Healing**がどう成立したかを書きます。

## 観測スタックはPIIの通り道になりやすい

アプリケーションがログを出す → Lokiに流れる → AIがMCP経由で引く ── という素直な流れを引いただけだと、そこに何が混入するかというと:

- お客様のemailや電話番号がエラーログに含まれる
- 注文情報のレスポンスがtraceのpayloadに乗る
- DBクエリログにテーブル全行が出る

平文PIIが観測スタックに溜まると、そのままAIから検索可能になります。これはAIの能力以前の話で、**観測スタックがPIIの通り道になっている**こと自体がリスク。そして同時に、PIIを完全に消してしまうと**「お客様Aの問い合わせを調査したい」という当然のサポート業務ができなくなる**。

cortex（社内AIプラットフォーム[^cortex]）では、この対立をどう解いたか。大事なのは**「PIIの通り道を断つ」と「PIIで検索できる」を二者択一にしない**設計です。

[^cortex]:「cortex」はairCloset社内で独自開発したAIプラットフォームの内部コードネームです。Snowflake CortexやPalo Alto Networks Cortex等の既存商用サービスとは無関係です。

## 多層PII設計 ── 6つの層で守る

cortexのPII対応は、役割の違う6つの層が組み合わさっています:

| 層 | 目的 | 仕組み |
|---|---|---|
| **書き込み: BQ Policy Tag** | 列レベルのaccess control | `pii_high` / `pii_medium` / `pii_low` の3層taxonomy。fine-grained readerを持たない権限からSELECTするとNULLが返る |
| **書き込み: ETL DLP** | 平文PIIを派生テーブルに残さない | Cloud DLPでカスタマーサポートデータ等を変換時にredact。 `[EMAIL_ADDRESS]` / `[PHONE_NUMBER]` のplaceholderで**構造**は残す |
| **書き込み:ログハッシュ化** | Lokiに平文を残さない | アプリケーション側で `hashEmail` (SHA256 deterministic、12-char prefix)を通してからlog出力 |
| **検索:同関数で照合** | 平文を介さず特定顧客のログ抽出 | クエリ側も同じ `hashEmail` を通してからLokiに投げる |
| **出力: MCPマスキング** | AIに渡る時点で隠す | カラム名検出で `***@***.com` などのplaceholderに置換 |
| **Identity分離** | 社員emailはPII扱いしない | Edge RouterでHMAC署名された認証emailとしてattributionに使う |

このうち**4つ目の「検索:同関数で照合」**が、セキュリティと使いやすさの両立で一番美味しいパターンです。

## ハッシュ化を「書き込み」と「検索」の両端で通す

普通に「ログからPIIを消す」と、後で「お客様Aのログを探したい」ができなくなります。でも、**書き込み時にハッシュ化した値をログに残しておけば、検索クエリ側でも同じハッシュ関数を通すことで該当ログをヒットさせられる**。平文のemailは両端のどこにも流れない。

![ハッシュ化を書き込みと検索の両端で通すことで、平文PIIを観測スタックに入れずに検索できる](https://ryantsuji.dev/images/posts/ai-observability-practice/pii-round-trip.png?v=5c70aa5e)

具体的にはこういう流れになります。

**書き込み側:**

```ts
// アプリケーションコード
logger.info("Subscription updated", {
  user: hashEmail(user.email), // → '7a3f9c2e0b1d' (SHA256 12-char prefix)
  plan: "monthly",
});
// → LokiにはhashEmailの結果しか残らない
```

**検索側(カスタマーサポートから「お客様Aの最近のログを見たい」):**

```ts
// 内部MCP / 検索ツール側
const hash = hashEmail("customer.a@example.com");
// → '7a3f9c2e0b1d'
const logs = await loki.query(`{app="subscription"} |~ "${hash}"`);
// → 該当のhashが含まれるログを返す
```

両端で**同じ `hashEmail` 関数を通す**ので、同じ顧客から出たログは同じhashでヒットする。一方で:

- Lokiに**平文のemailは一度も入らない**
- 検索クエリの中にも**平文emailは履歴に残らない**(ハッシュ化後の値だけが残る)
- ログ漏洩しても**逆引きが構造的に難しい** (SHA256単方向、ただし内部だけで使う前提なのでsaltは最小限)

これはdeterministic hashingを「**両端で同じロジックを通せば検索成立する**」という性質に再利用した形です。セキュリティとデバッグ利便性のトレードオフをぐっと圧縮できる。

そして当然ですが、この仕組みは「アプリログ層」だけの話で、BQ側はまた別のPolicy Tagによる列レベルaccess controlで守られている(上の表の1〜2行目)、という多層構造になっています。

## 統合面 ── 「人間 = Web、AI = MCP」で同じ裏側を共有する

3つの形でObservableにして、PIIもちゃんと守る形にした。次の問題は、**誰がどう引くか**。ここでよくある罠は、「人間向けのダッシュボード集計」と「AI向けのデータ提供」を別々に作ってしまうことです。そうすると:

- 同じ問いに対して2つの集計実装を抱える
- 数字が微妙にずれ始める
- どっちが正なのか分からなくなる
- AI用の集計の更新と人間用の集計の更新が非同期になる

cortexはここを**「同じObservable基盤を共有して、消費者向けインターフェースだけ分ける」**という設計にしています。

![同じObservable基盤(Prometheus / BQ / Loki)を、人間はWebダッシュボードから、AIはMCPから引く](https://ryantsuji.dev/images/posts/ai-observability-practice/integrated-surface.png?v=ddd7379d)

### 人間側: AI運用ポータル

社内向けに**AI運用ポータル** (内部呼称: PI Lab)があり、ここに観測対象別のダッシュボードが集約されています:

- **Claude Code利用量** (設計編で見せたcc-usage画面)
- **MCPツール利用量** (server別 / tool別 / user別 / team別)
- **インフラコスト** (Gemini / GCP / AWS / GitHubを1画面で)
- アラート状況、デプロイ履歴、等々

例えばMCP利用ダッシュボードは実物だとこんな感じです:

![MCPツール利用量ダッシュボード — server別 / tool別の呼び出し回数 + 平均実行時間](https://ryantsuji.dev/images/posts/ai-observability-practice/mcp-usage-dashboard.png?v=01a508ce)

過去30日で `service-product-graph` が37,458 calls (うちエラー7,024)、 `gws` が19,339 calls、 `db-graph` が17,037 calls ── という形で、**どのMCPがどれだけ使われているか、どこで失敗が出てるか**が毎日眺められる状態になっています。前回の連載([code-graph deep dive後編](https://zenn.dev/aircloset/articles/9b63579545582d))で「annotation graphのMCPが約50,000 calls / 73 usersに使われている」と書いた数字も、ここから引いています。

これらのReact側のページは、内部API経由でBQ / Prometheus / Lokiを引いて表示する構造。集計ロジックはAPI側に集約されています。

### AI側: MCP

同じデータソースをAIエージェントが叩く時は、用途別のMCPを経由します:

- **Grafana MCP** ── Loki / Mimir / Prometheus / Tempoに自然言語クエリで投げる。「先週、サービスXでerrorが一番多かった時間帯は？」のような問いをそのまま投げられる
- **BQ MCP** (cortex-product-graph経由) ── `claude_usage.claude_usage` / `cortex.mcp_tool_calls` をSQLで引く

ここの設計のミソは、**人間ダッシュボードとAI MCPが同じbackendを共有している**点です。「AI用の集計テーブル」と「人間用の集計テーブル」を分けない。Observable基盤は1つだけ作って、そこに対する**消費者ごとのインターフェース層** (Webダッシュボード / MCP)を別に提供する、という形。

これがあるからこそ、「観測スタックがAIから見えている」が成立しています。Observable基盤だけあってもAIが引けなければ意味がなく、**MCPこそが「AIに渡す」を本当に成立させる最後のピース**です。

## Self-Healingの本当の駆動源

ここまで設計した観測スタックを「単なる見るための画面」で終わらせない層がSelf-Healingです。これは[AI Harness連載Part 4](https://zenn.dev/aircloset/articles/74c7dfab13cea2)で全体は書いたので詳細は省きますが、観測スタック側から見ると、起点と末端は明確です。

![CI失敗 / 本番アラートから自動的に修正PRが起票されるまでの連鎖](https://ryantsuji.dev/images/posts/ai-observability-practice/self-healing-chain.png?v=6ce90363)

具体的な流れ:

1. **検知**:本番アラート / CI失敗がLoki LogQL alertで発火
2. **配送**: event-relay (社内webhookハブ)にPOST
3. **起動**: auto-review bot (= Claude Codeを背負ったエージェント)が起動
4. **コンテキスト収集**: botが**Grafana MCP**でfull logを取得、**Product Graph MCP**で関連PR / commit / コードを辿る
5. **修正提案**:修正PRを起票
6. **検証**: CIが通ればbot自身がauto-merge、通らなければ別のbotが更にレビュー

つまりSelf-Healingの起点は**観測スタックが「何が壊れたか」を正しい形で渡せる状態**にあるかどうか、です。もし

- errorとして認識されない壊れ方がある → AIは気付けない
- ログはあるがstacktraceが落ちている → AIは原因に辿り着けない
- 関連PR / commit / コードがgraphに乗っていない → AIは文脈を持てない

のどれかが欠けていたら、Self-Healingは止まります。別の言い方をすると、

> **観測の質がAI自律運用の天井になる**

これが実践編で一番伝えたい主張です。観測スタックは「監視するための仕組み」ではなく、「**AIを動かすための入力**」だと位置づけ直すと、設計判断の順位が変わります。

## 残課題 ── 「何をerrorとして扱うか」とstacktrace設計こそ命

最後に、ここまで作っても残っている一番大きな課題を素直に書きます。

観測スタックをいくらObservableにしても、**そもそも何をerrorとして扱うか、そのときstacktraceが残っているか**の設計が崩れていると全部無駄になります。これは[AI Harness連載Part 2](https://zenn.dev/aircloset/articles/f6c990989e60d4)でもcortex内部のナレッジグラフの文脈で触れた話ですが、同じ問題が観測スタック側でも本筋にいます。

具体的にどう崩れるか:

- `try ~ catch` で握り潰してログすら出ない → 観測スタックに何も残らない
- catchではログしているが、 `console.log` 相当のinfoレベルで出していて、errorと認識されない
- errorとして出しているが、 `error.message` だけ書いてstacktraceを出していない → 原因コードに辿り着けない
- そもそも非同期エラーがunhandledで落ちている

これらは**すべて、観測スタックの問題ではなく、観測の入口を作るコード側の問題**です。観測スタックがどれだけ完成度高くても、入口の蛇口が崩れていればそこから何も流れてこない。

現状の対策は最低限のlintだけです:

- `try ~ catch` のcatchブロック内でstacktraceログ出力がない場合にlint errorにする ── 入っている
- でもこれはcatch内だけが対象で、「そもそもcatchするべきところをcatchしていない」や、「`Promise.reject` を握り潰している」のような落ち方は拾えない

そして本物のギャップは、**新規コードが書かれる時点で「ここはerrorとして扱う / stacktrace残す」をAIが自動で設定するハーネスが組めていない**こと。cortex内ではAuto Reviewがコードレビュー時に拾ってはくれますが、「観測の入口」の設計をAIが能動的に提案・補完する仕掛けまでは整っていません。

「観測スタックは整った、だが**観測対象の設計自体は人間が頑張っている**」 ── ここが現状の正直な絵です。ここをハーネス化するのが次のステップになります。

## 閉じ ── 静的編 + 動的編が揃って"事実として渡す"が完成

[code-graph連載](https://zenn.dev/aircloset/articles/a7cf65cc035572)で書いた「静的解析グラフをAIから引ける形にする」が、**コードの構造を事実として渡す**話だったとすると、今回の前後編は**本番でいま起きていることを事実として渡す**話でした。

両者が揃って、ようやくcortexが標榜する「**AIには推論させない、事実として渡す**」という設計思想が完成形になります。

| | 形 | 何を渡すか |
|---|---|---|
| 静的編(code-graph + db-graph + annotation graph) | 3グラフ並列接続 + SAME_ENTITY | コードと意味 |
| 動的編(前編 + 本記事) | Prometheus / BQ / Loki + MCP | 本番の挙動とコスト |

そしてこの静的編・動的編の上にSelf-Healingが乗って初めて、「AIが自律的に運用する」が成立する、という構造になっています。

最後に、観測スタックそのものより**観測対象(＝何をerrorとして扱うか、stacktrace残すか)の設計こそ命**、という話。ハーネス化の次の宿題はここになります。

長文をお読みいただきありがとうございました。

---

私がCTOをしている株式会社エアークローゼットでは、AIと共に新しい開発体験を作り上げていくエンジニアを募集しています。興味のある方は、ぜひエンジニア採用サイト[エアクロクエスト](https://corp.air-closet.com/recruiting/developers/)をご覧ください！
