---
title: "障害が自動で直り、ガードレールが自動で増える ── Alert-Fix + Observability + 自動lint追加（連載Part 4）"
publishedAt: "2026-06-02T08:30:00+09:00"
updatedAt: "2026-06-02T08:30:00+09:00"
draft: true
slug: "cortex-alert-fix"
summary: "社内AI基盤cortexの連載Part 4。本番アラートをAIが調査・修正・デプロイまで完結させるAlert-Fixと、その手前のOTel/Faro/Prometheus観測スタック、そして修正と同時に再発防止のlint/型gateが自動で増えていく仕組み。直近30日で115本のauto-fix PRがマージされ、同種障害が構造的に再発できなくなっていく流れを実装目線で。"
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
    id: "39e2fd6747b28e"
---


みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

:::message
**注記**: 本記事で言及する「cortex」は、airCloset社内で独自開発したAIプラットフォームの内部コードネームです。Snowflake CortexやPalo Alto Networks Cortex等の既存商用サービスとは一切関係ありません。
:::

[Part 3](/posts/cortex-auto-review)では「AIが書いたコードはAIが見る」── 自動レビューパイプラインで **PR時点の品質** を守る話を書きました。

今回は **production時点の品質を守る** 側、**Alert-Fix** です。本番アラートをAIが調査して修正PRを起票、自動レビューに乗せて自動マージ、自動再デプロイまで完結させる仕組み。そしてその修正PRには **再発防止のlint/型gateの追加が必須化** されていて、結果として **ガードレールが日々自動で増えていく**。

「障害が自動で直る」だけだと catchy ですが、たぶんそれだけでは中長期では負ける。**直したついでに同じ罠の再発を構造的に潰す** ──「self-healing」+「self-strengthening」の2つが組み合わさって初めて、品質ゲートは時間とともに育っていきます。

## いきなり1ヶ月分の数字から

**直近30日でマージされた `auto-fix` 系PR: 115本。**

**ほぼ全て人の介入なしで merge + deploy 完了。**

**人の対応は「AIが手を出せないと判断したケースだけ」。**

これがcortexの「障害対応」の現状です。

ここで「115件 = ユーザー影響のある障害」とは読まないでください。内訳はざっくり:

- **約半数（54本）が Deploy Failed 系** ── CI/Pulumi デプロイ段階で失敗を検知し、本番に出る前にAIが消化したもの。**ここは最近 `[Recurrence]` loop（後述）で対策が積み上がってきていて、減少傾向**
- **残り 61 本が service-level の本番エラーログ閾値超え** ── Service Error Log Detected 等、ユーザー影響に至る前の段階で発火する閾値型アラートを、AIが先に消化したもの

つまり「障害対応」というよりは「**監視で拾った本番異常を、人が起きる前にAIが115回直した**」が正確。実際に **人が認知するインシデントは月数件** レベルに絞られます。

加えて、同じサービス（例: `gcs-transformer` が 61 件中 25 件）で繰り返し発火しているケースが目立ちます ── これがまさに後段で書く `[Recurrence]` loop で **lint/型gate化して構造的に潰していく対象** になる、というのが本記事後半の話です。

もう一つ正直なところを書いておくと、**直近1ヶ月の数字はやや上振れ** しています。元々コードベース内に「エラーを `catch` で握り潰して何も通知しない」サイレント catch が多く存在していて、`no-silent-catch` の lint ルールを追加して **既存の silent catch を順次潰した** 結果、それまで隠れていた本番障害がアラートとして表に出てきた、という側面があります。「監視が見える化された」分のスパイクなので、`[Recurrence]` loop で対応 + lint化が進めば数字は収束していく見込みです。**「見えていなかったものが見えるようになった」のは品質的にむしろ前進** で、いま起きているのはその catch-up フェーズです。

アラートが発火した瞬間にAIが調査を開始、Loki / Product Graph / git blame を辿って根本原因を特定し、修正PRを起票して [Part 3](/posts/cortex-auto-review) の自動レビューに乗せ、APPROVE → 自動マージ → 自動再デプロイで一周まわります。

## 連載一覧

