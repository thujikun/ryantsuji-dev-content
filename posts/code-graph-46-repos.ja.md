---
title: "40以上のリポジトリに跨るコードベースを、静的解析で一つのナレッジグラフにした話（前編）"
publishedAt: "2026-06-23T08:30:00+09:00"
updatedAt: "2026-06-23T08:30:00+09:00"
slug: "code-graph-46-repos"
summary: "複数サービス合計37リポジトリのair-closet系 + 9リポジトリのmall系 = 計46リポジトリの本番システムのコードベースを、静的解析で1つのナレッジグラフに統合した話。なぜAIにコードベースを理解させるのに「単にコードを読ませる」では足りないのか、なぜ境界ノード(boundary node)を取りに行く必要があるのか、フレームワーク・ライブラリの多様性とどう戦ったか、1月〜3月の試行錯誤を実際のcommit履歴を引きながら振り返る。"
emoji: "🛠️"
tags:
  - "ai"
  - "knowledge-graph"
  - "static-analysis"
  - "typescript"
lang: "ja"
series: "code-graph-deep-dive"
seriesOrder: 1
draft: true
syndication:
  zenn:
    id: "a7cf65cc035572"
    publishAt: "2026-06-23T08:30:00+09:00"
  devto:
    publishAt: "2026-06-23T08:30:00+09:00"
cover: /images/posts/code-graph-46-repos.ja.cover.png
---

みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

今回は、複数サービス合計 **46リポジトリ**に跨る本番システムのコードベースを、静的解析で1つのナレッジグラフに統合した話です。

社内では **code-graph** と呼んでいて、今年の1月から3月にかけて構築しました。

書き残しておきたい論点が3つあります。

- なぜ「コードを読ませる」だけでは足りなくて、**境界ノード**を取りに行く必要があったのか
- 46リポジトリに散らばる多種多様なフレームワーク（jQuery / AngularJS / Express / NestJS / TypeORM / Redux Axios ...）の境界をどう抽出していったか
- 3ヶ月の試行錯誤の結果、何が解けて何が解けなかったか

本記事は前編で、code-graph 自体の構築と苦労、そして残った課題までを書きます。後編では、code-graph を base にしつつ別レイヤーで補強した **service-product-graph (SPG)** の話を予定しています。

## 何のために作ったか

長年積み上がった本番システムのコードベースは、ふつう、次のような状態になります。

- 複数サービス・複数チームが触る
- 各時代のフレームワークが時代ごとに混在している
- APIを叩く側と受ける側、DBを書き込む側と読む側、Eventを発行する側と購読する側が、それぞれ違うリポジトリに住んでいる

このコードベース全体に対してAIに「影響範囲を見てほしい」「ここを変えたら何が壊れるか調べてほしい」と頼みたい、というのが出発点でした。

ただ、コード自体に手を入れて（例えば全リポジトリにアノテーションを一斉に振って）AIが読みやすい形にする、というのは現実的ではありません。本番システムは複数チームで動いていて、外側から勝手にコメントを足すような変更を入れることは難しい。

だから、選択肢は1つでした。

> **コード自体は一切変更せず、外側から静的解析でナレッジグラフを作る**

これが code-graph の出発点です。

## 規模感: 46リポジトリ

対象は2つの graph に分かれています。

- **air-closet graph（37リポジトリ）**: airCloset（本体）、Spot RENTAL（都度利用型レンタル）、bridge（法人向け）、airCloset Men's など、**複数サービスを横断**して1つの graph になっています。サービス間でデータやAPIの繋がりがあるので、別々の graph にすると追えなくなる依存関係を1つの graph にまとめている形です
- **mall graph（9リポジトリ）**: airCloset Mall（家電などのレンタル）系

合計で **46リポジトリ**。

ポイントは、「1サービスで37リポジトリ」ではなく、**複数サービスの集合**で37リポジトリ、という点です。サービス境界そのものを跨ぐ依存関係をクロスリポジトリのedgeとして見えるようにしているのが、このあと出てくる**境界ノード**の話に繋がります。

## なぜ境界ノードが重要なのか

ここがこの記事の中心です。

AIにコードを理解させるとき、目の前にあるコードや、その横にあるコードを「読ませる」のは、別に難しくありません。grepして該当ファイルを開いて読ませる、これで十分機能します。場合によっては関数の呼び出し関係を tree-sitter で graph 化すれば、もう一段先まで辿れます。今の Claude Code でも普通にできることです。

そして実は、**tree-sitter が作れる graph も、この「読ませる」に毛が生えたくらいの価値しかありません**。同じファイル内、せいぜい同じリポジトリ内の関数呼び出しを構造化するだけ。「目の前のコードを読ませる」に「呼び出し先を辿る」が加わる、その程度です。

