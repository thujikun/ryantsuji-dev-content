---
title: "気づく前に直り、二度と起きなくなる ── 障害の自動修復と再発防止（連載Part 4）"
publishedAt: "2026-06-02T08:30:00+09:00"
updatedAt: "2026-06-02T08:30:00+09:00"
draft: true
slug: "cortex-self-healing"
summary: "社内AI基盤cortexの連載Part 4。本番アラートをAIが調査・修正・デプロイまで完結させるSelf-Healingと、その手前のOTel/Loki/Mimir/Tempo/Faro観測スタック、そして修正と同時に再発防止のlint/型ゲートが自動で増えていく仕組み。直近30日で115本のauto-fix PRがマージされ、同種障害が構造的に再発できなくなっていく流れを実装目線で。"
tags:
  - "ai"
  - "typescript"
  - "observability"
  - "github"
  - "devops"
lang: "ja"
series: "building-ai-harness"
seriesOrder: 4
syndication:
  zenn:
    id: ""
    publishAt: "2026-06-02T08:30:00+09:00"
---


みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

:::message
**注記**: 本記事で言及する「cortex」は、airCloset社内で独自開発したAIプラットフォームの内部コードネームです。Snowflake CortexやPalo Alto Networks Cortex等の既存商用サービスとは一切関係ありません。
:::

[Part 3](/posts/cortex-auto-review)では「AIが書いたコードはAIが見る」── 自動レビューパイプラインで **PR時点の品質**を守る話を書きました。

今回は**本番時点の品質を守る**側、**Self-Healing**（自己修復）です。本番アラートをAIが調査して修正PRを起票、自動レビューに乗せて自動マージ、自動再デプロイまで完結させる仕組み。そしてその修正PRには**再発防止のlint/型ゲートの追加が必須化**されていて、結果として**ガードレールが日々自動で増えていく**。

「障害が自動で直る」だけだと派手で目を引きますが、たぶんそれだけでは中長期では負ける。**直したついでに同じ罠の再発を構造的に潰す** ──「self-healing」+「self-strengthening」の2つが組み合わさって初めて、品質ゲートは時間とともに育っていきます。

## いきなり1ヶ月分の数字から

**直近30日でマージされた`auto-fix`系PR: 115本。**

**ほぼ全て人の介入なしでmerge + deploy完了。**

**人の対応は「AIが手を出せないと判断したケースだけ」。**

これがcortexの「障害対応」の現状です。

ここで「115件＝ユーザー影響のある障害」とは読まないでください。内訳はざっくり:

- **約半数（54本）がDeploy Failed系** ── CI/Pulumiデプロイ段階で失敗を検知し、本番に出る前にAIが消化したもの。**ここは最近`[Recurrence]`ループ（後述）で対策が積み上がってきていて、減少傾向**
- **残り61本がservice-levelの本番エラーログ閾値超え** ── Service Error Log Detected等、ユーザー影響に至る前の段階で発火する閾値型アラートを、AIが先に消化したもの

つまり「障害対応」というよりは「**監視で拾った本番異常を、人が起きる前にAIが115回直した**」が正確。実際に**人が認知するインシデントは月数件**レベルに絞られます。

加えて、同じサービス（例: `gcs-transformer`が61件中25件）で繰り返し発火しているケースが目立ちます ── これがまさに後段で書く`[Recurrence]`ループで**lint/型ゲート化して構造的に潰していく対象**になる、というのが本記事後半の話です。

もう一つ正直なところを書いておくと、**直近1ヶ月の数字はやや上振れ**しています。元々コードベース内に「エラーを`catch`で握り潰して何も通知しない」サイレントcatchが多く存在していて、`no-silent-catch`のlintルールを追加して**既存のsilent catchを順次潰した**結果、それまで隠れていた本番障害がアラートとして表に出てきた、という側面があります。「監視が見える化された」分のスパイクなので、`[Recurrence]`ループで対応+lint化が進めば数字は収束していく見込みです。**「見えていなかったものが見えるようになった」のは品質的にむしろ前進**で、いま起きているのはそのcatch-upフェーズです。

