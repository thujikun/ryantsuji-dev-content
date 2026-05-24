---
title: "AIが書いたコードはAIが見る ── レビュー詰まりと品質低下への構造的反論（連載Part 3）"
publishedAt: "2026-05-26T08:30:00+09:00"
updatedAt: "2026-05-26T08:30:00+09:00"
slug: "cortex-auto-review"
summary: "社内AI基盤cortexの連載Part 3。「AIで開発スピードが上がるとレビューがボトルネック化する／品質が下がる」という業界の通説への構造的反論として、Auto Review の全フローを解説。webhook受信 → cpg context 取得 → AIレビュー → [Graph] Critical等の指摘 → 別AIが自動修正 → 再レビュー → 自動merge → 並列deploy までを実装目線で。"
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
    id: "TBD"
    publishAt: "2026-05-26T08:30:00+09:00"
---


みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

:::message
**注記**: 本記事で言及する「cortex」は、airCloset社内で独自開発したAIプラットフォームの内部コードネームです。Snowflake CortexやPalo Alto Networks Cortex等の既存商用サービスとは一切関係ありません。
:::

[Part 1（総論）](/posts/ai-harness-intro)で **AIがPRレビューや障害対応を回している**話を、[Part 2（Product Graph）](/posts/cortex-product-graph)で **コード・docs・DB・インフラを1つのナレッジグラフに統合した cpg** の話を書きました。

今回は **Auto Review** ── PRをAIが見て、AIが直して、AIがmergeする pipeline の全フローです。世間で言われる「AIで開発スピードが上がるとレビューがボトルネックになる／品質が下がる」という批判への、**構造的な反論**として書きます。

## 連載一覧

| # | テーマ | キーシーン | 記事 |
|---|---|---|---|
| 1 | 総論：cortexのハーネス | PRが無人マージ / 障害が気づく前に治っている | [ai-harness-intro](/posts/ai-harness-intro) |
| 2 | Product Graph (cpg) | コード・ドキュメント・DB・インフラを1グラフに統合 | [cortex-product-graph](/posts/cortex-product-graph) |
| 3 | AI PRレビュー | webhook → AIレビュー → 自動修正 → squash merge | 本記事 ←現在地 |
| 4 | Alert-Fix | アラート → AI調査 → 修正PR → 自動再デプロイ | 準備中 |
| 5 | Observability + 品質ゲート | OTel/Faro 一式 + 品質「下げない」設計 | 準備中 |
| 6 | 非エンジニア開発環境 | 事業メンバーがPR、AIレビューで品質担保 | 準備中 |

## いきなり1ヶ月分の数字から

過去30日（4/21〜5/21）、cortexには **769本のPRがmergeされた**。**そのすべてにAIレビュアー（`airClosetDev` という社内ボット）が最初に入り、平均11回 / 最大56回の review-fix loop を回している**。

merge までの所要時間は **中央値で31分**、**5本に1本が10分以内**、**約半数が30分以内**に merge されている。そして **約74%のPRは、人レビュアーがコメントひとつ書かずに通っている**。残りの26%だけが、人の judgement が必要だった PR ── そういう構造になっている。

| 直近30日の数字 |  |
|---|---|
| merged PR | **769本** |
| AIレビュアー関与率 | **100%** |
| 平均 review 回数 / PR | **10.8回** |
| 最大 review 回数 | 56回 |
| AI-only merge | **74%** |
| merge time 中央値 | **31分** |
| 10分以内 merge | 20% |
| 30分以内 merge | 49% |

これが今のcortexの「典型的な1ヶ月」。

世間でよく聞く「**AIで開発スピードを上げても結局レビューが詰まる**」「**AIが書いたコードは品質が下がる**」という批判は、cortex の中では **構造的に成立しなくなった pipeline** で受け止められている。ここから順に分解します。

## 「AIが書くとレビューが詰まる」批判への構造的反論

