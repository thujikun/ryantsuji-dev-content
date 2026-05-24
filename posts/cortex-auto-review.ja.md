---
title: "AIが書いたコードはAIが見る ── レビュー詰まりと品質低下を構造で防ぐ（連載Part 3）"
publishedAt: "2026-05-26T08:30:00+09:00"
updatedAt: "2026-05-26T08:30:00+09:00"
draft: true
slug: "cortex-auto-review"
summary: "社内AI基盤cortexの連載Part 3。「AIで開発スピードが上がるとレビューがボトルネック化する／品質が下がる」という議論に対して、Auto Reviewがどう構造で対応しているかを解説。webhook受信 → cpgコンテキスト取得 → AIレビュー → [Graph] Critical等の指摘 → 別AIが自動修正 → 再レビュー → 自動マージ → 並列デプロイまでを実装目線で。"
tags:
  - "ai"
  - "typescript"
  - "codereview"
  - "github"
  - "devops"
lang: "ja"
series: "building-ai-harness"
seriesOrder: 3
syndication:
  zenn:
    id: "91824e55b7fc9c"
    publishAt: "2026-05-26T08:30:00+09:00"
---


みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

:::message
**注記**: 本記事で言及する「cortex」は、airCloset社内で独自開発したAIプラットフォームの内部コードネームです。Snowflake CortexやPalo Alto Networks Cortex等の既存商用サービスとは一切関係ありません。
:::

[Part 1（総論）](/posts/ai-harness-intro)で **AIがPRレビューや障害対応を回している**話を、[Part 2（Product Graph）](/posts/cortex-product-graph)で **コード・docs・DB・インフラを1つのナレッジグラフに統合したcpg** の話を書きました。

今回は **Auto Review** ── PRをAIが見て、AIが直して、AIがマージするパイプラインの全フローです。AI開発で必ず話題になる **「レビューが詰まる」「品質が下がる」** という問題に対して、cortexの中ではそれらが構造的に起こりにくいパイプラインが組まれています。その仕組みを順に見ていきます。

## 連載一覧

| # | テーマ | キーシーン | 記事 |
|---|---|---|---|
| 1 | 総論：cortexのハーネス | PRが無人マージ / 障害が気づく前に治っている | [ai-harness-intro](/posts/ai-harness-intro) |
| 2 | Product Graph (cpg) | コード・ドキュメント・DB・インフラを1グラフに統合 | [cortex-product-graph](/posts/cortex-product-graph) |
| 3 | AI PRレビュー | webhook → AIレビュー → 自動修正 → squash merge | 本記事 ←現在地 |
| 4 | Alert-Fix | アラート → AI調査 → 修正PR → 自動再デプロイ | 準備中 |
| 5 | Observability + 品質ゲート | OTel/Faro一式 + 品質「下げない」設計 | 準備中 |
| 6 | 非エンジニア開発環境 | 事業メンバーがPR、AIレビューで品質担保 | 準備中 |

## いきなり1ヶ月分の数字から

過去30日（4/21〜5/21）、cortexには **769本のPRがマージされた**。**そのすべてにAIレビュアーが最初に入り、平均11回 / 最大56回のreview-fix loopを回している**。

マージまでの所要時間は **中央値で31分**、**5本に1本が10分以内**、**約半数が30分以内**にマージされている。そして **個別PRに対して人がレビューを書くことは、AIレビュー導入後は事実上ありません**。人がやっているのは、レビュー結果を見て **レビュープロンプトやガイドライン自体を調整する** こと ── いわば **human in the loop ではなく、human on the loop**。「個別の意思決定の中に人が混ざる」のではなく、「**システム全体を上から見る役割**」に役回りが変わっています。

| 直近30日の数字 |  |
|---|---|
| マージされたPR | **769本** |
| AIレビュアー関与率 | **100%** |
| 平均レビュー回数 / PR | **10.8回** |
| 最大レビュー回数 | 56回 |
| 個別PRへの人レビュー | **ほぼ0%** |
| マージ時間中央値 | **31分** |
| 10分以内マージ | 20% |
| 30分以内マージ | 49% |

これが今のcortexの「典型的な1ヶ月」。

