---
title: "Building a Real AI Harness: Auto-Reviewed PRs, Self-Healing Ops, and Non-Engineer Contributors (Series Intro)"
publishedAt: "2026-05-12"
updatedAt: "2026-05-16"
slug: "ai-harness-intro"
summary: "Series intro to cortex, airCloset's internal AI platform that auto-reviews PRs, self-heals ops, and lets non-engineers ship apps. Why harness engineering matters now."
tags:
  - "ai"
  - "devops"
  - "graphrag"
  - "webdev"
lang: "en"
series: "building-ai-harness"
seriesOrder: 1
syndication:
  devto:
    id: 3655760
    slug: "building-a-real-ai-harness-auto-reviewed-prs-self-healing-ops-and-non-engineer-contributors-3lfa"
cover: /posts/ai-harness-intro.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

In my previous posts I've introduced [the full picture of our 17 internal MCP servers](/posts/17-mcp-servers), [an MCP server that searches 991 internal tables in natural language](/posts/db-graph-mcp), [a custom Graph RAG for measuring initiative impact](/posts/initiative-graph-rag), and [the Sandbox MCP that lets non-engineers publish AI-built apps safely](/posts/sandbox-mcp).

All of those run on top of an internal AI development platform we call **cortex**. This post is the first in a series about cortex itself — the platform, the design choices, and the operational experience.

## Two Scenes, Up Front

### Scene 1: PRs merge themselves

Monday morning. An engineer implements a feature locally, pushes a branch, opens a PR.

- A few minutes later, the AI reviewer comes back with REQUEST_CHANGES. Multiple comments:
  - "This data formatting duplicates `formatRow()` in the shared package. Please consolidate."
  - "You changed an API response type, but the related docs (`docs/api/...`) still describe the old shape."
- A separate AI agent spawns a worktree, applies the fixes, pushes a follow-up commit
- Re-review comes back as APPROVE
- Auto squash-merge
- GitHub Actions detects only the changed stacks and deploys them to Cloud Run / Cloudflare Pages

**No human touched any of this**. The engineer refreshes the PR tab and notices it's already merged.

### Scene 2: Incidents fix themselves before you notice

7 AM. A Grafana alert fires: "BQ pipeline failed 3 times in a row."

- An AI receives the webhook, fetches the error logs from Loki via the **Grafana MCP**
- Walks the **Product Graph** (implementation name: `cortex-product-graph` — a unified knowledge graph of the codebase, docs, DB schemas, and infrastructure definitions; covered later in this post and in Part 2) to trace the pipeline's code, dependent tables, and related docs, identifying the root cause
- Opens a fix PR
- AI reviewer APPROVE → auto squash-merge → automatic redeploy

By the time the engineer logs in at 9 AM, Slack already shows: "pipeline patched." The only incidents engineers personally handle are the ones AI genuinely can't crack.

![Two automation loops](/images/posts/ai-harness-intro/0kuzjonpzd1rcb9k1iiw.png)

What's behind both scenes is the dev environment described in the rest of this post.

## Industry Context — "Harness Engineering"

Before I get to cortex, one paragraph of context. Over the past six months, **the practice of building proper foundations for AI agents in production** has crystallized into a recognized industry trend.

"Harness" itself isn't a new word. In AI specifically, it traces back to **EleutherAI's [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) (2020)** — the LLM evaluation framework that put the term in active use. What changed in the past six months is its elevation into an engineering discipline for **LLM agents in production**:

- **Feb 2026**: OpenAI published ["Harness engineering: leveraging Codex in an agent-first world"](https://openai.com/index/harness-engineering/), describing how a small internal team led by Codex shipped **1 million lines in 5 months**
- A few days later, Mitchell Hashimoto (HashiCorp co-founder, Terraform creator) distilled it into the formula `Agent = Model + Harness`
- **April 2026**: Martin Fowler (author of *Refactoring*, ThoughtWorks Chief Scientist) published ["Harness engineering for coding agent users"](https://martinfowler.com/articles/harness-engineering.html), establishing the **Guides (proactive controls) / Sensors (reactive controls)** framing
- Same month: Anthropic and Cursor each published their own harness write-ups

The catchphrase that's gone viral: **"2025 was the year of agents. 2026 is the year of harnesses."**

The framing is: **the model itself is rapidly commoditizing** (the gap between Claude / GPT / Gemini is narrowing from the user side). Where you actually get differentiation is **how you design the harness — the foundation that lets AI run in production**.

cortex is most cleanly read as **a real attempt to build that "harness" inside a real company**. In this post I'll organize cortex using Fowler's Guides / Sensors framing.

From here, I'll show **how the "harness beats model" thesis takes concrete shape on cortex**.

## Who Builds the Code

For the first few months, **I built 100% of cortex by myself**. The accurate framing isn't "without a harness, others can't safely PR" but rather "**without a harness, no one — including me with extra hands — could ride this thing**."

Even back then, between [our Google Meet recording pipeline](/posts/meeting-intelligence) (Japanese), about half of the [17 MCP servers](/posts/17-mcp-servers), and a long tail of unpublished features, **roughly 50 loosely-coupled applications were already running**. Each one had its purpose, background, and data flow documented carefully. But the volume was such that **even with AI in the loop, you couldn't realistically have it read all the relevant docs and absorb the whole picture for any given change**. The codebase had outgrown what a person — or an AI given pieces — could hold in their head at once.

Recently, with the harness in place, **non-engineers** (business-side managers, PMOs, etc.) have started shipping PRs to cortex too. As of writing, the cumulative commit ratio is **~91% me, ~9% other recent contributors**.

If you imagine non-engineers opening PRs against a production repo, "can quality really hold?" is the obvious question. In cortex, the answer is yes, because **AI review and automation own the quality gates**:

- PRs missing annotations, tests, or lint cleanliness get REQUEST_CHANGES from the AI reviewer
- A separate AI agent applies the fixes
- Until everything is satisfied, nothing merges

So whoever writes a PR — engineer or not — **at the moment it merges, the same quality bar is met**. The key point: it's not "you can write freely," it's "**you can write inside rails that don't let you derail**." The author's job stops at "communicating the intent precisely"; the harness owns code correctness.

The shift is from "**X could write that because they're X**" to "**X can write that because of cortex**." That property only emerges once the harness is built — and it's the core of cortex's design.

## What's Running

cortex consists of microservices, jobs, MCP servers, web frontends, Cloudflare Workers, and so on. As of writing, there are **123 apps**. The features I've already covered in past posts are each composed of multiple apps — but even adding them up by feature, **only about 10% of cortex has been written about**. The remaining 90% hasn't appeared in a post yet. A few examples:

- **A unified product UX measurement web app** — UX metrics, screen analysis, funnels, and error analysis in one place
- **A dev-org portal web app** — KPIs (bug rate, etc.), per-member GitHub Activity, QA evaluation results, plus an AI chat that answers natural-language questions about KPIs via Agentic RAG
- **A family of Slack bots** for operational support:
  - A config bot that lets you manage job configurations (DBs, attendance SaaS, Google Drive, etc.) directly from Slack
  - An accounting-assist bot that takes invoice OCR and drafts payment requests / expense filings in our accounting SaaS
  - In-channel knowledge search, issue/request management, meeting creation; a BigQuery cross-table RAG bot; a Google Drive cross-corpus RAG bot
  - A marketing bot that returns insights (trend, creative analysis) from BigQuery marketing data
- **An APM auto-analysis agent** that runs daily on monitoring-SaaS APM data, detects performance issues, and opens tickets in our issue-tracking SaaS
- **An AI-bot auditor bot** that runs E2E tests against the Slack bots above and detects spec drift

…and so on. **Each will get its own dedicated post later in the series.**

Scale at a glance:

|  | Count |
|---|---|
| apps (microservices, jobs, MCP servers, web, etc.) | **123** |
| packages (shared libraries) | 66 |
| MCP servers | 19 |
| Pulumi stacks | 110 |
| TypeScript (implementation) | ~**630K lines** |
| Tests | ~**560K lines** |
| Markdown documentation | ~**110K lines / 389 files** |
| Duration | ~**5 months** (intensive development: ~4 months) |
| Merged PRs | ~**790** |

## The 4-Element Flywheel — cortex's Harness

What lets "**~4 months of intensive dev, mostly solo**" coexist with "**non-engineers shipping into the same repo**" is a harness design that **delegates quality to AI and automation across every layer**.

cortex's harness is structured as a **flywheel** of 4 elements, mapped to Fowler's **Guides (proactive) / Sensors (reactive)** split, that **mutually reinforce one another**.

![cortex AI Harness Flywheel](/images/posts/ai-harness-intro/i2xoe4l8e8m4od7iv7z2.png)

### ① Product Graph (Guides — supplying the right context)

All of cortex — **code, documentation, DB schemas, infrastructure definitions** — is indexed in real time as a single unified graph. It's queryable via MCP through **semantic search**.

"Where is the code that calculates this KPI?" → "Which BQ tables does that code touch?" → "What are those tables' column definitions?" → "What docs are related?" — all of these can be answered from a single query traversal. That graph becomes the context source for everything the AI does.

This is the foundation that **"structurally reduces how often the AI gets confused."** Where grep tells you "where the string appears," the Product Graph tells you "**what is connected, why, and how**." Implementation details come in Part 2.

### ② Lint / Quality Gates (Guides — physically blocking deviations)

`eslint-disable` / `oxlint-disable` are forbidden anywhere in the repo. In hand-written code, occurrences of `: any` / `as any` / TODO / FIXME are **0** (excluding generated files and unavoidable external-library cases). **Type checking** (using **tsgo** — Microsoft's Go port of the TypeScript compiler, ~10× faster than `tsc`; we use it to keep CI time down) runs on the entire codebase in CI.

On top of that, test coverage is enforced at **≥90% for statements / branches / functions / lines**. **Lowering the threshold to pass is forbidden** — you write tests instead.

With every escape hatch sealed, **even when the AI writes wrong code, it doesn't merge**. This is also what stabilizes AI review judgments downstream.

### ③ Auto Review (Sensors — auto-fixing until the bar is met)

Scene 1 above is exactly this. The implementation-side note: **AI review here isn't "lint with extra steps" — every comment is grounded in Product-Graph traversal of the actual impact**. That's where it earns its keep. To give you a feel, comments that actually fire fall into categories like:

- **\[Graph\] Critical** — missing annotation that breaks an edge in the graph
- **\[Impact\] Critical** — a BQ MERGE statement referencing a column not present in the existing target table; would fail in production
- **\[Doc\] Critical** — code change that left related docs stale
- **\[Security\] Minor** — `execSync` doing string interpolation on an env var, opening a command injection vector

What you might mentally classify as "AI review" — surface-level — isn't this. **Comments here are produced with the entire codebase carried as context**, which is what the Product Graph integration buys you.

The only PRs that actually need a human are "AI review hits a hard case." Day-to-day PRs go from push to merge without anyone touching them.

### ④ Alert-Fix (Sensors — re-injecting production anomalies into the loop)

Scene 2 above is exactly this. Starting from a Grafana alert, the AI traces the root cause through Product Graph + Loki + git blame, opens a fix PR, and pushes it through ③ Auto Review until it's auto-merged. **Re-injecting anomalies into the loop** is the essence of Sensors. Details in a later post.

### What Makes It a Flywheel

These 4 elements **mutually reinforce one another**:

- ① Product Graph exists, so ③ Auto Review can comment with real impact awareness
- ② Lint enforces the ground rules, so ③ Auto Review can assume "everything in the codebase meets the bar"
- ③ Auto Review exists, so new code lands in ① Product Graph with correct semantic annotations
- ④ Alert-Fix's incidents loop back through ③, maintaining the quality bar all the way back to ①

**The harness's effectiveness scales with the size of the codebase**, not against it.

### Supporting Foundations

Three foundations make the 4 elements possible (covered in detail in Part 5):

- **Tests and coverage**: ~630K lines of implementation, ~560K lines of tests (**impl : test ≒ 1.13 : 1**)
- **Documentation**: ~110K lines / 389 files, written **for both humans and AI**, also ingested as Document nodes in the Product Graph
- **Observability**: Frontend = Faro, backend = OTel, infrastructure and CI logs all consolidated in Grafana. **The AI sees the same data humans see.** Gemini API token usage and cost are tracked separately in Prometheus.

## Technical Foundation

cortex is a **full-TypeScript monorepo**.

| Layer | Stack |
|---|---|
| Applications (`apps/`) | TypeScript (Hono, TanStack Router, Vite, etc.) |
| Shared packages (`packages/`) | TypeScript |
| Infrastructure (`infra/`) | TypeScript (**Pulumi**) |
| Edge (`worker/`) | TypeScript (Cloudflare Workers) |
| Lint plugins | TypeScript |
| Doc scripts | TypeScript (tsx) |

Having everything in one language is **a much bigger win when viewed from the AI's side** than from a human's. Specifically:

- **You can feed the AI ASTs and type definitions directly as context** — no language boundary fragments the picture
- **Refactors don't cross language boundaries** — one ESLint plugin can inspect and auto-fix `apps/`, `packages/`, and `infra/` together
- **Edges don't break in the Product Graph** — for example, a Cloud Run service definition (`infra/`, TS) connects in a single graph to the Hono route (`apps/`, TS) it actually invokes

When you ask the AI "what does this change affect?", the reason it can hop `infra → apps → packages` and answer in one round-trip is that all of this is one language.

Build is parallelized via [Turborepo](https://turbo.build/) and [pnpm workspaces](https://pnpm.io/). Deploys go through GitHub Actions, which **detects only changed stacks** and applies them in parallel via Pulumi.

## Numbers (snapshot at time of writing)

![Scale](/images/posts/ai-harness-intro/nn4g1ogy3j3i2dsp3rwm.png)

|  | Value |
|---|---|
| Duration | ~**5 months** (intensive development: ~4 months) |
| Commits | ~**4,000** |
| Merged PRs | ~**790** |
| % of commits authored by me | ~**91%** |
| apps | **123** |
| packages | 66 |
| MCP servers | 19 |
| Pulumi stacks | 110 |
| TypeScript (implementation) | ~630K lines |
| TypeScript (tests) | ~560K lines |
| Markdown documentation | ~**110K lines / 389 files** |
| `as any` / TODO / unjustified lint-disable in hand-written code | **0** (excluding generated files / unavoidable external-library cases) |
| Coverage gate | **90%** (statements / branches / functions / lines) |

### The PR-flow Switch That Multiplied Throughput

Up until April, **I was AI-assisted reviewing every change carefully on my own machine and then committing directly to main**. The review bar was unchanged, but throughput was bottlenecked on my hands.

In April, switching to **fine-grained, PR-based operation** (auto review → auto fix → auto merge) dramatically changed the per-month merged-PR count:

| Month | Merged PRs |
|---|---|
| 2026-02 | 10 |
| 2026-03 | 23 |
| **2026-04** | **518** |
| 2026-05 (through the 10th) | 235 |

A **~22× jump** between March and April. Total commits actually went down (because committing directly to main was replaced by going through PRs), so this isn't "I wrote more code." This is "**the manual review step got replaced by the harness, and the throughput ceiling moved**." **The 22× is exactly the moment a human reviewer was swapped for Auto Review** — clean evidence of the flywheel property where the harness's effectiveness scales with codebase size.

### What's Required for These Numbers to Hold

These numbers are **not explained by "we use AI" alone**. The prerequisites:

- **Full TypeScript monorepo** — code, tests, infrastructure, scripts all under one static-analysis system
- **Composable Architecture** — `packages/` holds reusable parts; `apps/` compose them. Direct imports between `apps/` are forbidden — everything routes through `packages/`. This is what guarantees components don't interfere with each other.
- **Strict quality gates** — lint / coverage / annotations are run "no lowering, no working around"
- **Unified graph** — code, docs, DB, infrastructure on a single graph as the foundation that lets the AI act with context
- **Auto PR review / auto fix / auto merge / auto alert-fix** — the harness that swaps the rate-limiting manual step for AI
- **Unified observability** — humans and AI see the same data (OTel + Faro + Prometheus)

The design has to be in place first, and AI runs on top of it. That's what makes both volume and quality possible at the same time.

**Composable Architecture** in particular is what drives the headcount-of-one production. Because components don't interfere, **multiple Claude Code sessions can run in parallel on different parts of the codebase**. In practice, I've run up to ~10 sessions in parallel at peak — this multiplies with the harness's effectiveness.

It's **system design, not magic**. Each piece will get its own deep-dive in this series.

## Some Honest Caveats

If you've read this far, it might sound like everything runs perfectly on autopilot. It doesn't. Three things I want to be upfront about:

**1. High code quality doesn't prevent bugs.**

What the harness protects is **"correctness of the code"** — not **"correctness of the spec."** Even when implementation is clean, getting the spec interpretation wrong still ships bugs. AI review can catch "code contradicts the documented spec," but if the spec itself is wrong, the issue sails right through. That part is still a human responsibility.

**2. The work is split deliberately.**

New pipelines that connect to external APIs, and anything touching secure data, are **handled by engineers**. Non-engineers mostly work on **modifications to features that already exist** (peeking at our business-side members' PRs makes it concrete pretty quickly). **"Non-engineers can develop too"** means **"the harness provides rails they can't derail from, so they can safely modify in maintenance mode"** — not "anyone can build anything from scratch."

**3. This level of automation works because it's an internal platform.**

Yes, cortex's full-auto deploy works partly because Composable Architecture cleanly separates apps and infrastructure. But honestly, **a big part of it is that this is an internal-only platform**. If something breaks, only employees are affected, and we can roll back fast. The same approach can't be applied directly to consumer products or systems where downtime is immediately critical (warehouse management, for example). We've started moves to close that gap on the consumer side too, but that's a separate post.

## Series Roadmap

The series is planned as 6 parts.

**Part 1: Series Intro** (this post)
   The big picture of what cortex is and why it works in "harness" form. The map to the rest of the series.

**Part 2: Product Graph — code, docs, DB, infrastructure as one unified graph** ★ recommended next
   The implementation side: how the unified graph is built and maintained. What happens when you take the design principles from [the Agentic Graph RAG MCP post](/posts/agentic-graph-rag-mcp) and apply them to the entire cortex codebase.

**Part 3: AI reviews, fixes, merges, and deploys PRs**
   GitHub webhook → AI review → on REQUEST_CHANGES, AI fixes via worktree → auto squash merge → changed-stack detection → parallel deploy: the full pipeline.

**Part 4: Incidents fix themselves before you notice**
   Grafana alert → AI investigation (Loki + Product Graph + git blame) → fix PR → auto merge → automatic redeploy: the auto alert-fix system.

**Part 5: Observability and quality gates**
   Full OTel + Faro + Prometheus, Gemini cost tracking, and how the quality gates are designed to be "non-loweriable, non-bypassable."

**Part 6: A dev environment non-engineers can ship in**
   How business-side members can open PRs directly to cortex, how AI review and auto-fix uphold the quality bar, and how this differs from the [Sandbox MCP](/posts/sandbox-mcp) lane.

Each post stands on its own, but **Part 2 (Product Graph) is the foundation for the others**, so the recommended reading order is Part 1 → Part 2 → any.

Cadence: Tuesdays or Thursdays, 8–10 AM JST.

## Closing

Building cortex, what's struck me is that **in an AI-era dev environment, "absorbing everything that comes after the writing" wins over "reducing the burden on the writer"**. Tests, lint, types, coverage, code review, incident response — instead of "these get in the way, let's reduce them," the choice that worked was "**have the AI do all of them, without compromise**." The counterintuitive result is that quality and dev speed both go up at the same time.

And it expands two things — **how much one engineer can ship**, and **how much non-engineers can participate** — well beyond what was possible before. That's the texture of the "harness" we've built on top of cortex.

In subsequent parts, I'll walk through the individual mechanisms that make this work.