| # | テーマ | キーシーン | 記事 |
|---|---|---|---|
| 1 | 総論：cortexのハーネス | PRが無人マージ / 障害が気づく前に治っている | [ai-harness-intro](/posts/ai-harness-intro) |
| 2 | Product Graph（cpg） | コード・ドキュメント・DB・インフラを1グラフに統合 | [cortex-product-graph](/posts/cortex-product-graph) |
| 3 | AI PRレビュー | webhook → AIレビュー → 自動修正 → squash merge | [cortex-auto-review](/posts/cortex-auto-review) |
| 4 | Alert-Fix + Observability + 自動lint追加 | アラート → AI調査 → 修正PR + 新規lint/型gate → 自動再デプロイで再発不可に | 本記事 ←現在地 |
| 5 | ハーネスをtoCサービスに広げる | 非エンジニア開発の実態と限界 + cortexの型をPI Div全体にscaleする構想 | 準備中 |

## 全体像 ── 「観測」「修復」「強化」の3層

Alert-Fix を機能させるには、その手前にちゃんと **観測層** が必要で、その後ろに **強化層**（再発防止）が必要です。Alert-Fix そのものは真ん中の **修復層** に位置していて、3層が揃って初めて「self-healing + self-strengthening」のループが回ります。

| 層 | 何をするか | 主な構成要素 |
|---|---|---|
| **観測** | 本番の異常をリアルタイムに検知 | OTel SDK / Loki / Mimir / Tempo / Grafana / Pino logs with trace_id |
| **修復** | アラートをAIが受けて原因調査 → 修正PR起票 → 自動レビュー → 自動マージ → 自動再デプロイ | Event Relay → SSE → `alert-fix` モードスクリプト → claude -p (worktree) → gh pr create |
| **強化** | 修正PRに再発防止のlint/型gateの追加を必須化、同種alertが二度と発火しないように構造化 | `recurrence-prevention.md`、`@cortex/eslint-plugin-graph`、自動レビューの `[Recurrence]` 観点 |

順に分解していきます。

## 観測層 ── アラートはどこから来るか

cortexの本番observabilityは **Grafana Cloud + OpenTelemetry** で構成されています。

- **OTel SDK**（`@cortex/otel` 共通パッケージ）── 各サービスのエントリポイント最初で `initOtel({ serviceName })` を呼ぶ。trace / metric / log を OTLP で Grafana Cloud に送る
- **Loki**（ログ） ── Pino構造化ログに `trace_id` を自動付与。trace ↔ log 相互参照可能
- **Mimir**（メトリック） ── Cloud Run / pipeline / Gemini API token使用量等
- **Tempo**（トレース） ── 分散トレーシング
- **Grafana** ── ダッシュボード + Alert Rules + Notification Policy
- **Slackチャンネル分離** ── `#cortex-fatal`（critical）/ `#cortex-alerts`（warning）/ `#cortex-info`（info）/ `#cortex-staging`（cortex自身のstg）/ `#stg-fatal`（air-closet stg critical）に severity ベースで自動振り分け

Alert Rules は **Pulumi で declarative に管理** していて、サービスごとに `BOT / Pipeline / Transformer / Generator / Gemini / CI / Deploy / Service Catch-All` 等のカテゴリで rule をまとめてある。新サービスを追加するときも、infra コードに rule を1行足せばダッシュボード + アラートが自動で立ち上がる構成です。

ここまでが **「人間が見るのと同じものを、AIも見る」** ためのインフラ。Alert-Fix はこのスタックから上がってきた firing alert を消費する側です。

## 修復層 ── Alert-Fix の流れ

`MODE=alert-fix` で起動した [Part 3](/posts/cortex-auto-review)と同じ webhook-server スクリプトが、Grafana firing alert を受けて動きます。流れはこう。

