---
title: "[test] Zenn GitHub sync 連携テスト"
emoji: "🤖"
type: tech
topics: ["test"]
published: false
publication_name: "aircloset"
---

これは Zenn GitHub 連携の sync 経路をテストするための記事です。

- `_` prefix slug なので ryantsuji.dev の `/posts` 一覧・RSS に出ない
- `draft: true` なので `getRenderedPost` も null を返す (= URL 直叩きでも 404)
- syndicate CLI に `--include-drafts` を渡すと **Zenn にだけ** push される
- Zenn 側は frontmatter の `published: !meta.draft` 評価で `published: false` = 下書きとして同期される

以下はリンク書き換えテスト。本サイトの他記事への内部 link が Zenn の article URL に書き換わるかも一緒に検証する。

参考: [Agentic Graph RAG MCP](https://zenn.dev/aircloset/articles/341dffee42f454)、[Sandbox MCP](https://zenn.dev/aircloset/articles/65efe9614f8e73)。

検証完了後はこの記事自体を削除する想定。

---

私がCTOをしている株式会社エアークローゼットでは、AIと共に新しい開発体験を作り上げていくエンジニアを募集しています。興味のある方は、ぜひエンジニア採用サイト[エアクロクエスト](https://corp.air-closet.com/recruiting/developers/)をご覧ください！