アラートが発火した瞬間にAIが調査を開始、Loki / Product Graph / git blameを辿って根本原因を特定し、修正PRを起票して[Part 3](/posts/cortex-auto-review)の自動レビューに乗せ、APPROVE → 自動マージ → 自動再デプロイで一周まわります。

## 連載一覧

| # | テーマ | キーシーン | 記事 |
|---|---|---|---|
| 1 | 総論：cortexのハーネス | PRが無人マージ / 障害が気づく前に治っている | [ai-harness-intro](/posts/ai-harness-intro) |
| 2 | Product Graph（cpg） | コード・ドキュメント・DB・インフラを1グラフに統合 | [cortex-product-graph](/posts/cortex-product-graph) |
| 3 | AI PRレビュー | webhook → AIレビュー → 自動修正 → squash merge | [cortex-auto-review](/posts/cortex-auto-review) |
| 4 | Self-Healing + Observability + 自動lint追加 | アラート → AI調査 → 修正PR + 新規lint/型ゲート → 自動再デプロイで再発不可に | 本記事 ←現在地 |
| 5 | ハーネスをtoCサービスに広げる | 非エンジニア開発の実態と限界 + cortexの型をプロダクト組織全体にスケールする構想 | 準備中 |

## 全体像 ── 「観測」「修復」「強化」の3層

Self-Healingを機能させるには、その手前にちゃんと**観測層**が必要で、その後ろに**強化層**（再発防止）が必要です。Self-Healingそのものは真ん中の**修復層**に位置していて、3層が揃って初めて「self-healing + self-strengthening」のループが回ります。

| 層 | 何をするか | 主な構成要素 |
|---|---|---|
| **観測** | 本番の異常をリアルタイムに検知 | OTel SDK / Loki / Mimir / Tempo / Faro / Grafana / Pino logs with trace_id |
| **修復** | アラートをAIが受けて原因調査 → 修正PR起票 → 自動レビュー → 自動マージ → 自動再デプロイ | Event Relay → SSE → `self-healing`モードスクリプト → claude -p (worktree) → gh pr create |
| **強化** | 修正PRに新規Sensor（lint / CI guard / ガイドライン）の追加を必須化、同種アラートが二度と発火しないように構造化 | `@cortex/eslint-plugin-graph`（26本）、`scripts/check-*.ts`（13本）、`recurrence-prevention.md`、自動レビューの`[Recurrence]`観点 |

順に分解していきます。

## 観測層 ── アラートはどこから来るか

cortexの本番observabilityは**Grafana Cloud + OpenTelemetry**で構成されています。

- **OTel SDK**（`@cortex/otel`共通パッケージ）── 各サービスのエントリポイント最初で`initOtel({ serviceName })`を呼ぶ。trace / metric / logをOTLPでGrafana Cloudに送る
- **Loki**（ログ）── Pino構造化ログに`trace_id`を自動付与。trace ↔ log相互参照可能
- **Mimir**（メトリック）── Cloud Run / pipeline / Gemini APIトークン使用量等
- **Tempo**（トレース）── 分散トレーシング
- **Faro**（フロントエンド）── ブラウザのJSエラー / パフォーマンス / ネットワーク失敗を捕捉
- **Grafana** ── ダッシュボード + Alert Rules + Notification Policy

加えて、Pinoの構造化ログは**ログレベルの定義を明確に分けて規約化**しています:

| レベル | 用途 | 例 |
|---|---|---|
| `warn` | 機能低下だが継続可能 | リトライ発生、フォールバック使用 |
| `error` | 処理失敗 | APIエラー、データ不整合 |
| `fatal` | サービス停止レベル | 起動失敗、必須設定の欠落 |

`warn`は人を起こさない領域、`error`は閾値型アラートのトリガー、`fatal`はその場で起こす ── この分類が曖昧だと「監視疲労」と「重大障害見逃し」が同時に起きるので、規約として固めています。Self-Healingが反応するのは主に`error`の閾値超えで、`fatal`は人手エスカレーション側。

Alert Rulesは**Pulumiで宣言的に管理**していて、サービスごとに`BOT / Pipeline / Transformer / Generator / Gemini / CI / Deploy / Service Catch-All`等のカテゴリでルールをまとめてある。新サービスを追加するときも、infraコードにルールを1行足せばダッシュボード+アラートが自動で立ち上がる構成です。