```
[Grafana Alert Rule firing]
   ↓ POST /webhook/grafana
[Event Relay (自前)] ── Firestoreに永続化
   ↓ SSE push (event: grafana-alert)
[alert-fix モードのスクリプト]
   ↓ スロットル判定（同一fingerprintは4h以内skip）
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

すべての alert が AI 修正可能なわけではありません。実装では「修正不能と判断したら何も変更せずに終了」というルールにしてあって、その場合 Slackスレッドに **「コード修正では対応できないアラートです。調査結果: ...」** という形で **AIが何を調べたかの調査結果付き** で通知する。

外部サービスの一時障害、コードでなくインフラ設定の問題、AIの判断負荷が高すぎるケース等、ここに落ちる。**「人が出てきて対処する」のはこのバケットだけ** という運用です。

### 重複防止

同一 `fingerprint`（Grafana alert の一意識別子）に対して **4時間以内は再処理しない** スロットルが入っている。これがないと、修正PRがマージされる前に同じ alert が再発火 → 別worktreeで別修正PR → ... という無限ループに陥りやすい。

加えて、`alertname` に「クレデンシャル」「credential」を含むものは **恒久skip**。クレデンシャル系は AI が触ると漏洩リスクがあるので、明示的に人にエスカレートする設計です。

### Alert-Fix と Part 3 自動レビューの関係

Alert-Fix が起票する PR は **特別な PR ではなく、ただの fix PR** です。Part 3 の自動レビューパイプラインに **同じ条件で** 乗ります。9観点（Graph / Architecture / Security / Test / Doc / Impact / Observability / AI-Antipattern / Recurrence）を順にチェックされて、Critical / Major があれば `REQUEST_CHANGES`、Nit only / 指摘なしで CI green なら `APPROVE` → 自動マージ。

つまり、**Alert-Fix が雑に書いた PR は自動レビューで弾かれる**。alert-fix モードの AI と、reviewer モードの AI が別プロセス・別セッションで動くので、判定は独立です。

## 強化層 ── ガードレールが自動で増えていく

ここが Alert-Fix を **単なる「自動修復」で終わらせない** ためのキーになります。

Part 3 で書いた自動レビューの 9 観点のうちの 1 つに `[Recurrence]`（再発防止）がある。これがbug fix系 PR では **必須** で、`recurrence-prevention.md` ガイドラインに定義された判定マトリクスに従って、PR が以下のいずれかを実行することを要求します:

| 状況 | 必須アクション | 形式 |
|---|---|---|
| 同じ罠を 2 回以上踏んだ | **lint化を必須**（カスタムESLintルール / 型制約 / CI ガード） | 機械化 |
| パターンが他にも存在しうる | **横展開を必須**（Product Graphで類似ノード走査、既発見箇所も同PRで修正） | 調査 + 修正 |
| 機械検証不能だが原則として価値あり | **既存ガイドラインに項目追加** | guideline |
| 単発・原則化価値なし | **何もしない**（bug fix のみ） | — |

### 「将来的に対応」「`warn`で導入」は禁止

ガイドラインに明文化されている重要なルール:

- 「将来的にlint化を検討」「次回リファクタリング時に検討」「別PRで対応」── **すべて禁止**。対応可能なら同PRで対応する
- 「既存違反が残るため `warn` で導入し、後段で `error` へ昇格」── **採用しない**。これは事実上の deferral で、`warn` を `error` に昇格する責務が宙に浮いて陳腐化する
- lint ルールを追加するなら **同 PR で既存違反も 0 にして `error` で投入する**

これも結局は[Part 3](/posts/cortex-auto-review)で書いた「降格禁止ルール」の系譜で、**典型的な逃げ方を先回りで潰す** という発想です。

### Alert-Fix + [Recurrence] の組み合わせで何が起きるか

Alert-Fix が起票する fix PR は、自動レビューで `[Recurrence]` 観点もチェックされる。「同じ罠を 2 回以上踏んだ」状況であれば、**修正PRに新規lintルールも含めないとマージされない**。

結果として、Alert-Fix が動くたびに以下が起こります:

1. 障害そのものは AI が修正
2. 同種の罠を防ぐ新規lint/型gateが同PRで追加される
3. 既存違反も同PR内で0にされる（カバレッジ閾値・lintの初手 error 投入の原則）
4. 自動マージ → 自動再デプロイ
5. **以降、同じclassの障害は CI / lint レベルで構造的に発生不可能になる**

ガードレールが日々増えていく方向に進む。「直したついでに防いだ」が、Alert-Fix 駆動で自動回っていく構造です。

### 具体例: Cloud Run の OTel env 注入漏れ

過去に複数サービスで「Cloud Run Service/Job を Pulumi で定義したとき、`OTEL_EXPORTER_OTLP_ENDPOINT` と `GRAFANA_CLOUD_API_KEY` を `secretKeyRef` で envs に注入し忘れて、本番でOTel init が skip され、Grafana に trace/log が届かず障害が検知不能になる」という罠を踏みました。

普通なら「気をつけよう」で終わる。cortexでは:

1. 障害発覚 → Alert-Fix が修正PR起票（該当サービスに env 注入を追加）
2. 自動レビューの `[Recurrence]` が「同じ罠を踏んだ → lint化必須」と判定
3. 同PRに `infra` 配下の Cloud Run リソースに対する **OTel env 必須化の CI guard** を追加
4. 既存サービス（全体）も同PRで env 注入を補完
5. マージ → デプロイ → 以降、同じ罠は CI で弾かれる

これが「Alert-Fix が動くたびにガードレールが増える」の具体パターンです。罠は「踏んだら lint 化」される。

## 全体ループの俯瞰

3層を組み合わせると、こうなります:

```
[本番異常] → 観測層 (OTel/Loki/Grafana) → Alert firing
                                              ↓
                                       Event Relay → SSE
                                              ↓