世間でよく聞く「**AIで開発スピードを上げても結局レビューが詰まる**」「**AIが書いたコードは品質が下がる**」という声は、cortexの中では **構造的に起こりにくいパイプライン** で受け止めています。ここから順に分解します。

## 「AIが書くとレビューが詰まる」を構造で防ぐ

### 通説：レビューが新しいボトルネックになる

AIで書く速度が上がるほど、書いたコードを見る側（レビュアー）の負荷が比例して増える。Anthropicは社内ブログでClaude Codeの社内利用について、**「書く側より見る側がボトルネックになる」**「シニアエンジニアの仕事はコードを書くことより、AI出力を統合・レビューすることに移った」と明示しています。

これはcortexでも実際に同じ現象が起きました。Claude Codeをフル稼働させた瞬間、**書く速度は桁を変える勢いで跳ね上がる**。一方で、PRを読んで承認する人間の時間はリニアにしか伸びない。レビュアー（=私）が休めば全体が止まる、という古典的な単一障害点。

### cortexの答え：見る側もAIに渡す

Part 1 / Part 2で繰り返し書いた **「ハーネスをどこまで広げるか」** の問題で、cortexは迷わず **「AIが書いたコードはAIが見る」** に振り切った。人間が手元に残しているのは、レビューの結果を見て **プロンプトやガイドライン自体を直す** こと。個別PRの中で意思決定をするのではなく、システム全体を上から見て調整する役回りです。

これが成立するためには、3つの条件が必要でした。

1. **AIに渡すコンテキストが十分であること** ── 通常のAIレビューは **「PRのdiff」しか見ません**。コード本体だけ見ても、ビジネス的な意味・上流下流の依存・過去の障害履歴は見えない。cortexは[Part 2](/posts/cortex-product-graph)で書いた **Product Graph (cpg)** をAIレビュアーに渡しているので、**PRで触っていない関連箇所まで含めて影響範囲を辿れる**。結果として、(a) 上流下流の修正漏れ、(b) ドキュメント更新漏れ、(c) 関連テストの未追従 などが構造的に検出されます。これはAIを使ったレビューでも、PR diffだけを見るやり方では絶対に届かない範囲です。
2. **指摘の品質が「思いつきベース」にならないこと** ── レビューが日替わりだとチームは混乱するし、AIに対しても「正解」が定義できない。これは **明文化されたレビューガイドライン** をhard contractとしてAIに渡すことで担保します（後述、これは別リポジトリで公開しました）。
3. **誤指摘でマージブロックが連発しないこと** ── false positiveを全部Criticalにすると現場が壊れる。これは **重要度の階層化（Critical / Major / Minor / Nit）と降格禁止ルール** で抑えています。

要は、Part 2で書いたcpgが「**AIに渡すコンテキスト**」の問題を解決し、レビューガイドラインが「**AIに何をさせるか**」の問題を解決し、severity階層が「**AIに何をさせないか**」の問題を解決している、という三層構造です。

## Auto Reviewのシステム配置

実装は **各開発者の PC 上で動くスクリプト**（`scripts/auto-review/webhook-server.mjs`）です。中央サーバは存在しません。GitHub webhookを **Cloudflare Tunnel** 経由でローカルが受信し、`claude -p` をspawnして6観点（Graph / Arch / Security / Test / Doc / Impact）を順にチェックし、verdictマーカーを読み取って `gh pr review` でAPPROVE / REQUEST_CHANGESを投稿します。

![Auto Review全フロー — PR起票から自動デプロイまで人なしで完結](/images/posts/cortex-auto-review/auto-review-flow.png)

ポイントを少しだけ補足します。

