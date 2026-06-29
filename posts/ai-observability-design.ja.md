---
title: "AI時代のObservability設計 - アプリケーション / インフラ / CI / LLM すべてを監視する（設計編）"
publishedAt: "2026-07-07T08:30:00+09:00"
updatedAt: "2026-07-07T08:30:00+09:00"
slug: "ai-observability-design"
summary: "前回の code-graph 連載で『静的解析グラフをAIから引ける形にする話』 を書きましたが、 同じ発想は observability にも必要でした。 アプリケーション / インフラ / CI / LLM の4軸を、 それぞれ問いの性質に合わせて別の形に shape して載せる設計判断の話。 Gemini コストの client-side 計算、 Claude Code OTel の BQ 直行、 CI ログの post-hoc pull 方式という、 AI 時代特有の判断を中心に取り上げます。"
emoji: "📡"
tags:
  - "ai"
  - "observability"
  - "mcp"
  - "typescript"
lang: "ja"
series: "ai-observability"
seriesOrder: 1
draft: true
syndication:
  zenn:
    id: "d4c32cff8cb230"
    publishAt: "2026-07-07T08:30:00+09:00"
  devto:
    publishAt: "2026-07-07T08:30:00+09:00"
cover: /images/posts/ai-observability-design.ja.cover.png
---

みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

直前の連載 [code-graph deep dive 後編](/posts/code-graph-46-repos-part2) で、 「46リポジトリに跨るコードベースをAIにセマンティック検索できる形にした」 という話を書きました。 その最後に残した課題のひとつが **「動的解析の不在」** でした:

> graphに乗っているのは「edgeが静的に存在する」 という事実だけで、 「実際にそのedgeが本番でどれくらい使われているか」 は分かりません。

graph が「静的事実」 を渡してくれても、 **本番でいま何が起きているか**は別軸でAIに渡してあげる必要があります。 つまり、 静的解析と同じ発想を、 そのまま観測スタックにも持ち込まないといけない。

今回はその話を、 設計編 (本記事) と [実践編](/posts/ai-observability-practice) の2つに分けて書きます。 本記事は **4つの監視対象 (アプリケーション / インフラ / CI / LLM)** を、 それぞれの問いの性質に合わせて違う形に shape する設計判断の話。

## 「AIから引ける」 観測スタックとは

code-graph 連載で得た一番大きな教訓は、 「**AIに渡す前にデータを正しい形にしてあげる**」 必要がある、 ということでした。 46リポジトリ分のソースコードをそのまま投げても context window は足りないしハルシネーションも起きる。 だから静的解析でグラフ化して、 境界ノードに意味を載せて、 SAME_ENTITYで繋いで、 と shape してから渡す。

観測スタックも全く同じ構造の問題を持っています。 本番の生ログをそのまま AI に渡しても、

- ログの量で context が埋まる
- どこが error でどこが正常な log かAIには区別がつかない
- メトリクスとログとトレースが断絶している
- そもそも「いま何にいくらかかってるか」 の答えは生ログには載っていない

= **AIに渡せる形に shape する必要がある**、 という同じ問題。

ここで重要なのは「shape の仕方」 は **AIが何を答えるべきか**で変わる、 という点です。 cortex（社内AIプラットフォーム[^cortex]）では、 監視対象を4つに分けて、 それぞれ別の問いに対応した形で乗せています:

[^cortex]: 「cortex」 はairCloset社内で独自開発したAIプラットフォームの内部コードネームです。 Snowflake CortexやPalo Alto Networks Cortex等の既存商用サービスとは無関係です。

![4つの監視対象を、それぞれ問いの質に合わせて別の形でAIに渡す](/images/posts/ai-observability-design/four-axes-framework.png)

| 監視対象 | AIに答えさせたい問い | shape |
|---|---|---|
| アプリケーション | 「いま本番で何が起きてる？」 (探索) | log + trace |
| インフラ | 「リソースは足りてる？ 落ちてない？」 (時系列) | metric |
| CI | 「何が壊れた？ いつから壊れてる？」 (alert + 履歴探索) | log + alert |
| LLM | 「いくらかかってる？ 誰がどれだけ使った？」 (リアルタイム + 構造化集計) | metric + 構造化レコード |