**本当に解きたい問題はそこではない**、というのが今回伝えたいことです。

実現したいのは、こういう類の把握です。

- **同じAPIを叩いている処理が、別のリポジトリにもあるかもしれない**
    - フロントエンドのA repoと、夜間バッチのB repoが、同じ `/v1.14/me/plan` を叩いている可能性
    - 片方の repo だけ見ていても、AIには絶対に分からない
- **同じDBテーブルを参照しているコードが、バッチにあるかもしれない**
    - サービス側の処理を修正したいときに、別の場所のバッチが同じテーブルを読み書きしている可能性
    - 影響範囲を取り違えると、データ不整合が起きる
- **このイベントを購読している subscriber が、把握しきれていないかもしれない**
    - Pub/Sub のような分散通信で、emit側を見るだけでは subscribe 側を網羅できない
    - 知らない場所で別の処理が走る

要するに、「**境界の先にあるコード**」をAIにハルシネーションを起こさせずに把握させること。これが目的です。

境界ノードを取れていれば、AIは「このAPIは他にも〇〇 repoで叩かれています」と**事実として**答えられます。推論ではなく、決定論で渡せる。

AIは「分からないこと」を「分からない」と返すより、見えている範囲で何かしら返してしまう傾向があります。ここで起きるのが、サイレントなハルシネーション。AI自身も、それを受け取る人間も気付かない誤答です。境界ノードは、これを物理的に塞ぐ anchor になります。

## 構築: tree-sitter ベース、必要なところで TypeScript Compiler を併用

通常のコード（関数呼び出し / クラス継承 / import関係）は、tree-sitter で**比較的簡単に**取れます。ASTを辿って関数 / メソッド / クラス / フィールドをノードにして、参照関係をエッジで結ぶ。これは粛々とやるだけです。

ただ、tree-sitter は構文木を作るのは得意ですが、**型情報やスコープ解析は弱い**。フィールドアクセス（`user.preferences.theme` のようなチェーン）を正確に追うには、変数 `user` がどの型でどう定義されているかを解決する必要があります。これは tree-sitter 単体だと手が届かない。

そこで、ここだけ TypeScript Compiler API を併用しています。構造抽出は tree-sitter、変数解決は TypeScript Compiler、と役割を分けて精度を上げています。

エッジは21種類定義してあります。

- `CALLS`（関数呼び出し）/ `EXTENDS`（継承）/ `IMPLEMENTS`（interface実装）など、tree-sitter で取れる基本的な構造
- `CALLS_API`（caller側）/ `HANDLES_API`（handler側）── API境界
- `EMITS_TO`（emitter側）/ `SUBSCRIBES_TO`（subscriber側）── Event境界
- `WRITES_TO` / `READS_FROM` ── DB境界
- などなど

**通常のコード関係（CALLS / EXTENDS / IMPLEMENTSなど）は、ここまでで一度終わり**。問題はこの先、境界エッジ（`CALLS_API` / `HANDLES_API` / `EMITS_TO` / `SUBSCRIBES_TO` / `WRITES_TO` / `READS_FROM`）を取りに行く、ここからが本当の戦いです。

## 境界ノード抽出の苦労: 1月〜3月の試行錯誤

通常のコードと違って、境界（APIエンドポイント / DBテーブル / Eventトピック）は、フレームワーク・言語・技術領域・ライブラリ・リポジトリ・書いた人によって、**書き方がバラバラ**です。

同じ「APIエンドポイントを定義する」という意味の処理でも、Expressで書くか、NestJSの `@Get()` デコレーターで書くか、TypeORM経由で書くかで、まったく違うAST形になる。さらに、同じリポジトリの中でも複数パターンが混在することがある。

これを46リポジトリ x 多様なフレームワークすべてに対して取りに行く必要がありました。

実際に当時のgit履歴を覗くと、毎週のように新しいparserやdetectorが足され、ノイズフィルタが追加され、概念整理が入っています。ここに1月から3月にかけての主要なcommitを時系列で並べてみます。

### 1月: スタート、そして tree-sitter だけでは足りないと気付く

- **2026-01-15** ─ `feat(graph-rag): add TypeScript parser with tree-sitter` ── ここからスタート
- **2026-01-15** ─ `feat(graph-rag): add graph builder with BigQuery storage` ── BigQuery に書き込む形に
- **2026-01-19** ─ `feat(graph-rag): add TypeScript Compiler-based variable resolution for field extraction` ── **tree-sitter だけでは変数の型解決ができない**ことが見えて、TypeScript Compiler API も併用する形に変更

### 2月: 多様なフレームワークへの対応とノイズとの戦い