- **モードで役割を分離** ── 同じスクリプトを `--mode reviewer` で起動するとレビュアー、`--mode author` で起動するとPR作者の対応係になります。レビュアーアサインされた人のPCがreviewerモードで動き、PRを出した人のPCがauthorモードで動く ── 中央サーバではなく、**各人のPCが分散して webhook に反応する構成**。
- **worktreeでPRごとに分離** ── authorモードでは origin/main を worktree にマージしてからAIをspawnする。複数PRを並列で対応してもファイル状態が混ざらない。
- **1セッションで6観点を順にcheck** ── 並列のsub-agentではなく、1つの `claude -p` セッションで6観点を順にチェック。コンテキストを共有したまま観点を切り替えるので、観点間の整合性も同時に拾える設計です。
- **レビューガイドラインはpublicリポジトリで公開済み** ── [air-closet/cortex-review-guidelines](https://github.com/air-closet/cortex-review-guidelines)（JP/EN）。AIが読んでいる中身がそのまま公開されているので、再現したい人はforkして各自のスタックに当てれば動きます。

## 指摘の構造 ── タグと重要度

Auto Reviewの出力は **タグ + severity + 具体例** の3点セットで構造化されています。

### タグ（観点）

| タグ | 観点 | 主な対象 |
|---|---|---|
| `[Graph]` | Product Graph整合性 | `@graph-*` JSDoc、依存ノード、ドキュメント整合性 |
| `[Doc]` | ドキュメント整合性 | コード変更に対するドキュメント追従、配置 |
| `[Impact]` | 影響範囲分析 | 上流下流の修正漏れ、`via:` フィールド不整合 |
| `[Security]` | セキュリティ | 認証・認可・入力検証・機密情報 |
| `[Architecture]` | Composable Architecture | app/package境界、依存方向 |
| `[Test]` | テスト品質 | カバレッジ・matcher・命名 |
| `[Observability]` | 観測性 | ログ・通知の構造化・truncate禁止 |
| `[AI-Antipattern]` | AI生成コードの罠 | 幻覚API、フォールバック濫用、デッドコード |
| `[Recurrence]` | 再発防止 | 障害修正時の判定（lint化 / 横展開 / ガイドライン追加） |

### 重要度

| severity | 基準 | アクション |
|---|---|---|
| **Critical** | セキュリティ、データ破壊、本番障害、ドキュメント不整合、`@graph-*`欠落、品質基準の緩和 | `REQUEST_CHANGES` |
| **Major** | 仕様逸脱、Composable Arch違反、テスト欠如 | `REQUEST_CHANGES` |
| **Minor** | 命名改善、保守性、軽微なリファクタ | `REQUEST_CHANGES`（resolve必須） |
| **Nit** | スタイル好み、表記揺れ | `APPROVE`（コメントのみ） |

最重要ルールは **「降格禁止」** です：

- 「**既存パターンに従った追加**」を理由に降格してはいけない（既存違反は別途修正対象であって、新規追加を許す根拠にならない）
- 「**別PRで対応**」「**段階的に**」を理由にCritical/MajorをNitへ落としてはいけない
- 「**TODO/FIXME残置**」で先送りしてはいけない

これは[`severity.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/ja/guidelines/severity.md)に明記されていて、AIが引用しながらREQUEST_CHANGESを返してきます。

### 実例：PR #1241（meet pipelineのembedding v2 dual-write）

実際のAuto Reviewコメントを見たほうが早いので、典型例を1つ貼ります。これは2026-05-19にマージされたfeature PR (`feat(meet): dual-write embeddings to new 'embedding' column (v2)`) で、起票からマージまで **1.5時間で6回イテレート** した記録です。

**初回レビュー (07:35:25)**:

> dual-write の実装方針・冪等な migration script・Promise.all 並列化いずれも妥当です。以下3点の Critical と2点の Minor を修正してから merge をお願いします。
>
> ---
>
> ## Critical
>
> ### [Graph] `@graph-business` タグが欠落 (×3)
>
> `graph-integrity.md` は `apps/` 配下のトップレベル宣言に `@graph-business` を必須としています（severity: Critical）。
> 今回追加した以下3宣言すべてに欠落しています（別スレッドで詳細コメントあり）。
> **既存コードも同様に欠落していますが、「既存パターンに従った追加」は降格理由になりません（severity.md）。**
>
> - `generateEmbeddingV2` — `apps/pipeline/meet/src/ai/embedding.ts` L153 付近
> - `EMBEDDING_MODEL_V2` — `apps/pipeline/meet/src/config.ts` L124 付近
> - `EMBEDDING_LOCATION_V2` — `apps/pipeline/meet/src/config.ts` L131 付近
>
> ---
>
> ### [Graph] `embedMeetContent` の `@graph-connects` が `generateEmbeddingV2` を反映していない
>
> `apps/pipeline/meet/src/features/meet/embedding.ts` の `embedMeetContent` JSDoc（L40〜L46）に
> `@graph-connects generateEmbedding [calls] Embedding生成` はありますが、`generateEmbeddingV2` の呼び出しが追加されたにもかかわらず対応する `@graph-connects` が追記されていません。
> グラフノードからは `generateEmbeddingV2` へのエッジが見えない状態になります。
>
> ```diff
>    * @graph-connects generateEmbedding [calls] Embedding生成
> +  * @graph-connects generateEmbeddingV2 [calls] v2 Embedding生成（dual-write）
>    * @graph-connects insertMeetChunks [calls] BQにチャンクデータ挿入
> ```
>
> ---
>
> ### [Doc] `docs/pipeline/meet.md` の BigQuery スキーマが未更新
>
> `docs/pipeline/meet.md` の「BigQueryスキーマ」節（`meet_{channel_id}` / `meet_all` テーブル）に `embedding` カラムが記載されていません。
> `graph-integrity.md` および `severity.md` はドキュメント不整合を Critical と定義しています。
>
> ```diff
>  | `created_at`  | TIMESTAMP   | 作成日時                               |
> +| `embedding`   | FLOAT64[]   | Embedding ベクトル（v2: gemini-embedding-2）|
> ```
>
> ---
>
> ## Minor
>
> ### [Test] `textEmbeddingV2` の値がテストで検証されていない
>
> `objectContaining` は余分なフィールドを許容するため、v2 値が渡されなくてもテストは通過します。
>
> ```diff
>          textEmbedding: [0.1, 0.2, 0.3],
> +        textEmbeddingV2: [0.1, 0.2, 0.3],
> ```
>
> ### [Test] v2 のみ null を返すシナリオが未テスト
>
> `generateEmbeddingV2: mockGenerateEmbedding` として v1 と同一モックを使用しているため、「v2 が null を返し v1 は成功する」ケースが独立して検証されていません。
>
> ---
>
> `<!-- VERDICT:REQUEST_CHANGES -->`

ポイントは細部の精度です。

- **ファイル + 行番号**まで具体的
- **修正案をdiff形式**で提示している（コピペで反映できる）
- **引用元ガイドライン**（`graph-integrity.md` / `severity.md`）を明示
- **典型的な言い訳（"既存コードも同様に欠落している"）を先回りで遮断**
- 末尾の`<!-- VERDICT:REQUEST_CHANGES -->`は **機械処理可能タグ** で、PRをREQUEST_CHANGES状態に遷移させるトリガーになっている

このあとエンジニア（=多くの場合別のAI）が修正をpush → 再レビュー。Critical 3件すべての本質が解消されていることを次のレビューで確認し、新たに次のMajor / Criticalを1つ指摘 → 修正 → 確認 → ... を **6イテレーション、計1.5時間**で繰り返して、最終的にAPPROVE → 自動マージです。

このイテレーションの流れを時系列にすると、こうなります。

![review-fix loopの実例 — PR #1241 / 1.5時間で6イテレーション](/images/posts/cortex-auto-review/review-fix-timeline.png)

人がレビュアーだったら、Critical 3件指摘して翌日対応待ち、再レビューがさらに翌日 ── 1本のPRで2-3日かかるところを、cortexは **90分で完結** させています。

人レビューとAuto Reviewの差は、単に「速い」というだけではありません。1つのAIセッションが6観点を順に拾い、ガイドラインを必ず引用しながら判定するので、**人が集中力で見落としやすい "深い指摘"（ドキュメント整合性 / 再発防止判断 / weak matcher等）がこぼれにくい**。これをBefore / Afterで並べるとこうなります。

![Before / After — 人レビュー時代 vs cortexのAuto Review時代](/images/posts/cortex-auto-review/before-after-review.png)

これが「レビュー詰まり」が構造的に起こらない理由です。

## Auto Fix ── AIが修正してプッシュする仕組み

REQUEST_CHANGESが立つと、今度は **PR作者のPCで動いている同じスクリプトのauthorモード** がwebhookを受けて起動します。

```
[REQUEST_CHANGES 検知]
   ↓ webhook (Cloudflare Tunnel 経由)
[PR作者のPC: webhook-server.mjs --mode author]
   ↓ origin/main を worktree にマージ（pnpm-lock.yaml は pnpm install で先行解消、
     残るコンフリクトは AI が解消）
   ↓ Auto Review のコメントを context として load
   ↓ claude -p (or codex exec) を worktree 内で spawn
   ↓ 変更を commit + push
   ↓ webhook 再発火 → レビュアーの PC が新 SHA を再 review
```

ここのキモは2点。

- **レビュアーと作者で別のPC・別のセッションが動いている** ── reviewer モードと author モードは同じスクリプトですが、走るマシン・プロセスが別。「指摘の妥当性そのもの」が独立に判定される構造になります。同じAIが自分の指摘を自分で直すのと違って、判定が交差する。
- **同一PR内で繰り返す** ── 別PRを切らない。Part 2 / レビューガイドラインでも書いた「**根本対応必須、後回し禁止**」のルールがここで効きます。`TODO/FIXME`で逃げたり、別PRに切り出したりすると、AIが次のレビューで弾きます。

修正が連続して失敗した場合（同じ指摘が解消されない等）、authorモードのスクリプトはescalate labelを立てて止まります。これは現状ほぼ発火しません（後述の数字）。

## 自動マージ + 並列デプロイ

Auto ReviewがAPPROVEを返し、CIも全部greenになったら、`auto-merge` scriptが動き、PRはsquashでマージされます。

```
[Auto Review APPROVE + CI green]
   ↓
auto-merge script
   ↓ squash merge to main
   ↓
[main 更新]
   ↓
Turborepo build (affected packages only)
   ↓
Pulumi up (複数 stack を並列で deploy)
   ├─ apps/api/*
   ├─ apps/pipeline/*
   ├─ apps/mcp/*
   └─ infra/*
   ↓
[deploy 完了]
   ↓
cpg index 再構築（差分のあったノードだけ embedding 再生成、Part 2 参照）
```

`pnpm up <stack1> <stack2> ...`で並列実行できるようにしてあるので、9スタックを同時にデプロイしても約8-12分で全部終わります。マージから本番反映までで言うと、平均10-15分。

これも`auto-fix`系PRと組み合わせると効果が大きい。**障害アラート → Alert-Fixが原因特定 → 修正PR起票 → Auto Review pass → 自動マージ → 自動デプロイ** が、人の介入なしで一周まわります（Part 4で扱います）。

## 数字で見るAuto Review

冒頭で挙げた数字をもう少し分解しておきます。

### review-fix loopの深さ

直近30日の769本のPRの中で、1本のPRあたりのレビュー数は **平均10.8回、最大56回**。10回以上のレビューが走っているということは、**初回レビューでほぼ確実に何か指摘が出ている**ということです。

たとえばPR #1241は6回、PR #1326は5回のreview-fix iterationを経てマージされました。**人レビュアーがいたら数日かかる修正サイクルを、cortexは数分〜数十分単位で回している**。

### Critical / Majorのhit状況

Auto Reviewが最初に出す指摘で多いのは：

- **[Graph] `@graph-business`欠落** ── Part 2で書いたcpgの前提条件。新規宣言はほぼ毎回これで止まる
- **[Doc] ドキュメント不整合** ── コード変更したのに`docs/`の対応箇所を更新していない
- **[Test] weak matcher** ── `objectContaining`で値検証を緩めている、`toBe`での単一プロパティ参照
- **[Recurrence] 再発防止アクション未明記** ── バグ修正で「lint化 / 横展開 / ガイドライン追加 / 何もしない」のどれを選んだかPR descriptionに書いていない
- **[AI-Antipattern] 幻覚API / フォールバック濫用** ── AIが確信を持って書いた間違いコード

これらは **人レビュアーがやろうとしても見落とすことが多い** カテゴリです（特にドキュメント整合性と再発防止判断）。AIに渡したことで、見落としが構造的に減ります。

### false positive

完全にゼロではない。`severity.md`のルールに照らして「これはMajorではなくNitでは？」というケースは月に数件あります。これは人がPRコメントで「これは降格扱いOK」とオーバーライドします。

ただし、**品質基準の緩和（lintルールの緩和、カバレッジ閾値の引き下げ等）はAI側が自動で許可しません**。`severity.md`の規定により、AIレビューは緩和を含むPRを`REQUEST_CHANGES`で必ず差し戻し、**人間のApproveを必須化** しています。

## 失敗モードとHuman Override

完璧に動いているわけではなく、いくつか失敗モードがあります。

### 1. AIが誤指摘するケース

頻度は低いが、AIが「存在しないルール」を引いてCriticalを立てることがある。これは人が「該当ガイドラインにそういう規定はない」とコメントすると、Auto Review側がそのコメントをコンテキストに取り込んで、次のレビューで訂正します。

### 2. Auto Fixが連続失敗

authorモードのスクリプト（PR作者のPC）の修正試行が連続で同じ指摘を再発させた場合、PRに`needs-human` labelが立ってエスカレーションされます。経験的に、これが立つのは **「AIが現実のシステム制約を理解していないケース」**（GCPの特殊な権限要件、外部APIのundocumented挙動 等）が多い。人が判断してコンテキストを補足するか、別アプローチに切り替えます。

### 3. 大規模リファクタPR

数千行を超えるPRでは、AIのレビューコンテキストが膨らみすぎて精度が落ちます。これは **「PRを分割する」** という別のガイドラインで対応しています。5,000行超のPRはAIが「これは1本のPRの対象として大きすぎる」とREQUEST_CHANGESを返します。

### 4. アーキテクチャ判断レベルの提案

「**そもそもこの方向で正しいか**」レベルの判断は、AIレビューでは決められません。これは設計レビュー or 私（Ryan）の判断にエスカレーションします。Auto Reviewが出す指摘は **「定義済みのルールに照らした違反判定」**であって、戦略判断はスコープ外、という線引きをしています。

## 何が変わったか / Bridge to Part 4

cortexのエンジニアの役割は、ここ半年で「**書く側**」「**見る側**」の両方から「**判断する側**」に移った。

- コードはAIが書く（Claude Code）
- レビューはAIが見る（Auto Review）
- 修正も別のAIが直す（PR作者のPCで動くauthorモード）
- マージもAIの判断で走る（auto-merge script）
- デプロイも並列で走る（Turborepo + Pulumi）

エンジニアの手元に残っているのは「**レビューの結果を見てプロンプトやガイドラインを直す**」「**新しいガイドラインをどこに加えるか** を決める」「**そもそもこの方向で正しいか** を判断する（アーキテクチャ判断）」── すべて **個別の意思決定ではなく、システム全体を上から見る役割** に寄っています。**human in the loop から human on the loop へ**、と言い換えてもいい。

世間で言われる「AIで品質が下がる」「レビューが詰まる」という現象は、**ハーネスを書く側だけに広げて、見る側を人に残したまま放置する** から起こる。書く速度だけ上がって、見る側がそのままなら、確かに詰まる。確かに見落とす。

cortexは逆です。**書く側よりも先に、見る側にハーネスを広げた**。「書く側より見る側がボトルネックになる」というAnthropicの知見はそのまま正しい。だからこそ「**見る側もAIに渡す**」が、cortexが選んだ答えになる。

「AIが書いたコードはAIが見る」── これがcortexのAuto Reviewの核心です。**品質低下とレビュー詰まりは、ハーネスをどこまで広げたかで決まる現象**であって、AI開発そのものの宿命ではない。

---

次回 **Part 4** では、**Alert-Fix** ── 本番のアラートを起点にAIが原因調査 → 修正PRを起票 → Auto Reviewに乗せて自動マージ → 自動再デプロイまで完結させる仕組みを取り扱います。Auto ReviewがPR時点の品質を守るのに対し、Alert-Fixは **production時点の品質を守る** 役割です。

冒頭の数字には`auto-fix`系PR（=Alert-Fix由来）も含まれています。**「障害は気づく前に直っている」** が、cortexの現状です。次回お楽しみに。

---

airClosetでは、AIと一緒に新しい開発体験を作っていくエンジニアを募集しています。興味のある方は[airCloset Quest](https://corp.air-closet.com/recruiting/developers/)の採用ページをご覧ください。
