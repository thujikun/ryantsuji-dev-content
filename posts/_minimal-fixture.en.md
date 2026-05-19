---
title: "Minimal post (test fixture)"
publishedAt: "2026-01-02"
slug: "_minimal-fixture"
lang: "en"
---

Minimal test fixture used by `$slug.test.tsx`. No headings, no tags — covers the
null branches of TOC rendering and tag-list rendering in `routes/posts/$slug.tsx`.

Slugs prefixed with `_` are excluded from `/posts` listing (production publishing
surface) but remain reachable via direct `getRenderedPost(slug, lang)` (the
`virtual:rendered-posts` lookup that backs `/posts/$slug`) so test fixtures can
be SSR'd without polluting the index.