### 通説：レビューが新しいボトルネックになる

AIで書く速度が上がるほど、書いたコードを見る側（レビュアー）の負荷が比例して増える。Anthropic は社内ブログで Claude Code のドッグフーディングについて、**「書く側より見る側がボトルネックになる」**「シニアエンジニアの仕事はコードを書くことより、AI出力を統合・レビューすることに移った」と明示しています。

これは cortex でも実際に同じ現象が起きました。Claude Code と Codex CLI が両方フル稼働した瞬間、**書く速度が3-5倍になった一方で、PR を読んで approve する人間の時間がリニアに増えた**。レビュアー（=私）が休めば全体が止まる、という古典的な単一障害点。

### cortex の答え：見る側もAIに渡す

Part 1 / Part 2 で繰り返し書いた **「ハーネスをどこまで広げるか」** の問題で、cortex は迷わず **「AIが書いたコードはAIが見る」** に振り切った。人間が手元に残しているのは「AIのレビュー判断が妥当か」を後追いで見ることだけです。

これが成立するためには、3つの条件が必要でした。

1. **AIに渡すコンテキストが十分であること** ── コード本体だけ見せても、ビジネス的な意味・上流下流の依存・過去の障害履歴が見えない。これは [Part 2](/posts/cortex-product-graph) で書いた **Product Graph (cpg)** が解決済みです。
2. **指摘の品質が「思いつきベース」にならないこと** ── レビューが日替わりだとチームは混乱するし、AIに対しても「正解」が定義できない。これは **明文化された review-guidelines** を hard contract として AI に渡すことで担保します（後述、これは別 repo で公開しました）。
3. **誤指摘で merge ブロックが連発しないこと** ── false positive を全部 Critical にすると現場が壊れる。これは **重要度の階層化（Critical / Major / Minor / Nit）と降格禁止ルール** で抑えています。

要は、Part 2 で書いた cpg が「**AIに渡すコンテキスト**」の問題を解決し、レビューガイドラインが「**AIに何をさせるか**」の問題を解決し、severity 階層が「**AIに何をさせないか**」の問題を解決している、という三層構造です。

## Auto Review のシステム配置

実装は GitHub webhook を受けて Cloud Run で動く構成です。全体の流れは以下のようになっています。

![Auto Review 全フロー — PR 起票から自動 deploy まで人なしで完結](/images/posts/cortex-auto-review/auto-review-flow.png)

ポイントを少しだけ補足します。