ここまでが**「人間が見るのと同じものを、AIも見る」**ためのインフラ。Self-Healingは、ここで上がったアラートを受け取って動きます。

### Observabilityで拾えないものはSelf-Healingも無力

正直に書いておきます。Self-Healingはあくまで**観測層が異常として検知できたもの**にしか反応できません。Observabilityが命、というのはここに直結する話です。

現状cortexの観測スタックで取れているのは、ざっくり**「ロジックレベルのエラー」** ── 例外、エラーログ、デプロイ失敗、外部API呼び出しエラー、閾値型メトリック異常 ── が中心です。

逆に、いまの構成では**取れていない領域**があります:

- **UIのエラー** ── ロジックは通っていてエラーログも出ないが、画面に**意図通り表示されない / 誤った値が表示される**クラスの障害。Faroでクライアント側のJS例外やnetwork failureは拾えるが、「ロジックが通った上で結果が意図と違う」はアラートにならない
- **静かなdata corruption** ── 集計値がじわじわずれる、テーブルに不正な値が入る等。閾値やschema違反として現れない限り検知できない
- **ユーザー体感の劣化** ── レスポンスが遅い、UXがおかしい等。SLO / レイテンシ閾値を超えて初めて拾える

つまりSelf-Healingは**「観測層が捉えられる障害」をAIに置き換える**仕組みであって、**観測層自体の網羅性が前提条件**です。観測の穴は、自動レビューやSelf-Healingの届かない死角としてそのまま残ります。

これはSelf-Healingの限界というより**「観測スタックを育てることの重要性」**であり、cortexでも継続的に投資している領域です（[Part 1](/posts/ai-harness-intro)で書いた「支える基盤層」の一つがObservability）。

## 修復層 ── Self-Healingの流れ

`MODE=self-healing`で起動した[Part 3](/posts/cortex-auto-review)と同じwebhook-serverスクリプトが、Grafanaのfiring alertを受けて動きます。流れはこう。

```
[Grafana Alert Rule firing]
   ↓ POST /webhook/grafana
[Event Relay (自前)] ── Firestoreに永続化
   ↓ SSE push (event: grafana-alert)
[self-healing モードスクリプト]
   ↓ スロットル判定（同一fingerprintは4h以内スキップ）
   ↓ Slackに 👀 リアクションで対応開始通知
   ↓ git worktree add -b hotfix/auto-alert-{service}-{ts} origin/main
   ↓ claude -p をworktree内でspawn
     - Product Graph MCPでサービス関連コードを検索
     - Grafana MCPでLokiからエラーログを取得
     - 根本原因を特定して修正
     - 必要なテスト更新
     - conventional commit形式で commit
   ↓ git push + gh pr create
[修正PR]
   ↓ 自動レビュー (Part 3 のパイプライン)
   ↓ APPROVE → 自動マージ → 自動再デプロイ
[復旧完了]
   ↓ Slackスレッドに ✅ 完了通知
```

### AIが「修正不可」と判断したらどうなるか

すべてのアラートがAI修正可能なわけではありません。実装では「修正不能と判断したら何も変更せずに終了」というルールにしてあって、その場合Slackスレッドに**「コード修正では対応できないアラートです。調査結果: ...」**という形で**AIが何を調べたかの調査結果付き**で通知する。

外部サービスの一時障害、コードでなくインフラ設定の問題、AIの判断負荷が高すぎるケース等、ここに落ちる。**「人が出てきて対処する」のはこのバケットだけ**という運用です。

実際に飛んでくるSlackメッセージはこういう粒度です（一例:`styling-pattern-watch-transformer`のGitHub PAT失効ケース）:

> :information_source: コード修正では対応できないアラートです。調査結果:
>
> **調査結果サマリ**
>
> 直近1時間のエラーログをLokiで確認したところ、`styling-pattern-watch-transformer`の現在の唯一のエラー要因は **GitHub PAT (Personal Access Token) の失効 / revoke** でした。
>
> **発見した事実**
>
> 1. BQ snapshot pipelineは正常稼働中: 直近7回連続`[BQ] Snapshot rows inserted`が成功。以前のautodetect型ドリフト障害は別PRで`SAFE_CAST(... AS INT64)`が適用済みで解消済み。
> 2. 現在の唯一のエラー（直近1時間以内、複数回発生）: `GithubUnauthorizedError: GitHub API /commits/master unauthorized (401): PATが失効/revokeされた可能性が高い` ── `/check-drift`ハンドラがCloud Scheduler起動の度に401で失敗
>
> **根本原因**
>
> 該当サービスのSecret Managerに保存されているGitHub Personal Access Tokenが失効/revokeされた。コード側では401を専用クラス`GithubUnauthorizedError`として再throwし、Slackに「PAT更新が必要」通知も既に出している。**コード側の検知・通知設計は意図通り。**
>
> **対応方針: 無変更で終了**
>
> これは外部資格情報の運用障害（PAT失効）であり、Secret Managerを**人間が新しいPATで更新する**必要がある。コード変更で解決できる種類の障害ではないため、コード変更・コミット・PR起票は行わずに終了します。
>
> オペレータ向けアクション:
> - GCP Console / Secret Managerで対象シークレットに有効なPAT（`repo`権限、対象リポジトリへのreadアクセス）の新バージョンを追加
> - Cloud Run revisionの再デプロイは不要（`secretKeyRef version:latest`参照）

この粒度で「**何を調査したか、なぜコード変更で解決できないか、人は何をすべきか**」が全部出てくる。Slackスレッドを開けばオペレータはそのまま対応に入れるので、「アラートだけ転送される」のとは生産性が桁違いです。

### 重複防止

同一`fingerprint`（Grafanaアラートの一意識別子）に対して**4時間以内は再処理しない**スロットルが入っている。これがないと、修正PRがマージされる前に同じアラートが再発火 → 別worktreeで別修正PR → ... という無限ループに陥りやすい。

加えて、`alertname`に「クレデンシャル」「credential」を含むものは**恒久スキップ**。クレデンシャル系はAIが触ると漏洩リスクがあるので、明示的に人にエスカレートする設計です。

### Self-HealingとPart 3自動レビューの関係

Self-Healingが起票するPRは**特別なPRではなく、ただのfix PR**です。Part 3の自動レビューパイプラインに**同じ条件で**乗ります。9観点（Graph / Architecture / Security / Test / Doc / Impact / Observability / AI-Antipattern / Recurrence）を順にチェックされて、Critical / Majorがあれば`REQUEST_CHANGES`、Nit only / 指摘なしでCI greenなら`APPROVE` → 自動マージ。

つまり、**Self-Healingが雑に書いたPRは自動レビューで弾かれる**。self-healingモードのAIと、reviewerモードのAIが別プロセス・別セッションで動くので、判定は独立です。

### 具体例: meet subscriptionの409 ALREADY_EXISTS

例として、[Meeting Intelligence](/posts/meeting-intelligence)で実装を書いたGoogle Meet録画の自動取得系で発火したアラートを取り上げます。2026-05-21にSelf-Healingが起票した自動修正PR（`fix(meet-subscription-renewal): auto-fix for Service Error Log Detected`）です。

Lokiから拾った発火元のエラー:

```text
Workspace Events API request failed: 409 Conflict
"Subscription associated with the resource already exists."
```

AIの調査の流れ:

1. **Lokiクエリでエラーログを特定** ── Grafana MCP経由で`{service_name="meet-subscription-renewal"} | json | level=~"ERROR|error|Error"`を実行、`Failed to renew Meet subscription`のスタックトレース取得
2. **Product Graphで呼び出し経路を辿る** ── `renewSubscriptions` → `createMeetSubscription`のcall pathを特定
3. **過去のPRと突合せ** ──「逆方向の不整合」（Firestoreに名前があるがGoogle側から消えた＝404）は既に別PRで`patchMeetSubscriptionTtl` → null fallbackでself-heal済み。**今回の方向（Google側に残っているがFirestoreに無い＝409）はまだ対応されていない**ことを発見
4. **判定**:「パターンが他にも存在しうる」状況 → `[Recurrence]`判定マトリクスの**「横展開必須」**のケース