「全部 OTel に乗せて全部 Loki に流せばいいじゃん」 という選択肢は確かにあります。 でもそうすると、 「リアルタイムの『今いくら』」 と「『先月の累計を team 別に集計』」 のような **質的に違う問い**を1つの backend で答えようとして、 どこかが苦しくなる。 ここを目的別に分けたのが cortex の選択です。

以下、 4つの軸を順に書きます。 アプリケーションとインフラは「土台」 として簡単に触れ、 CIとLLMは AI 時代特有の設計判断が出るので深掘りします。

## アプリケーション ── OTel + Loki + Tempo の標準スタック

土台はシンプルです。 cortex の各アプリケーションは [OpenTelemetry](https://opentelemetry.io/) で計装していて、 trace は Tempo、 log は Loki、 metric は Mimir に流す ── という Grafana Cloud の標準形。

ここは特別な工夫はしておらず、 重要なのは「**全アプリが同じ形でログとトレースを出す**」 という統一だけです。 これがあるから、 後でMCP経由で AI が `{app="<service>"} |~ "error"` のような LogQL を投げて横断的に調査できる。

具体的な計装方針は別記事 [AI Harness 連載Part 4 (Self-Healing)](/posts/cortex-self-healing) で触れたので、 本記事では深掘りしません。 「**標準的な OTel スタックがちゃんと敷かれているか**」 が、 この後の AI 駆動運用の前提になる、 とだけ書いておきます。

## インフラ ── Cloud Run / BigQuery / Pub/Sub の metric を Mimir に集約

cortex は GCP 上で動いていて、 Cloud Run / Cloud Run Job / BigQuery / Pub/Sub / Cloud Tasks 等を組み合わせて使っています。 各 GCP リソースの metric (CPU / memory / 実行回数 / レイテンシ / queue 滞留時間 等) は、 Cloud Monitoring 経由で Mimir に exporting しています。

ここも特別な工夫はしてなくて、 標準的な GCP metric を Grafana Cloud の Mimir に集約しているだけ。 ただ「全インフラ metric が1ヶ所に集約されている」 状態を作っておくと、 AI が「先週、 一番 CPU 使ってた service は？」 「queue が詰まってる worker ある？」 みたいな問いに自然に答えられるようになる ── これも後で MCP 経由で効きます。

ここまでが「土台」 です。 一般的な観測スタックの話なので、 詳しくは Grafana や OpenTelemetry の公式ドキュメントを当たってください。

ここから先 (CI と LLM) が **AI 時代特有の設計判断**が出る部分です。

## CI ── webhook push ではなく post-hoc pull で Loki に流す

cortex は GitHub Actions で CI を回していますが、 **CI のログをそのまま Grafana Loki に流して**います。

「Github Actions のログは GitHub UI で見られるじゃん」 という疑問は当然あって、 ただこれには明確な理由があります:

- GitHub Actions の API は AI から検索しづらい
- 別レポジトリの CI 結果も、 アプリログも、 全部1つの Loki に乗ってると **横断クエリ**できる
- LogQL alert で **失敗を構造化された判定にできる**
- AI が「先週から壊れてるテストある？」 みたいな問いを自然言語で投げられる

ただし shipping の仕方が普通と違います。 cortex の選択は:

> **CI 実行中にログを push するのではなく、 完了後に GitHub API から pull する**

![CI ログを webhook push でなく post-hoc pull で流す](/images/posts/ai-observability-design/ci-log-pull-vs-push.png)

具体的には:

1. Test ジョブが終わると `workflow_run` イベントが発火
2. ログ shipping 用の **別 workflow** がトリガーされる
3. その workflow が GitHub API (`/repos/.../actions/jobs/.../logs`) からログを取得
4. 構造化された JSON (job / status / ref / pr / commit / output 等) として OTLP `/v1/logs` で Grafana Cloud に送信

`{service_name="ci", ref="main", status="failure"}` でフィルタすると、 main ブランチでの CI 失敗だけが綺麗に拾える。

なぜ push 方式じゃなく pull 方式か:

- **CI 実行と observability を decouple できる**: もし shipping 側が失敗してもテスト本体は影響を受けない。 逆に shipping だけ retry / replay も可能
- **CI 内に Grafana API key を撒く必要がない**: shipping は別 workflow が一括で行う。 PR 由来の悪意あるコードが accidentally key を leak するリスクが下がる
- **shipping 失敗の検知が独立できる**: shipping 自体が CI と同じレイヤーなら、 shipping が壊れた時に観測スタックが沈黙する。 分離してるとそこにアラート貼れる

そして main ブランチで failure が出た瞬間に LogQL alert が発火し、 Slack に通知される ── これが実践編で扱う Self-Healing の起点になります。

## LLM ── Gemini と Claude Code、 2つの違う shape

最後の軸が LLM の利用観測です。 cortex は Gemini API と Claude Code (Anthropicの公式 CLI) を両方ヘビーに使っていて、 **どちらもコストが発生する**。 でも答えたい問いが微妙に違うので、 別の backend に乗せています。

### Gemini ── Prometheus で「いま、 何が高い」 を即時可視化

cortex は Gemini を db-graph のテーブル説明文生成、 code-graph のフィールド型推論、 各種コンテキスト生成 ── 至るところで叩いています。 ここで答えたいのは「**いま、 何が高い**」 を**遅延なしに**見ること。 暴走 prompt や暴走 batch が走った時に、 翌朝の billing まで待ちたくない。

そこで、 全 Gemini 呼び出しを共通の wrapper (`traceGeminiCall`) で包んで、 呼び出しごとに4本のメトリクスを emit する設計にしています:

- `gemini.tokens.total` ── 累積トークン (labels: `model` / `service` / `type=prompt|completion`)
- `gemini.requests.total` ── リクエスト数 (labels: `model` / `service` / `status`)
- `gemini.request.duration` ── レイテンシヒストグラム
- `gemini.cost.usd` ── 推定コスト (labels: `model` / `service`)

ここで設計判断が分かれるのが、 「**コストを誰が計算するか**」 です。 選択肢は2つ:

- **A. Google Cloud Billing API から後追いで取得する** ── 正確、 でも billing 反映まで数時間〜1日のラグ
- **B. 呼び出し直後にトークン数 × 単価表で client-side 計算する** ── 即時、 でも単価表のメンテが要る

採用したのはBです。 単価表は `GEMINI_PRICING` という定数で持っていて、 Google が値段を変えたら手動で bump する。 `gemini-1.5-flash` が $0.075 / $0.3 per 1M tokens, `gemini-1.5-pro` が $1.25 / $5.0 ── みたいな表。

なぜA を捨ててB を採ったか:

- 「**いま、 何が高い**」 が即時に見えないと、 暴走を1日待つことになる
- Google billing API の認証・取得・正規化・再分配のパイプライン自体がそれなりに重い
- 単価表のメンテ頻度が低い (Google も値段はそうそう変えない) ── 負債としては小さい

そして Prometheus の cumulative counter として `gemini_cost_usd_USD_total` に出すと、 Grafana の PromQL でそのまま `sum(increase(gemini_cost_usd_USD_total[1h]))` のような形で「直近1時間でいくら使った？」 が答えられる。 これを **$1/hour 超えたら info アラート** で Slack に飛ばすシンプル設計。

リアルタイムの「いま」 を答えるのは、 Prometheus がいちばん向いてる形です。

### Claude Code ── BQ に溜めて構造化集計に強くする

社内の開発者は全員 Claude Code を使っています。 これも当然コストが発生する。 **誰がどれだけ使ったか、 どのリポでどれだけトークン消費したか**を把握したい。

ここで設計が分かれた質問: 「Claude Code の利用ログも Loki に流すべきか？」

答え: **NO、 BQに溜める**。

なぜか。 Claude Code 利用ログは本質的に **構造化された帳簿** だからです:

- `email` ── 利用者
- `repository` ── どのリポでの利用か
- `timestamp` ── いつ
- `input_tokens` / `output_tokens`
- `cache_creation_input_tokens` / `cache_read_input_tokens` ── prompt-cache の効きを含む

これを引きたい問いはこんな形:
- 「先週、 チームA のメンバーが累計でいくら使った？」
- 「リポX の編集に1ヶ月でいくらかかってる？」
- 「prompt-cache の hit ratio はチーム間でどれくらい差がある？」

全部 **SQL 集計向きの問い** です。 Loki の LogQL では aggregation も join も辛い。 一方 BigQuery なら DAY パーティション + email を主キーに普通に書ける。

そこで Claude Code → BQ パイプラインを4段階で組んでいます:

1. **Emit** ── Claude Code 側に組み込んだ analyzer が `UsageInput` (email無しの token情報のみ) を社内エンドポイントに POST
2. **Auth proxy** ── Cloudflare Edge Router worker が `CORTEX_API_KEY` を検証して、 そこで初めて利用者 email を `X-Cortex-User-Email` として付与
3. **Ingest** ── Cloud Run 受信API が dedup して Pub/Sub に publish
4. **Persist** ── Cloud Run worker が Pub/Sub から pull、 schema 検証、 BQ に streaming insert

設計的に効いているポイントを2つ:

- **identity authority を Edge Router に集約**: 利用者識別は Edge Router でしかやらない。 emit 側 (Claude Code) は email を持たない。 これでクライアント側の id 詐称や、 social engineering 系の経路を構造的に閉じる
- **Pub/Sub で async 分離**: ingest と worker を分けて、 worker 側で詰まっても ingest の応答時間に影響しない。 失敗時は Pub/Sub DLQ で最大5回 retry

そして BQ に溜まったものは、 実践編で扱う社内ポータルから「誰がどれだけ」 を毎日見られる状態にしています。 実物がこれです:

![Claude Code 利用量ダッシュボード — 過去30日で 77.1B トークン、 cache読込が 96% を占める](/images/posts/ai-observability-design/cc-usage-dashboard.png)

数字が興味深いので軽く触れておくと、 過去30日で **77.1B トークン / 380K メッセージ / 47 ユーザー / 79 リポジトリ**。 そして注目すべきは **Cache 読込 Input が 74.3B (全体の 96%)** という点です。 これは prompt-cache が劇的に効いていることを示していて、 実コスト換算では cache 効きのないケースに比べて数十倍の差が出ます。 「集計の質的な性質に合わせた backend」 という設計判断のおかげで、 こういう実運用上の重要な指標が**自然に SQL で引けて毎日見える**状態になっています。 LogQL で同じことをやろうとしたら大変です。

ちなみに **MCP の利用ログ**も似た形で BQ に溜めています (`cortex.mcp_tool_calls`)。 こちらは OTel ですらなく、 各 MCP サーバーが直接 BQ にレコードを書き込む構造。 前回の連載で「annotation graph の MCP が約50,000回 / 約73人に使われている」 と数字を出したのは、 全部このテーブルから取っています。

「全部 OTel」 教義に寄せきらず、 **集計の質的な性質に応じて道具を分けている**のがこの層の核心です。

## つづく

ここまでで4つの監視対象 (アプリケーション / インフラ / CI / LLM) と、 それぞれの設計判断を書きました。 観測スタックの **書き込み側** の話としては一旦完結します。

ただ、 「shape を作っただけ」 では話は終わらない。 観測スタックには本番データが流れる以上、 **PIIとAIの検索性をどう両立させるか**という問題が必ず出ます。 そして全部繋がると、 **自動修復 (Self-Healing) の本当の駆動源** が観測スタック側から見えてくる ── というのが実践編の話です。

長文をお読みいただきありがとうございました。

[実践編「AI時代のObservability設計 - PIIとAIの検索性を両立させ、自動修復する」 →](/posts/ai-observability-practice)