- **worktree で PR ごとに isolate** ── 複数 PR を並列で review しても、ファイル状態が混ざらない。Part 2 でも触れた手法を、ここでもそのまま使っている。
- **sub-agent ごとに 1 guideline file** ── 1 LLM に全部読ませると context が膨らんで判断が散漫になる。それぞれが「自分の責務に閉じた」context で review するから、severity 判定がブレない。これは Anthropic の Claude Code の multi-agent pattern と同じ発想。
- **review-guidelines は **public repo** で公開済み** ── [air-closet/cortex-review-guidelines](https://github.com/air-closet/cortex-review-guidelines)（JP/EN）。AI が読んでいる中身がそのまま公開されているので、再現したい人は fork して各自の stack に当てれば動きます。

## 指摘の構造 ── タグと重要度

Auto Review の出力は **タグ + severity + 具体例** の3点セットで構造化されています。

### タグ（観点）

| タグ | 観点 | 主な対象 |
|---|---|---|
| `[Graph]` | Product Graph 整合性 | `@graph-*` JSDoc、依存ノード、ドキュメント整合性 |
| `[Doc]` | ドキュメント整合性 | コード変更に対するドキュメント追従、配置 |
| `[Impact]` | 影響範囲分析 | 上流下流の修正漏れ、`via:` フィールド不整合 |
| `[Security]` | セキュリティ | 認証・認可・入力検証・機密情報 |
| `[Architecture]` | Composable Architecture | app/package境界、依存方向 |
| `[Test]` | テスト品質 | カバレッジ・matcher・命名 |
| `[Observability]` | 観測性 | ログ・通知の構造化・truncate禁止 |
| `[AI-Antipattern]` | AI生成コードの罠 | 幻覚API、フォールバック濫用、デッドコード |
| `[Recurrence]` | 再発防止 | 障害修正時の判定（lint化 / 横展開 / guideline追加） |

### 重要度

| severity | 基準 | アクション |
|---|---|---|
| **Critical** | セキュリティ、データ破壊、本番障害、ドキュメント不整合、`@graph-*` 欠落、品質基準の緩和 | `REQUEST_CHANGES` |
| **Major** | 仕様逸脱、Composable Arch違反、テスト欠如 | `REQUEST_CHANGES` |
| **Minor** | 命名改善、保守性、軽微なリファクタ | `REQUEST_CHANGES`（resolve必須） |
| **Nit** | スタイル好み、表記揺れ | `APPROVE`（コメントのみ） |

最重要ルールは **「降格禁止」** です：

- 「**既存パターンに従った追加**」を理由に降格してはいけない（既存違反は別途修正対象であって、新規追加を許す根拠にならない）
- 「**別PRで対応**」「**段階的に**」を理由に Critical/Major を Nit へ落としてはいけない
- 「**TODO/FIXME 残置**」で先送りしてはいけない

これは [`severity.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/ja/guidelines/severity.md) に明記されていて、AI が引用しながら REQUEST_CHANGES を返してきます。

### 実例：PR #1241（meet pipeline の embedding v2 dual-write）

実際の Auto Review コメントを見たほうが早いので、典型例を1つ貼ります。これは 2026-05-19 に merge された feature PR (`feat(meet): dual-write embeddings to new 'embedding' column (v2)`) で、起票から merge まで **1.5時間で6回 iterate** した記録です。

**初回 review (07:35:25)**:

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
- **修正案を diff 形式**で提示している（コピペで反映できる）
- **引用元 guideline**（`graph-integrity.md` / `severity.md`）を明示
- **典型的な excuse（"既存コードも同様に欠落している"）を先回りで遮断**
- 末尾の `<!-- VERDICT:REQUEST_CHANGES -->` は **機械処理可能タグ** で、PR を REQUEST_CHANGES 状態に遷移させるトリガーになっている

このあと engineer（=多くの場合別の AI）が修正 push → 再 review。Critical 3 件すべての本質が解消されていることを次の review で確認し、新たに次の Major / Critical を1つ指摘 → 修正 → 確認 → ... を **6 iteration、計1.5 時間**で繰り返して、最終的に APPROVE → 自動 merge です。

このイテレーションの流れを時系列にすると、こうなります。

![review-fix loop の実例 — PR #1241 / 1.5時間 で 6 iteration](/images/posts/cortex-auto-review/review-fix-timeline.png)

人がレビュアーだったら、Critical 3 件指摘して翌日対応待ち、再レビューがさらに翌日 ── 1 PR で 2-3 日かかるところを、cortex は **90分で完結** させています。

人レビューと Auto Review の差は、単に「速い」というだけではありません。並列に走る sub-agent が観点ごとに専属で見るので、**人が集中力で見落としやすい "深い指摘"（ドキュメント整合性 / 再発防止判断 / weak matcher 等）がこぼれにくい**。これを before / after で並べるとこうなります。

![Before / After — 人レビュー時代 vs cortex の Auto Review 時代](/images/posts/cortex-auto-review/before-after-review.png)

これが「レビュー詰まり」が構造的に起こらない理由です。

## Auto Fix ── AIが修正してpushする仕組み

REQUEST_CHANGES が立ったら、別の Cloud Run service（`annotation-author`）が起動します。

```
[REQUEST_CHANGES 検知]
   ↓ webhook
[annotation-author service]
   ↓ PR の worktree を fetch
   ↓ Auto Review のコメント全部を context として load
   ↓ Claude Code を sub-process で起動、worktree 内で修正を試行
   ↓ 変更を commit + push
   ↓ webhook 再発火 → Auto Review が新 SHA を再 review
```

ここのキモは2点。

- **修正専用 AI と review 専用 AI を分けている** ── 自分の指摘を自分で直すと「指摘の妥当性そのもの」が独立にチェックされない。review 側と fix 側を別 agent にして、互いの判断を交差させています。
- **同一 PR 内で iterate** ── 別 PR を切らない。Part 2 / レビューガイドラインでも書いた「**根本対応必須、後回し禁止**」のルールがここで効きます。`TODO/FIXME` で逃げたり、別 PR に切り出したりすると、AI が次のレビューで弾きます。

修正が3回連続で失敗した場合（修正したつもりが同じ指摘が再発する等）、annotation-author は **human escalate label** を立てて止まります。これは現状ほぼ発火しません（後述の数字）。

## 自動 merge + 並列 deploy

Auto Review が APPROVE を返し、CI も全部 green になったら、`auto-merge` script が動き、PR は squash で merge されます。

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
   ├─ apps/api/* （Cloud Run）
   ├─ apps/pipeline/* （Cloud Run Job）
   ├─ apps/mcp/* （Cloud Run + Cloudflare KV routing）
   └─ infra/* （DNS / IAM / Secret Manager）
   ↓
[deploy 完了]
   ↓
cpg index 再構築（差分のあったノードだけ embedding 再生成、Part 2 参照）
```

`pnpm up <stack1> <stack2> ...` で並列実行できるようにしてあるので、9 stack を同時 deploy しても約 8-12 分で全部終わります。merge から本番反映までで言うと、平均 10-15 分。

これも `auto-fix` 系 PR と組み合わせると効果が大きい。**障害アラート → Alert-Fix が原因特定 → 修正 PR 起票 → Auto Review pass → 自動 merge → 自動 deploy** が、人の介入なしで一周まわります（Part 4 で扱います）。

## 数字で見る Auto Review

冒頭で挙げた数字をもう少し分解しておきます。

### review-fix loop の深さ

直近30日の 769 PR の中で、1 PR あたりの review 数は **平均10.8回、最大56回**。10回以上の review が走っているということは、**初回 review でほぼ確実に何か指摘が出ている**ということです。

たとえば PR #1241 は6回、PR #1326 は5回の review-fix iteration を経て merge されました。**人レビュアーがいたら数日かかる修正サイクルを、cortex は数分〜数十分単位で回している**。

### Critical / Major の hit 状況

Auto Review が最初に出す指摘で多いのは：

- **[Graph] `@graph-business` 欠落** ── Part 2 で書いた cpg の前提条件。新規宣言はほぼ毎回これで止まる
- **[Doc] ドキュメント不整合** ── コード変更したのに `docs/` の対応箇所を更新していない
- **[Test] weak matcher** ── `objectContaining` で値検証を緩めている、`toBe` での単一プロパティ参照
- **[Recurrence] 再発防止アクション未明記** ── bug fix で「lint化 / 横展開 / guideline追加 / 何もしない」のどれを選んだか PR description に書いていない
- **[AI-Antipattern] 幻覚 API / フォールバック濫用** ── AI が確信を持って書いた間違いコード

これらは **人レビュアーがやろうとしても見落とすことが多い** カテゴリです（特にドキュメント整合性と再発防止判断）。AI に渡したことで、見落としが構造的に減ります。

### false positive

完全にゼロではない。`severity.md` のルールに照らして「これは Major ではなく Nit では？」というケースは月に数件あります。これは人が PR コメントで「これは降格扱い OK」と override します。

ただし、**品質基準の緩和（lint ルールの relaxation、coverage 閾値の引き下げ等）は AI 側が自動で許可しません**。`severity.md` の規定により、AI レビューは relaxation を含む PR を `REQUEST_CHANGES` で必ず差し戻し、**人間の Approve を必須化** しています。

## 失敗モード と Human Override

完璧に動いているわけではなく、いくつか failure mode があります。

### 1. AI が誤指摘するケース

頻度は低いが、AI が「存在しないルール」を引いて Critical を立てることがある。これは人が「該当 guideline にそういう規定はない」とコメントすると、Auto Review 側がそのコメントを context に取り込んで、次の review で訂正します。

### 2. Auto Fix が3回連続失敗

annotation-author の修正試行が3回連続で同じ指摘を再発させた場合、PR に `needs-human` label が立って escalate されます。経験的に、これが立つのは **「AI が現実の system 制約を理解していないケース」**（GCP の特殊な権限要件、外部 API の undocumented 挙動 等）が多い。人が判断して context を補足するか、別アプローチに切り替えます。

### 3. 大規模リファクタ PR

数千行を超える PR では、AI の review context が膨らみすぎて精度が落ちます。これは **「PR を分割する」** という別の guideline で対応しています。 5,000 行超の PR は AI が「これは1 PR の対象として大きすぎる」と REQUEST_CHANGES を返します。

### 4. アーキテクチャ判断レベルの提案

「**そもそもこの方向で正しいか**」レベルの判断は、AI レビューでは決められません。これは設計レビュー or 私（Ryan）の判断に escalate します。Auto Review が出す指摘は **「定義済みのルールに照らした violation 判定」**であって、戦略判断はスコープ外、という線引きをしています。

## 何が変わったか / Bridge to Part 4

cortex の engineer の役割は、ここ半年で「**書く側**」「**見る側**」の両方から「**判断する側**」に移った。

- コードは AI が書く（Claude Code / Codex CLI）
- レビューは AI が見る（Auto Review）
- 修正も別の AI が直す（annotation-author）
- merge も AI の判断 で走る（auto-merge script）
- deploy も並列で走る（Turborepo + Pulumi）

engineer の手元に残っているのは「**AI のレビュー判断が妥当か** を後追いで見る」「**新しい guideline をどこに加えるか** を決める」「**そもそもこの方向で正しいか** を判断する（アーキテクチャ判断）」── すべて judgement の領域です。

世間で言われる「AIで品質が下がる」「レビューが詰まる」という現象は、**ハーネスを書く側だけに広げて、見る側を人に残したまま放置する** から起こる。書く速度だけ上がって、見る側がそのままなら、確かに詰まる。確かに見落とす。

cortex は逆です。**書く側よりも先に、見る側にハーネスを広げた**。「書く側より見る側がボトルネックになる」という Anthropic の知見はそのまま正しい。だからこそ「**見る側もAIに渡す**」が、cortex が選んだ答えになる。

「AIが書いたコードはAIが見る」── これが cortex の Auto Review の核心です。**品質低下とレビュー詰まりは、ハーネスをどこまで広げたかで決まる現象**であって、AI開発そのものの宿命ではない。

---

次回 **Part 4** では、**Alert-Fix** ── 本番のアラートを起点に AI が原因調査 → 修正 PR を起票 → Auto Review に乗せて自動 merge → 自動 redeploy まで完結させる仕組みを取り扱います。Auto Review が PR時点の品質を守るのに対し、Alert-Fix は **production 時点の品質を守る** 役割です。

冒頭の数字には auto-fix 系 PR（=Alert-Fix 由来）も含まれています。**「障害は気づく前に直っている」** が、cortex の現状です。次回お楽しみに。

---

airClosetでは、AIと一緒に新しい開発体験を作っていくエンジニアを募集しています。興味のある方は [airCloset Quest](https://corp.air-closet.com/recruiting/developers/) の採用ページをご覧ください。
