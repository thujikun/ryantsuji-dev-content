# ryantsuji-dev-content

[ryantsuji.dev](https://ryantsuji.dev) ブログの markdown source-of-truth。

## 構成

```
posts/      ryantsuji.dev native frontmatter 付き .md (SoT)
images/     post 本文から参照する画像。CI が R2 bucket に sync
articles/   Zenn-CLI 互換 frontmatter で syndicator が生成する Zenn 配信版
```

### `posts/` (SoT)
ryantsuji.dev の build / deploy はこのディレクトリを読む。frontmatter は `title` / `publishedAt` / `slug` / `lang` / `tags` / `summary` / `cover` / `series` / `seriesOrder` / `draft` / `syndication` を持ち、JA / EN は `<slug>.<lang>.md` の命名で 1:1 で対になる。

`_` で始まるファイル (例: `_minimal-fixture.en.md`、`_draft-example.en.md`) は monorepo 側のテスト fixture。production の post listing から除外される。

### `articles/` (Zenn 配信用、自動生成)
[`@self/syndication`](https://github.com/thujikun/self-management/tree/main/packages/syndication) の Zenn pipeline が `posts/*.ja.md` から変換して書き出す Zenn-CLI 互換 format (`articles/<id>.md`)。手で編集しない。

## 編集ワークフロー

1. `posts/<slug>.<lang>.md` を新規作成 / 更新 (frontmatter 必須)
2. `draft: true` + 未来日時の `publishedAt` を入れれば monorepo 側の schedule-publish workflow が cron で `draft:` を flip する
3. push (branch protection 無し、直 main 可) → 下流 deploy + syndicate workflow が伝播

dev.to は API 経由で別途同期 (`syndication.devto.id` を frontmatter に持つ post のみ)。