その場凌ぎの修正ではなく、**逆方向に存在していたfallbackと対称になるように同方向のself-healingを実装**しました:

- `createMeetSubscription`をidempotentに変更
- POSTが409を返したら、レスポンスから既存Subscription名を抽出して`patchMeetSubscriptionTtl`を呼ぶ
- 戻り値を呼び出し元がFirestoreに書き戻すので、次回以降のrenewalは通常のPATCHパスに収束（**self-healing**）
- 既存lintルール`graph/no-silent-catch`に従って、JSON.parse失敗時も`logger.warn`+`serializeError`で構造化ログ
- テスト3件追加

これが「Self-Healingがroot causeまで踏み込んで横展開してくる」の具体パターンです。**「症状を消す」ではなく「再発のクラスを閉じる」**（`recurrence-prevention.md`の思想）を、AIが自律的に実行している例。

## 強化層 ── Sensors（lint＋ガイドライン）が自動で増えていく

ここがSelf-Healingを**単なる「自動修復」で終わらせない**ためのキーです。

[Part 1](/posts/ai-harness-intro)で出てきたMartin Fowlerの**Guides / Sensors**分類で言えば、強化層は**Sensors** ── AIが出した結果をマージ前にゲートとして判定する側に当たります。cortexのSensorsは2層構造になっていて:

- **機械が読むSensor**: lint / 型 / CI guard / カバレッジ閾値 / Prettier ── CIで違反を弾く
- **人とAIが読むSensor**: `recurrence-prevention.md`、`severity.md`、`ai-antipattern.md`等のガイドライン ── 自動レビューが判定基準として使う

[Part 3](/posts/cortex-auto-review)で書いた9観点やseverity規約・降格禁止ルールが後者、Part 4で書く自動lint追加が前者の話で、**両者がセットで初めてSensorsとして機能する**。lintは「形式化されたガイドライン」、ガイドラインは「まだ形式化されていないlint」と言ってもいい。

そしてこのSensorsを**Self-Healingと自動レビューが互いに強化する**構造になっています:

- Self-Healingが原因調査で「同種パターンが他にも存在する」と発見 → 横展開＋lint化を要求
- 自動レビューが`[Recurrence]`観点で「lint化なしのfixは通さない」と弾く
- どちらも[cpg](/posts/cortex-product-graph)で影響範囲を見渡せるからこそ可能

cpgがあるからAIは「この罠は他にも何箇所あるか」を見られる。Self-Healingと自動レビューは**cpgを共有基盤として、片方の出力が他方のSensorsを育てる**関係です。

### Self-Healingが動くたびに何が起きるか（再発防止主役のフロー）

Self-Healingが起票するfix PRは、自動レビューで`[Recurrence]`観点もチェックされる。判定マトリクスはこう:

| 状況 | 必須アクション | 形式 |
|---|---|---|
| 同じ罠を2回以上踏んだ | **lint化を必須**（custom ESLintルール / 型制約 / CI guard） | 機械化（Sensor追加） |
| パターンが他にも存在しうる | **横展開を必須**（cpgで類似ノード走査、既発見箇所も同PRで修正） | 調査+修正 |
| 機械検証不能だが原則として価値あり | **既存ガイドラインに項目追加** | ガイドライン追加 |
| 単発・原則化価値なし | **何もしない**（bug fixのみ） | — |

「同じ罠を2回以上踏んだ」状況では、**修正PRに新規lintも含めないとマージされない**。結果として、Self-Healingが動くたびに以下が起こります:

1. **同種パターンをcpgで横展開検出** ── 修正対象だけでなく、類似ノードを全列挙
2. **新規Sensorを同PRで追加** ── ESLint custom rule / 型制約 / CI guard / ガイドライン項目のいずれか
3. **既存違反は同PR内で0にする** ── `warn`投入でのdeferral禁止、`error`で投入
4. **自動レビュー → 自動マージ → 自動再デプロイ** ── Part 3の通常パイプライン
5. **以降、同種クラスの障害はCI / lintで構造的に発生不可能になる**

「直したついでに防ぐ」が、Self-Healingを起点に自動で回り続ける構造です。

### 「将来的に対応」「`warn`で導入」は禁止