- **2026-02-02** ─ `feat(graph-rag): add frontend parser for jQuery/Vanilla JS codebase` ── **jQuery / Vanilla JS** のフロントエンドコード
- **2026-02-03** ─ `feat(graph-rag): add AngularJS Page detection for frontend BFS` ── **AngularJS** のページ検出（古いフレームワーク、まだ現役で動いている）
- **2026-02-15** ─ `refactor(code-graph): consolidate 18 MCP tools into 5 with deep subgraph traversal` ── ツールが18個に膨らんでいたのを5個に整理（このタイミングで `code-graph` という名称に統一）
- **2026-02-18** ─ `fix(code-graph): reduce graph noise by filtering Type nodes, external lib CALLS, and Storybook files` ── ノイズ削減: Typeノード / 外部ライブラリのCALLS / Storybookファイルをフィルタ
- **2026-02-19** ─ `fix(code-graph): extract path aliases from tsconfig paths in addition to make-symlink` + `fix(code-graph): resolve @alias path imports for CommonJS symlink patterns` ── **path alias解決の苦労**: tsconfig paths と make-symlink、さらに CommonJS の symlink パターン、3通りの仕組みに対応
- **2026-02-19** ─ `feat(code-graph): add stop_at=boundary option to trace_connections` ── 境界で停止するオプション（走査範囲の明示制御 / ノード爆発対策）
- **2026-02-21** ─ `feat(graph): add typeORM JOIN detection, NestJS decorator parsing, Fetcher API detection` ── **TypeORMのJOIN / NestJSのデコレーター / Fetcher API** 対応
- **2026-02-21** ─ `fix(graph): pass fullFileCode to Redux Axios variable resolver for scope-based extraction` ── **Redux Axios** の variable resolver 修正

### 3月: 概念整理と細かな精度向上

- **2026-03-08** ─ `refactor(code-graph): rename __external__ to __boundary__` ── **概念整理**: 「外部リソース」ではなく「境界ノード」という呼び方に統一
- **2026-03-08** ─ `feat(code-graph): add taleclo graph with 5 parser fixes` ── 新リポジトリ追加 + 5 parser 修正
- **2026-03-16** ─ `refactor: remove db-dictionary from code-graph stack` ── DBスキーマ側を扱う db-dictionary を別 graph として独立進化
- **2026-03-24** ─ `fix(code-graph): infer table names from dynamic variable names` ── 動的変数名からのテーブル名推定
- **2026-03-24** ─ `feat(code-graph): add orphan boundary node cleanup script` ── 孤立した境界ノードのクリーンアップスクリプト

### このタイムラインから見える話

毎週、新しいフレームワークやパターンへの対応が入っています。「境界ノードを取りに行く」という作業は、要するに**多種多様な書き方それぞれに parser を足していく**作業です。

具体的に登場したフレームワーク / 仕組みだけ並べても、こうなります。

- tree-sitter（TypeScript / JavaScript）
- TypeScript Compiler（variable resolution）
- jQuery / Vanilla JS
- AngularJS
- TypeORM（DBのJOIN検出）
- NestJS（デコレーター parsing）
- Fetcher API
- Redux Axios（variable resolver）
- Express
- path alias の3通り（tsconfig paths / make-symlink / CommonJS symlink）

単に「TypeScript静的解析」と言って収まる話ではありません。air-closet 系のコードベースは長く動いてきた本番システムの集合体で、各時代のフレームワークが共存しています。それぞれの時代の「ここにAPIエンドポイントがある」「ここでDBを叩いている」「ここでEventを購読している」という意味を、ASTから拾い上げる必要がありました。

### なぜそこまで精度にこだわるか

90%の精度では使い物にならないからです。

たとえば「このAPIを叩いている処理を全部出して」という用途で90%の精度しか出なければ、10%の処理はAIから見えない。影響範囲を調査するために code-graph を使う場合、**この見えなかった10%が事故を起こします**。

新しい境界パターンが見つかるたびに独自パーサーを書き足して、99%超えるまで詰める。これを **3ヶ月、ずっとやり続けました**。

## 境界分析の運用 ── 今も毎日動いている

ここまで作った code-graph は、今も毎日動いています。

具体的には、毎日JST 7:00に**境界分析のcron**が動いています。やっていることは:

- **API境界**: `CALLS_API`（caller側）と `HANDLES_API`（handler側）のマッチングを取って、リポジトリを跨いだ接続率を集計
- **Event境界**: `EMITS_TO`（emit側）と `SUBSCRIBES_TO`（subscribe側）のマッチング
- **DB境界**: `WRITES_TO` と `READS_FROM` が**異なるリポジトリから**同じテーブルを参照しているケースを集計（= リポジトリ間の暗黙的なDB依存）

集計結果を毎日比較して、接続率が前回比5%以上劣化していたら、Grafana経由でアラートを上げます。

