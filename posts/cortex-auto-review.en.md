---
title: "Code Written by AI Is Reviewed by AI ── A Structural Answer to Review Bottleneck and Quality Drop (Series Part 3)"
publishedAt: "2026-05-26T08:30:00+09:00"
updatedAt: "2026-05-26T08:30:00+09:00"
draft: true
slug: "cortex-auto-review"
summary: "Series Part 3: a structural answer to the common AI-development critiques — review bottleneck and quality drop. Full Auto Review pipeline in cortex: webhook ingestion → cpg context → AI review tagged [Graph] / [Doc] / [Impact] / [Security] → auto-fix by a separate AI → re-review → auto-merge → parallel deploy."
tags:
  - "ai"
  - "devops"
  - "codereview"
  - "webdev"
lang: "en"
series: "building-ai-harness"
seriesOrder: 3
syndication:
  devto:
    publishAt: "2026-05-26T07:00:00-07:00"
cover: /posts/cortex-auto-review.en.cover.png
---


Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

> **Disclaimer**: "cortex" referenced in this article is the internal code name for an AI platform developed in-house at airCloset. It is unrelated to existing commercial services such as Snowflake Cortex or Palo Alto Networks Cortex.

In [Part 1 (Series Intro)](/posts/ai-harness-intro), I wrote about how **AI handles PR reviews and incident response** on top of cortex. In [Part 2 (Product Graph)](/posts/cortex-product-graph), I went deep on **cpg** — the unified knowledge graph of code, docs, DB schemas, and infrastructure.

This post is about **Auto Review** — the pipeline where AI reviews PRs, AI fixes the issues, and AI merges them. I'm framing it as a **structural answer** to the two most common critiques of AI-assisted development: "AI just shifts the bottleneck to reviewers" and "AI-written code drops the quality bar."

## Series

| # | Theme | Key scene | Article |
|---|---|---|---|
| 1 | Series intro: cortex harness | PRs merging unattended / incidents fixed before anyone notices | [ai-harness-intro](/posts/ai-harness-intro) |
| 2 | Product Graph (cpg) | code / docs / DB / infra unified into one graph | [cortex-product-graph](/posts/cortex-product-graph) |
| 3 | Auto Review | webhook → AI review → auto-fix → squash merge | This article ← you are here |
| 4 | Alert-Fix | alert → AI investigation → fix PR → auto redeploy | Coming soon |
| 5 | Observability + quality gates | OTel/Faro + "never lower the bar" design | Coming soon |
| 6 | Non-engineer dev experience | non-engineers ship PRs, AI review enforces quality | Coming soon |

## Start with yesterday

<!-- TODO: refresh numbers from GitHub at publication time -->

On 5/20, cortex merged **38 PRs in a single day**. **12 of them were `auto-fix`** — PRs where an AI traced an alert to its root cause, wrote the fix, opened the PR, passed Auto Review, and merged itself. By 7am local time, 7 had already merged. One example: PR #1287 opened at 03:13, merged at **03:19 — six minutes total**. No human touched it.

This is a typical day on cortex now.

The rest of this post unpacks the pipeline that makes the common critiques — "review will bottleneck" and "AI code quality is unreliable" — **structurally not apply** here.

## Why the "AI shifts the bottleneck to reviewers" critique stops working here

<!-- TODO: industry critique → bottleneck shift (Anthropic dogfooding insight) → cortex's structural answer -->

### The critique: reviewers are the new bottleneck

As AI accelerates writing, the load on reviewers grows proportionally. Anthropic has stated explicitly from their own dogfooding that **the bottleneck moves from writing to reviewing** ([reference TBD]).

This is a real phenomenon. cortex hit it too.

### cortex's answer: the reviewer is also AI

This is the same recurring question across Part 1 and Part 2 — **how far do you push the harness?** — and cortex went all in: **code written by AI is reviewed by AI**. Humans only look at "is the AI's review judgment correct" on the rare cases that escalate.

For this to actually work, three things have to be true:

1. **The AI reviewer has enough context** — beyond the diff itself, it needs business meaning, upstream/downstream impact, history of related incidents → **solved by cpg (Part 2)**
2. **The review output is consistent** — not improvisation, but rules that are explicit and reviewable → **public review guidelines (see below)**
3. **False positives don't gate everything** — if every false-positive blocks merges, the org grinds to a halt → **severity tiers (Critical / Major / Minor / Nit) with explicit no-downgrade rules**

<!-- TODO: dive into each -->

## Auto Review system layout

<!-- TODO: system flow diagram: webhook → cpg query → review LLM → comment / auto-fix → merge → deploy -->

<!-- TODO: implementation:
- Cloud Run Service (annotation-author / annotation-reviewer)
- worktree per PR (isolation)
- cpg loaded as full context
- per sub-agent loads one guideline file (link to cortex-review-guidelines repo)
-->

## Review output: tags and severity

<!-- TODO: tag set: [Graph] / [Doc] / [Impact] / [Security] / [Architecture] etc.
Severity: Critical / Major / Minor / Nit
Real PR comment examples
Link to the public review guidelines repo
-->

The full review rules cortex actually uses are now public: **[air-closet/cortex-review-guidelines](https://github.com/air-closet/cortex-review-guidelines)** (Japanese + English).

## Auto Fix — separate AI that fixes and re-pushes

<!-- TODO:
- On REQUEST_CHANGES, a separate AI (annotation-author) starts
- Tries fixes inside a worktree → pushes back
- Re-review loop
- After 3 failed attempts → escalate to human
-->

## Auto-merge + parallel deploy

<!-- TODO:
- Once all Critical/Major are clear → auto-merge
- Turborepo + Pulumi → multiple stacks deploy in parallel
- cpg index rebuilds in step
-->

## Hit rate and quality numbers

<!-- TODO: from actual data:
- Auto Review Critical-block count per week
- False-positive rate
- Trend of human review involvement
- Auto Fix success rate
- Defect rate before vs after Auto Review introduction
-->

## Failure modes and human override

<!-- TODO:
- When AI gets the call wrong
- When Auto Fix can't recover
- How humans override (PR label / manual approve)
- Why quality-standard relaxations always require human approval
-->

## What changed / Bridge to Part 4

<!-- TODO:
- Engineer role shifted from "writer/reviewer" to "architect/judge of the AI reviewer"
- N PRs/day flow through without human touch
- Quality metric improvements
- Bridge: if Auto Review protects quality at PR time, Alert-Fix protects it at production time (Part 4)
-->

---

Coming up in **Part 4**: **Alert-Fix** — production alerts trigger an AI that investigates, opens a fix PR, runs it through Auto Review, and auto-redeploys. Where Auto Review protects quality at PR time, Alert-Fix protects it at production time.

---

At airCloset we're hiring engineers who want to build a new development experience with AI. If that sounds interesting, check out [airCloset Quest](https://corp.air-closet.com/recruiting/developers/).