ガイドラインに明文化されている重要なルール:

- 「将来的にlint化を検討」「次回リファクタリング時に検討」「別PRで対応」── **すべて禁止**。対応可能なら同PRで対応する
- 「既存違反が残るため`warn`で導入し、後段で`error`へ昇格」── **採用しない**。これは事実上のdeferralで、`warn`を`error`に昇格する責務が宙に浮いて陳腐化する
- lintルールを追加するなら**同PRで既存違反も0にして`error`で投入する**

これも結局は[Part 3](/posts/cortex-auto-review)で書いた「降格禁止ルール」の系譜で、**典型的な逃げ方を先回りで潰す**という発想です。

### 「踏んだらSensor化」の系譜（実例集）

cortexに積み上がっているcustom Sensorの実例:

- **`graph/no-silent-catch`**（ESLint） ── 冒頭の「上振れ」の元凶。catchブロックで例外を握り潰すパターンを禁止
- **`cortex-quality/require-fetch-timeout`**（oxlint） ── 外部APIへの`fetch`に`signal: AbortSignal.timeout(...)`必須。timeout無しfetchがhangしてCloud Tasks再配信ストームを引き起こした事例から
- **`graph/no-bq-string-timestamp-param`**（ESLint） ── BigQueryのクエリパラメータでTIMESTAMPをstringで渡すと、serializerバグでNULL化してINSERT全失敗する事例から
- **`graph/require-firestore-ignore-undefined`**（ESLint） ── Firestoreの`new Firestore()`に`ignoreUndefinedProperties: true`必須化。NULL行で同期batchが100%失敗した事例から
- **`check-otel-env-injection`**（CI guard） ── 後述のCloud Run OTel env注入漏れの再発防止

これらは全部「**事前に教科書で習える**」のではなく、「**踏んでから機械化した**」もの。組織が踏んだ罠の数だけSensorが積み上がっていきます。

### 具体例: Cloud RunのOTel env注入漏れ → CI guardへの昇格

過去に複数サービスで「Cloud Run Service/JobをPulumiで定義したとき、`OTEL_EXPORTER_OTLP_ENDPOINT`と`GRAFANA_CLOUD_API_KEY`を`secretKeyRef`でenvsに注入し忘れて、本番でOTel initがskipされ、Grafanaにtrace/logが届かず障害が検知不能になる」という罠を踏みました。

普通なら「気をつけよう」で終わる。cortexでは:

1. 障害発覚 → Self-Healingが修正PR起票（該当サービスにenv注入を追加）
2. 自動レビューの`[Recurrence]`が「同じ罠を踏んだ → lint化必須」と判定
3. 同PRに`scripts/check-otel-env-injection.ts`（CI guard）を追加 ── `infra`配下のCloud Runリソース定義に対してOTel env必須化を機械検証
4. 既存サービス（全体）も同PRでenv注入を補完
5. マージ → デプロイ → 以降、同じ罠はCIで弾かれる

これが「Self-Healingが動くたびにガードレールが増える」の具体パターン。罠は「踏んだら機械検証」される。

### Sensorsの現在地（数で見る）

直近のcortex repositoryのSensorインベントリ:

| カテゴリ | 数 | 補足 |
|---|---|---|
| **Custom ESLintルール**（`@cortex/eslint-plugin-graph`） | 26本 | `no-silent-catch` / `require-firestore-ignore-undefined` / `no-bq-string-timestamp-param`等 |
| **CI guard**（`scripts/check-*.ts`） | 13本 | `check-otel-env-injection` / `check-cloudscheduler-oidctoken-audience`等 |
| **Standard oxlintルール**（`error`設定） | 183本 | base configで一律 error 投入 |
| **TypeScript strict系** | 9 gate | `strict` / `noImplicitAny` / `strictNullChecks` / `noUncheckedIndexedAccess`等 |
| **テストカバレッジ閾値** | statements + branches 90% | 全packageで一律 |
| **Prettier** | 1 config | フォーマット自動修正 |
| **ガイドライン** | review-guidelines repository 全文 | 自動レビューの判定基準 |