これは「**境界ノードを取れている前提**」で初めて成立する運用です。「取れている境界の質」そのものを日次で監視している、というメタな仕組みになっています。「parser が新しいパターンに対応できておらず境界が見えなくなった」「リポジトリの構成が変わって path alias が解決できなくなった」── そういう変化を翌朝には検知できる状態になっています。

## それでも残る課題

ここまでやっても、いくつか根本的に解けない課題が残ります。

### 1. セマンティック検索ができない（入口の問題）

ノードテーブルには `embedding` カラムが存在するのですが、実体は埋まっていません（充足率0%）。検索MCPツールも、LIKE による文字列部分一致のみです。

つまり、「会員のサブスク料金計算」のような自然言語クエリで関連コードを引きたい場合に、**関数名やファイル名を知っていないと辿れない**。これだと、AIが agentic に walk-through する起点（= anchor node）が見つけにくい。

「コードベース全体を知っているのはAIの方ではなく code-graph」という目論見だったのですが、入口で詰まる構造になっています。

### 2. ノード爆発

tree-sitter でASTを素直にグラフ化すると、builtin function や無名関数、内部 utility まで全部ノードになります。実用上は不要な「この `map` 呼び出し」「この内部 helper」まで全部ノード化されてしまう。

trace_connections のような走査を回すと、数ホップで helper や型や primitive を巻き込んでノード数が爆発します。「関連性で絞る」ための軸が、グラフ構造の中にありません。

`stop_at=boundary` のような明示制御で運用上は逃げていますが、根本対処ではありません。

### 3. 関数の中身は結局ファイルを見ないと分からない

graph で「ここに何かある」「ここから別の repo の処理を呼んでいる」までは分かります。でも「この関数が具体的に何をしているか」は、結局ファイルを開いて読まないと分からない。

graph 単体では時間がかかります。後に作ったコードベース調査ツールでは、graph から候補ファイルを絞った上で Git Server MCP + Gemini Context Cache に渡して読ませる、という形で逃げていますが、graph 単体での解像度の限界はそのまま残ります。

### 4. 新しい境界パターンが出るたびに parser を書き足す運用負荷

フレームワーク / ライブラリが新しく入るたびに、「そのフレームワークでは境界をこう書く」を学んで parser を書き足す必要があります。

すでに parser ディレクトリには10個以上の独自 detector / extractor が並んでいます。維持と拡張のコストが下がる兆候はなくて、**新しい技術スタックがコードベースに入ってくるたびに同じ作業を繰り返す**ことになります。

## 余談: 別の場所では別の判断 ── cortex の話

:::message
**注記**: 以下で言及する「cortex」は、airCloset社内で独自開発したAIプラットフォームの内部コードネームです。Snowflake CortexやPalo Alto Networks Cortex等の既存商用サービスとは一切関係ありません。
:::

ここまで code-graph の話を書いてきましたが、余談として、自分は別途、**cortex** という社内AIプラットフォームを1から作っているプロジェクトを持っています（今は100+ appsの1モノレポ）。

そちらでは、code-graph と同じ静的解析ベースのアプローチは**最初から使わない判断**をしました。代わりに、**アノテーションベースの product-graph** に倒しています。

- 自分が組み立てているモノレポなので、アノテーションを一斉に振る前提が置ける
- `@graph-*` JSDoc タグでコード自体に意図を書き込み、それを graph 化する設計
- セマンティック検索も embedding 100%充足、VECTOR_SEARCH が稼働している

この「意図をコードに書き込んで graph 化する」という判断と、その判断に至るまでの試行錯誤については、別連載で詳しく書いています。興味があれば: [AIハーネス連載 Part 6（連載総括）](/posts/cortex-philosophy)

## 本番システム側にはアノテーションベースは現実的ではない

そして、今回 code-graph で扱っている本番システム側に同じアプローチが取れるかというと、これは無理です。

- 46リポジトリ全てにアノテーションを一斉に振るのは、現実的ではない
- 長年動いている本番システム、複数チームが触っている、フレームワークもバラバラ
- 「コードにアノテーションを入れる」という前提が成立しない

だから、code-graph（静的解析ベース）を base にしつつ、**別レイヤーで補強する方向に進化させる**、という選択を取りました。

進化の方向は、静的解析だけだと「意味の入口がない」という問題に対して、別の graph レイヤーで補強する形です。

- **db-graph** でDBスキーマ側を意味付け
- **service-product-graph (SPG)** で、Api / Page / Task の粒度で意味付け + embedding検索
- SPG は code-graph の細粒度ノードを、上位フロントドアとしてプロキシする構造

このあたりが**後編**のテーマになります。

## つづく

前編はここまでです。後編では、code-graph を base にして上位レイヤーで補強した service-product-graph (SPG) の話を書く予定です。

「捨てた」のではなく「**進化させた**」、というのが本当のストーリーです。

長文をお読みいただきありがとうございました。