[Alert-Fix mode script]
   - claude -p in worktree
   - cpg + Loki + git blame で原因特定
   - 修正コミット
   - (該当すれば) 新規lint/型gateも追加
   - gh pr create
                                              ↓
[自動レビュー(Part 3)] ── 9観点を順にチェック、特に [Recurrence] で
                          再発防止アクション(lint化 / 横展開 / ガイドライン追加)を必須化
                                              ↓
                          APPROVE + CI green
                                              ↓
[自動マージ → Turborepo build → Pulumi parallel deploy]
                                              ↓
[本番復旧 + 同種alert再発不可]
```

このループは **人の介入なしで一周まわる**。修復だけでなく、修復のたびに品質ゲートが育つ ── これがcortexの「自動回復 + 自動強化」の中身です。

## 数字で見る Alert-Fix

冒頭の数字をもう少し分解しておきます。

### 主な発火カテゴリ

直近30日にAlert-Fixが起動したカテゴリ:

- **Service Error Log Detected** ── 各サービスのエラーログ閾値超え。最頻
- **Deploy Failed** ── デプロイ失敗（Pulumi up / Cloud Run revision failed）
- **Pipeline Failure** ── データパイプラインの一定回数連続失敗
- **Generator Failure** ── AI生成系ジョブ（embedding / annotation 等）の失敗

### AI修正可能率

115本中、ほぼ全てが merge + deploy 完了。**「AIが修正不能と判断したケース」は月数件**程度で、外部サービスの一時障害や、コードでなくインフラ・設定起因のもの、PII等で AI に触らせない領域のもの。これらは Slack スレッドに調査結果付きで通知され、人が対応します。

### Alert発火から本番復旧までの時間

平均 **10〜20分程度**。内訳は概ね:

- アラート発火 → AI調査開始: 1分以内（Event Relay + SSE）
- AI調査・修正・PR起票: 3〜8分
- 自動レビュー（複数iteration含む）: 3〜8分
- 自動マージ + デプロイ: 3〜10分

人が起きる前に終わっているケースも多いです（7am発火 → 7:15 復旧 → 9am 出社時には Slack に ✅ だけ）。

## 何が変わったか / Bridge to Part 5

ここまでで、**Part 1〜4 を通したcortexの全体像** がほぼ揃いました:

- [Part 1](/posts/ai-harness-intro): cortex全体像とハーネスエンジニアリングの位置取り
- [Part 2](/posts/cortex-product-graph): Product Graph（cpg）── AIの「目」
- [Part 3](/posts/cortex-auto-review): 自動レビュー ── PR時点の品質を守る
- **Part 4（本記事）: Alert-Fix + Observability + 自動lint追加 ── production時点の品質を守りつつ、品質ゲート自体を育てる**

エンジニアの役割は、ここ半年で「**書く**」「**見る**」「**直す**」「**マージする**」「**デプロイする**」「**障害対応する**」のすべてから、**システム全体を上から見て調整する** 役回りに移っています。`human-on-the-loop`、Policy層で運用する立ち位置。

ただし、これは **cortex という社内AI基盤** で完成した型。実際のtoCサービス（複数サービス・複数stack・複数チーム）に同じ型を持ち込もうとすると、いくつか変えないといけない部分・新規に必要な部分が出てきます。

次回 **Part 5** では、ここまでの cortex の harness を **PI Div 全体に scale するロードマップと思想** を書きます。前半は「非エンジニアがcortexにPRを出せている運用」の実態と限界、後半はtoCサービスへの展開で必要になる要素（service特化rule、AI設計の人間理解プロセス、test環境のIaC化、etc）について。

「cortex は型を作った、toCサービスはその型を桁を変える scaleで運用する」 ── 連載締めの位置取りで書く予定です。