このうち上3つ（Custom ESLint / CI guard / oxlint）が**直近で増え続けている**部分。Self-Healingと自動レビューが動くたびに、`[Recurrence]`観点が新規追加を要求するので、グラフが右肩上がりで増えていきます。**ガードレールは時間とともに育つ** ── これが強化層の本質です。

## 全体ループの俯瞰

3層を組み合わせると、こうなります:

```
[本番異常] → 観測層 (OTel/Loki/Grafana) → Alert firing
                                              ↓
                                       Event Relay → SSE
                                              ↓
[Self-Healing mode script]
   - claude -p in worktree
   - cpg + Loki + git blame で原因特定
   - 修正コミット
   - (該当すれば) 新規lint/型ゲートも追加
   - gh pr create
                                              ↓
[自動レビュー(Part 3)] ── 9観点を順にチェック、特に [Recurrence] で
                          再発防止アクション(lint化 / 横展開 / ガイドライン追加)を必須化
                                              ↓
                          APPROVE + CI green
                                              ↓
[自動マージ → Turborepo build → Pulumi parallel deploy]
                                              ↓
[本番復旧 + 同種アラート再発不可]
```

このループは**人の介入なしで一周まわる**。修復だけでなく、修復のたびに品質ゲートが育つ ── これがcortexの「自動回復+自動強化」の中身です。

## 数字で見るSelf-Healing

冒頭の数字をもう少し分解しておきます。

### 主な発火カテゴリ

直近30日にSelf-Healingが起動したカテゴリ:

- **Service Error Log Detected** ── 各サービスのエラーログ閾値超え。最頻
- **Deploy Failed** ── デプロイ失敗（Pulumi up / Cloud Run revision failed）
- **Pipeline Failure** ── データパイプラインの一定回数連続失敗
- **Generator Failure** ── AI生成系ジョブ（embedding / annotation等）の失敗

### AI修正可能率

115本中、ほぼ全てがmerge+deploy完了。**「AIが修正不能と判断したケース」は月数件**程度で、外部サービスの一時障害や、コードでなくインフラ・設定起因のものが中心。これらはSlackスレッドに調査結果付きで通知され、人が対応します。

### アラート発火から本番復旧までの時間

平均**10〜20分程度**。内訳は概ね:

- アラート発火 → AI調査開始: 1分以内（Event Relay+SSE）
- AI調査・修正・PR起票: 3〜8分
- 自動レビュー（複数iteration含む）: 3〜8分
- 自動マージ+デプロイ: 3〜10分

人が起きる前に終わっているケースも多いです（7am発火 → 7:15復旧 → 9am出社時にはSlackに ✅ だけ）。

## 何が変わったか / Bridge to Part 5

ここまでで、**Part 1〜4を通したcortexの全体像**がほぼ揃いました:

- [Part 1](/posts/ai-harness-intro): cortex全体像とハーネスエンジニアリングの位置取り
- [Part 2](/posts/cortex-product-graph): Product Graph（cpg）── AIの「目」
- [Part 3](/posts/cortex-auto-review): 自動レビュー ── PR時点の品質を守る
- **Part 4（本記事）: Self-Healing+Observability+自動lint追加 ── 本番時点の品質を守りつつ、品質ゲート自体を育てる**

エンジニアの役割は、ここ半年で「**書く**」「**見る**」「**直す**」「**マージする**」「**デプロイする**」「**障害対応する**」のすべてから、**システム全体を上から見て調整する**役回りに移っています。`human-on-the-loop`、Policy層で運用する立ち位置。

ただし、これは**cortexという社内AI基盤**で完成した型。実際のtoCサービス（複数サービス・複数stack・複数チーム）に同じ型を持ち込もうとすると、いくつか変えないといけない部分・新規に必要な部分が出てきます。

次回**Part 5**では、ここまでのcortexのharnessを**プロダクト組織全体にスケールするロードマップと思想**を書きます。前半は「非エンジニアがcortexにPRを出せている運用」の実態と限界、後半はtoCサービスへの展開で必要になる要素（service特化ルール、AI設計の人間理解プロセス、test環境のIaC化、etc）について。

「cortexは型を作った、toCサービスはその型を桁を変えるスケールで運用する」 ── 連載締めの位置取りで書く予定です。
