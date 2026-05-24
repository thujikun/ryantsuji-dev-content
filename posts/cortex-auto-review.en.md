---
title: "Human-on-the-Loop: AI Reviewing AI PRs at cortex (769 PRs/month, while raising the quality bar)"
publishedAt: "2026-05-26T08:30:00+09:00"
updatedAt: "2026-05-26T08:30:00+09:00"
draft: true
slug: "cortex-auto-review"
summary: "Series Part 3. The common critiques of AI-assisted development -- 'review becomes the new bottleneck' and 'AI code drops the quality bar' -- fundamentally don't apply when AI also does the reviewing. Full walkthrough of our pipeline: webhook -> cpg context -> AI review with [Graph]/[Doc]/[Impact] tags -> auto-fix by a separate AI -> re-review -> auto-merge -> parallel deploy. 769 PRs merged in 30 days, human review involvement per PR is near-zero."
tags:
  - "ai"
  - "devops"
  - "codereview"
  - "productivity"
lang: "en"
series: "building-ai-harness"
seriesOrder: 3
syndication:
  devto:
    id: 3738048
    slug: "code-written-by-ai-is-reviewed-by-ai-a-structural-answer-to-review-bottleneck-and-quality-drop-44bh-temp-slug-3737979"
    contentHash: "6c542ed4e6fe3319"
    publishAt: "2026-05-26T07:00:00-07:00"
cover: /posts/cortex-auto-review.en.cover.png
---


Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

> **Disclaimer**: "cortex" in this article is the internal codename for an AI platform built in-house at airCloset. It is unrelated to existing commercial services like Snowflake Cortex or Palo Alto Networks Cortex.

In [Part 1 (intro)](/posts/ai-harness-intro) I covered the high level -- **AI driving both PR reviews and incident response on top of cortex**. In [Part 2 (Product Graph)](/posts/cortex-product-graph) I went deep on **cpg**, the unified knowledge graph that fuses code, docs, DB schemas and infra into a single business-aware index.

This post is about **the automated PR review pipeline** -- AI reviews the PR, a separate AI applies the fixes, and the system merges automatically once policy gates pass. The usual critiques of AI-assisted development ("**the reviewer becomes the bottleneck**" and "**AI code drops the quality bar**") don't really apply here. The rest of this post unpacks why.

## Series

| # | Theme | Key scene | Article |
|---|---|---|---|
| 1 | Series intro: cortex harness | PRs merging unattended / incidents fixed before anyone notices | [ai-harness-intro](/posts/ai-harness-intro) |
| 2 | Product Graph (cpg) | Code / docs / DB / infra unified into one graph | [cortex-product-graph](/posts/cortex-product-graph) |
| 3 | Auto PR review | webhook -> AI review -> auto-fix -> squash merge | This article ← you are here |
| 4 | Alert-Fix | Alert -> AI investigation -> fix PR -> auto redeploy | Coming soon |
| 5 | Observability + quality gates | OTel/Faro stack + "never lower the bar" design | Coming soon |
| 6 | Non-engineer dev experience | Non-engineers ship PRs, AI review enforces quality | Coming soon |

## Start with last month's numbers

**769 PRs merged.**

**Median time to merge: 31 minutes.**

**Human review involvement per PR: near-zero.**

That's a typical 30 days on cortex (Apr 21 -- May 21).

Every one of those 769 PRs had an AI reviewer as the first reviewer, with **an average of 10.8 review-fix loop iterations per PR (max 56)**. 1 in 5 merged within 10 minutes, roughly half within 30 minutes. What humans do now is look at review outcomes and **tune the review prompt and the guidelines themselves** -- this is **human-on-the-loop, not human-in-the-loop**. Not "a human in the middle of each decision," but "a human watching the system from above and steering."

| Past 30 days |  |
|---|---|
| PRs merged | **769** |
| AI reviewer coverage | **100%** |
| Avg review iterations / PR | **10.8** |
| Max review iterations | 56 |
| Per-PR human review | **~0%** |
| Median time-to-merge | **31 min** |
| Merged within 10 min | 20% |
| Merged within 30 min | 49% |

This is a typical month on cortex now.

The common refrain -- "**AI speeds up writing but reviews still bottleneck**" and "**AI-written code lowers quality**" -- is something cortex absorbs through **a pipeline where neither failure mode can take hold**. Let me break it down.

## How the review bottleneck stops forming

### The conventional wisdom: the reviewer becomes the bottleneck

As AI writes faster, the load on whoever reviews the output grows proportionally. Anthropic's internal blog ([How Anthropic teams use Claude Code](https://www.anthropic.com/news/how-anthropic-teams-use-claude-code)) reports the same pattern -- **the bottleneck has shifted from writing to reviewing**, and senior engineers' work has moved from writing code toward integrating and reviewing AI output.

cortex hit exactly this. The moment we ran Claude Code at full throttle, **writing speed jumped by an order of magnitude or more**. Meanwhile the human time available to read and approve PRs only grew linearly. If the reviewer (=me) took a day off, the whole org stalled -- a classic single point of failure.

### cortex's answer: move the reviewer role to AI as well

Part 1 and Part 2 kept asking the same recurring question: "**how far do you push the harness?**" cortex went all-in: **the AI writes the code, the AI reviews the code**. What humans keep their hands on is "**tuning the prompts and guidelines themselves**" -- not making decisions inside each individual PR, but watching the system from above and adjusting.

Three conditions had to hold for this to work:

1. **The AI reviewer has enough context**

    A generic AI reviewer **only sees the PR diff**. The diff alone hides business meaning, upstream/downstream dependencies, and prior incident history. cortex feeds the **Product Graph (cpg)** from [Part 2](/posts/cortex-product-graph) -- **a knowledge graph that fuses code, docs, DB schemas, and infra into one structure, with each node carrying business role and upstream/downstream dependencies** -- into the AI reviewer, so it can **trace impact into code that the PR didn't even touch**. It catches:

    - Missed upstream/downstream fixes
    - Missed doc updates
    - Tests that should have been updated but weren't

    Diff-only AI review can never reach this territory.

2. **Reviews are not improvisational**

    If reviews shift day to day, the team gets confused, and the AI can't be told what "correct" looks like. We enforce this by passing **an explicit review-guideline document** as the mandatory citation source for every review (we open-sourced a snapshot, see below).

3. **False positives don't blanket-block merges**

    Treating every false positive as Critical breaks the workflow. We control this with **a severity hierarchy (Critical / Major / Minor / Nit) plus strict no-downgrade rules**.

So: the cpg from [Part 2](/posts/cortex-product-graph) solves "**what context the AI sees**," the review guidelines solve "**what the AI should do**" as **Guides (pre-execution control)**, and the severity ladder + no-downgrade rules solve "**what the AI must not do**" as **Sensors (post-execution control)**. This maps cleanly onto Martin Fowler's Guides / Sensors taxonomy (introduced back in [Part 1](/posts/ai-harness-intro)).

One more upstream layer: before any of those three kicks in, **a 500-lines-per-file lint** keeps every file in any PR small enough to fit in a single AI session. That alone keeps AI review from breaking down, and unlike a human reviewer, the AI doesn't lose focus. There are plenty of other lints in front of the AI reviewer too, but the full picture belongs to **Part 5 (Observability + quality gates)**.

## How the auto-review system is wired

The implementation is **a script running on each developer's machine**. GitHub webhooks land on an in-house **Event Relay server**, get persisted to Firestore, and each developer's machine subscribes as an SSE client. On reconnect, Last-Event-ID replays anything missed -- zero event loss, single webhook registration. **Reviewer-mode machines stay always-on**, so any incoming review fires immediately. **Author mode runs in the background on the PR author's own machine**, alongside their normal dev work.

When the reviewer's machine receives an event, the script spawns `claude -p` and walks through 9 dimensions (Graph / Architecture / Security / Test / Doc / Impact / Observability / AI-Antipattern / Recurrence) sequentially, then reads the verdict marker the AI emitted at the end and posts `APPROVE` or `REQUEST_CHANGES` via `gh pr review`.

![Auto review pipeline — distributed webhook architecture running on every developer's machine](/images/posts/cortex-auto-review/auto-review-flow-en.png)

A few notes:

- **Modes split the role** -- the same script started with `--mode reviewer` becomes the reviewer process; with `--mode author` it becomes the PR-author response process. The machine of whoever is assigned as reviewer runs reviewer mode; the machine of whoever opened the PR runs author mode. Event Relay multicasts the events, and **each machine reacts in a distributed way**.
- **Per-PR worktree isolation** -- author mode merges `origin/main` into a fresh worktree before spawning the AI. Multiple PRs can be handled in parallel without file state contaminating across them.
- **9 dimensions checked sequentially in one session** -- not parallel sub-agents. A single `claude -p` session walks the 9 dimensions while keeping context shared, which also catches cross-dimension contradictions.
- **Review guidelines: public snapshot** -- [air-closet/cortex-review-guidelines](https://github.com/air-closet/cortex-review-guidelines) (JP/EN). The live guidelines are inside cortex (private repo) and evolve daily; the public repo is a snapshot extracted for reference.

### Why sequential single-session review, not parallel sub-agents

We initially tried splitting the 9 dimensions across parallel sub-agents. Three problems emerged: cpg / guidelines / PR diff got injected 9 times (token cost balloons), cross-dimension findings couldn't reference each other (a `[Test]` issue rooted in a `[Graph]` violation gets dropped in isolation), and aggregating 9 outputs into a single verdict required its own machinery.

A single sequential session fixes all three: one cpg/guideline load, earlier findings stay in context for later dimensions (cross-dimension consistency comes for free), and one verdict marker at the end is the entire aggregation step.

We also **swap `CLAUDE.md` to a review-specific version** at startup. The default `CLAUDE.md` is dense with development-time context (Product Graph ops, prod-data safety, MCP ordering) -- noise for a reviewer. The review-specific version centers on severity, no-downgrade, and the verdict marker spec, keeping AI attention on the review task.

Cutting wasted context lifts judgment precision and token cost at the same time.

### Operational knobs

A few filters and toggles we apply in actual use:

- **Draft (WIP) PRs are excluded.** GitHub Draft state is received but skipped; review starts firing once the author flips it to Ready for Review.
- **Specific PRs can be targeted manually.** The webhook is the normal trigger, but you can also kick off a review against a specific PR number from the CLI -- useful after a CI failure or for re-checking a single PR.
- **Auto-merge is the PR author's call.** Whether the pipeline runs through to auto-merge after APPROVE + CI green is set by the PR author. Default is on; for changes that go directly to prod, the author can flip it off and hit merge themselves.

## Output structure: tags and severity

Every auto-review comment is structured as **tag + severity + concrete example**.

### Tags (dimensions)

| Tag | Dimension | Primary target |
|---|---|---|
| `[Graph]` | Product Graph integrity | `@graph-*` JSDoc, node dependencies, doc consistency |
| `[Doc]` | Doc consistency | Doc updates that should follow code changes, doc placement |
| `[Impact]` | Impact analysis | Missed upstream/downstream fixes, `via:` field inconsistency |
| `[Security]` | Security | Auth, input validation, secrets |
| `[Architecture]` | Composable Architecture | app/package boundaries, dependency direction |
| `[Test]` | Test quality | Coverage, matchers, naming |
| `[Observability]` | Observability | Structured logging, no-truncate rules |
| `[AI-Antipattern]` | AI-generated code traps | Hallucinated APIs, fallback overuse, dead code |
| `[Recurrence]` | Recurrence prevention | Bug-fix triage (lint / horizontal rollout / new guideline) |

### Severity

| Severity | Criteria | Action |
|---|---|---|
| **Critical** | Security, data corruption, prod-risk, doc inconsistency, missing `@graph-*`, quality-bar relaxation | `REQUEST_CHANGES` |
| **Major** | Spec violation, Composable Architecture violation, missing tests | `REQUEST_CHANGES` |
| **Minor** | Naming, maintainability, light refactor | `REQUEST_CHANGES` (must be resolved) |
| **Nit** | Style preference, minor inconsistency | `APPROVE` (comment only) |

The single most important rule is **"no downgrade"**:

- "**Following existing patterns**" is not a valid reason to downgrade (existing violations are a separate problem to fix, not justification for new violations).
- "**Will be addressed in a separate PR**" or "**incrementally**" is not a valid reason to drop Critical/Major to Nit.
- "**Leave a TODO/FIXME**" is not a valid deferral path.

This is spelled out in [`severity.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/en/guidelines/severity.md), and the AI literally cites it back when it issues `REQUEST_CHANGES`.

### Example: PR migrating the embedding model from gemini-embedding-001 to gemini-embedding-2

A real review comment is more useful than abstract description. Here's a typical one. This is a feature PR (`feat(meet): dual-write embeddings to new 'embedding' column (v2)`) that was merged on 2026-05-19, after **6 review-fix iterations across 1.5 hours**.

**First review (07:35:25)**:

> The dual-write approach, the idempotent migration script, and the `Promise.all` parallelization all look sound. Please address the 3 Critical and 2 Minor findings below before merging.
>
> ---
>
> ## Critical
>
> ### [Graph] Missing `@graph-business` tag (x3)
>
> `graph-integrity.md` requires `@graph-business` on every top-level declaration under the app layer (severity: Critical).
> All 3 new declarations below are missing it (detailed comments in separate threads).
> **Existing code is also missing it, but "following existing patterns" is not a valid downgrade reason (severity.md).**
>
> - `generateEmbeddingV2` (v2 embedding generation function)
> - `EMBEDDING_MODEL_V2` (model name config)
> - `EMBEDDING_LOCATION_V2` (region config)
>
> ---
>
> ### [Graph] `embedMeetContent`'s `@graph-connects` doesn't reflect `generateEmbeddingV2`
>
> The JSDoc on `embedMeetContent` has `@graph-connects generateEmbedding [calls] Generate embedding`, but no corresponding `@graph-connects` line has been added for the newly introduced `generateEmbeddingV2` call.
> The graph will be missing an edge to `generateEmbeddingV2`.
>
> ```diff
>    * @graph-connects generateEmbedding [calls] Generate embedding
> +  * @graph-connects generateEmbeddingV2 [calls] v2 embedding generation (dual-write)
>    * @graph-connects insertMeetChunks [calls] Insert chunks into BQ
> ```
>
> ---
>
> ### [Doc] Corresponding BigQuery schema doc is not updated
>
> The "BigQuery schema" section in the related doc is missing the new `embedding` column.
> Both `graph-integrity.md` and `severity.md` define doc inconsistency as Critical.
>
> ```diff
>  | `created_at`  | TIMESTAMP   | Created at                              |
> +| `embedding`   | FLOAT64[]   | Embedding vector (v2: gemini-embedding-2) |
> ```
>
> ---
>
> ## Minor
>
> ### [Test] `textEmbeddingV2` value is not asserted
>
> `objectContaining` allows extra fields, so the test still passes even when the v2 value is never set.
>
> ```diff
>          textEmbedding: [0.1, 0.2, 0.3],
> +        textEmbeddingV2: [0.1, 0.2, 0.3],
> ```
>
> ### [Test] No isolated scenario for "v2 returns null"
>
> `generateEmbeddingV2: mockGenerateEmbedding` reuses the v1 mock, so the case "v2 returns null while v1 succeeds" is not independently verified.
>
> ---
>
> `<!-- VERDICT:REQUEST_CHANGES -->`

The takeaway is the precision of the details.

- **File + line numbers** are concrete.
- **Suggested fixes are in diff format** (copy-paste ready).
- **Source guideline** (`graph-integrity.md` / `severity.md`) is cited explicitly.
- **The typical excuse** ("existing code has the same problem") is **pre-emptively closed**.
- The trailing `<!-- VERDICT:REQUEST_CHANGES -->` is a **machine-readable verdict marker** -- the trigger that moves the PR into `REQUEST_CHANGES` state.

After this, the PR author (= usually another AI running on the author's machine) pushes a fix, the reviewer re-reviews. The next review confirms all 3 Criticals are actually resolved, raises the next Major / Critical, and so on. **6 iterations in 1.5 hours**, finally APPROVE, auto-merge.

Plotted on a timeline:

![Real example of the review-fix loop — embedding model migration PR, 6 iterations in 1.5 hours](/images/posts/cortex-auto-review/review-fix-timeline-en.png)

With a human reviewer, this is "Critical x3 -> wait until tomorrow for the fix -> re-review the day after" -- 2 to 3 days per PR. cortex closes it in **90 minutes**.

The difference between human review and auto review is not just speed. A single AI session walks all 9 dimensions in order and cites the guideline each time, which makes it **much harder to miss the "deep" findings humans drop because their attention drifted** -- doc consistency, recurrence-prevention judgments, weak matchers. Side-by-side comparison:

![Before / After — human review era vs. cortex's auto-review era](/images/posts/cortex-auto-review/before-after-review-en.png)

This is why the review bottleneck never forms here.

## Evolving the guidelines: catching the moments AI gets it wrong, then fixing the rules

The review guidelines I've been referring to are **not a static document**. Running this in production surfaces recurring patterns where **the AI mis-judges a specific class of issue**. Each time that happens, we don't add a comment to the individual PR; we **rewrite the guideline so the AI behaves correctly next time** -- this is the meta-layer humans actually operate on.

A few concrete failures we hit on cortex, and how we closed each one by changing the rule, not the PR.

### 1. AI was downgrading because "existing code has the same issue"

Early on, immediately after flagging a violation the AI would add "**however, since existing code has the same violation, I'm downgrading this to Nit**" and self-downgrade. The result: violations on newly added code kept dropping to Nit, and the system kept emitting Approve.

We closed this by adding **the no-downgrade rule** to `severity.md`:

> "Following existing patterns" is not a valid downgrade reason: if existing code violates a guideline, new code following that pattern still gets flagged at the same severity. Deferral language like "consider during the next refactor" is not accepted.

That wasn't enough on its own. Over time other excuse patterns surfaced -- "**will be addressed in a separate PR**," "**will be addressed in the next session**," "**out of scope**," "**incrementally**" -- so we added those as forbidden downgrade categories too. We also explicitly forbade **deferring via TODO/FIXME comments in code**. The mindset is: **close every typical excuse path preemptively**.

### 2. The final verdict had 3 options, and "comment-only" left PRs in limbo

The final verdict at the end of every review was originally `APPROVE` / `REQUEST_CHANGES` / `COMMENT` (approve / request changes / comment-only). When the AI picked `COMMENT` -- for example when only Minor issues existed -- the script took no action, the PR sat in review-pending forever, and ultimately someone had to manually pick it up. Classic anti-pattern, and it kept happening.

We **collapsed the verdict to 2 options**. Anything Minor or above is `REQUEST_CHANGES`, a missing verdict marker defaults to `REQUEST_CHANGES` (safe side), and only Nit-only or no findings (with CI passing) yields `APPROVE`. The principle: "**if the judgment is ambiguous, fail-safe by defaulting to the blocking side (`REQUEST_CHANGES`)**." Going all-in on that design clarified things.

### 3. Checklist items had no severity, so the AI's judgment kept drifting

Originally, each guideline (`graph-integrity.md`, `testing.md`, etc.) was just a **bulleted checklist**. Items like "Is the test name descriptive?" or "Are mocks minimized?" were listed, but **without per-item severity**. As a result, the same violation could land as Major in one PR and Nit in another, depending on the session.

We **converted every guideline's checklist into a `severity` / `scope` / `criterion` table**:

| Severity | Scope | Criterion |
|---|---|---|
| Critical | All PRs | Missing `@graph-business` |
| Major | App layer only | Missing tests |
| Minor | Shared packages only | More than 3 function args |
| Nit | All PRs | Naming inconsistency |

The `scope` column is **a machine-decidable filter** for which paths a check applies to, so the AI reviewer doesn't trigger irrelevant items on PRs outside that scope. Just putting it in a table -- the judgment reproducibility jumped significantly.

### 4. The existing guidelines didn't catch AI-specific traps

After running this for a while we noticed AI-generated code has its own cluster of antipatterns -- **calling APIs that don't exist** (hallucinated APIs -- something like `user.findOrCreate()` that looks plausible but isn't actually defined), **swallowing errors and returning fallback values** (e.g., silently returning an empty array when an upstream API fails), **leaving unused functions** (a refactor adds the new function but doesn't delete the old one, leaving dead code), **expanding the modification scope beyond what was asked** (you ask it to change one function and it reformats the whole file), **adding unnecessary backward-compatibility code** (creating a deprecated alias for an internal-only function) -- and `security.md` / `testing.md` couldn't catch these. There's a **distinct class of "mistakes only AIs make."**

We added a dedicated **`ai-antipattern.md`** for this. Reviews now pick these up explicitly under the `[AI-Antipattern]` tag. **Reviewing AI output requires designing around AI-specific traps** -- you don't get there just by porting human review heuristics onto an AI.

### 5. The AI tries to relax "the standard itself"

The last and most important pattern. When the AI was writing fix PRs, occasionally instead of fixing the guideline violation it would write **a PR that relaxes the guideline**. For example:

- Lower the test coverage threshold to avoid writing more tests
- Narrow the in-house lint rule's scope to make the violation go away
- Soften the guideline doc language from "recommended" to "preferred" to weaken the binding constraint

And the AI builds a formally-coherent justification: "**existing code already violates this, so let's adjust the standard to match the implementation.**" Left unchecked, **the AI gradually walks the quality bar down**.

We closed this by adding **"quality-bar relaxation" as a Critical** in `severity.md`:

> A PR that relaxes the quality bar -- guideline doc, lint rule, coverage threshold -- must not be Approved by the AI reviewer. It is sent back with `REQUEST_CHANGES`. **A human reviewer's approval is required**. "Existing code already violates this" is not a valid justification for relaxation.

This is the one explicit boundary where **we deliberately do not give the AI autonomous Approve authority**. Whether the standard itself moves is a human decision. It's the **meta-level safety valve** for the "AI reviewing AI" architecture.

### Evolving the guidelines is the meta-layer humans actually operate on

The common thread: "**when the AI gets it wrong, don't override the individual PR -- rewrite the guideline so the fix propagates forward.**"

- AI escapes via "existing code has the same issue" -> add no-downgrade rule
- AI picks "comment-only" and PR stalls -> collapse to 2-option verdict
- AI's judgment drifts -> add severity / scope columns to every item
- AI falls into its own traps -> add the AI-Antipattern category
- AI tries to relax the standard -> classify standard-relaxation as Critical, require human Approve

As long as this loop turns, the guideline is **a living document that absorbs the failure patterns AI produces in production**. **Don't try to write the perfect guideline up front. Catch the moment AI gets it wrong, and write the rule for that moment.** That's the actual mechanism behind "quality doesn't drop even when humans aren't inside the loop."

And one more thread. Right now, the trigger for "AI got it wrong, time to rewrite the guideline" is still mostly a human judgment, but **that maintenance is also gradually shifting to AI**. **Alert-Fix** (Part 4 next time) -- where AI investigates production incidents, opens a fix PR, runs it through auto-review, and auto-redeploys -- requires every fix PR to write one of {add lint, add guideline, horizontal rollout} under the `[Recurrence]` lens. The result is **AI growing its own judgment criteria on its own**. Even guideline maintenance is leaving human hands -- I'll come back to this in Part 4.

## Auto-fix: a separate AI applies the changes and pushes

Once `REQUEST_CHANGES` lands, **the same script running on the PR author's machine, but in author mode**, picks up the event and starts working.

```
[REQUEST_CHANGES detected]
   | SSE push via Event Relay
[Author mode boots on PR author's machine]
   | Merge origin/main into a worktree
   |  (lockfile resolved up front, remaining conflicts handled by AI)
   | Read the auto-review comment as context
   | Run claude -p inside the worktree
   | Commit + push the changes
   | New SHA is delivered back to the reviewer's machine via Event Relay -> re-review
```

Two design choices matter here.

- **Reviewer and author run on different machines in different sessions** -- reviewer mode and author mode are the same script, but they run on different machines in different processes. "Is the original critique correct?" is judged independently. Unlike a single AI fixing its own complaints, the judgment crosses between two separate sessions.
- **All iteration stays inside the same PR** -- we don't spawn a new PR. The "**fix the root cause, no deferrals**" rule from Part 2 and the review guidelines kicks in here: if the AI tries to escape via `TODO/FIXME` or by splitting work out into a separate PR, the next review rejects it.

## Auto-merge + parallel deploy

Once auto-review returns APPROVE and CI is fully green, the `auto-merge` script runs and squash-merges the PR.

```
[Auto review APPROVE + CI green]
   |
auto-merge script
   | squash merge to main
   |
[main updated]
   |
Turborepo build (affected packages only)
   |
Pulumi up (multiple stacks in parallel)
   |- API services
   |- pipeline services
   |- MCP servers
   `- infra
   |
[Deploy complete]
   |
cpg index rebuilt (only changed nodes regenerate embeddings -- see Part 2)
```

`pulumi up <stack1> <stack2> ...` runs in parallel, so deploying 9 stacks at once finishes in about 8-12 minutes. End to end, merge-to-production is averaging 10-15 minutes.

This compounds nicely with `auto-fix` PRs. **Incident alert -> Alert-Fix identifies root cause -> opens a fix PR -> auto review pass -> auto merge -> auto deploy** runs as a single closed loop without human involvement (covered in Part 4).

## The numbers, in more detail

Unpacking the headline numbers a bit further.

### Depth of the review-fix loop

Across 769 PRs in 30 days, the **average per PR was 10.8 review iterations, max 56**. The fact that the average is past 10 means **the first review almost always surfaces at least one finding**.

The embedding-model migration PR shown earlier needed 6 iterations to merge, and that's representative of the average PR. **What would take a human reviewer days, cortex resolves in minutes.**

### What the auto reviewer typically flags

The most common findings out of the first review:

- **[Graph] Missing `@graph-business`** -- a prerequisite cpg leans on (from Part 2). The classic finding on newly added declarations.
- **[Doc] Doc inconsistency** -- code changed but the corresponding `docs/` section was not updated.
- **[Test] Weak matchers** -- `objectContaining` weakening value assertions, single-property checks via `toBe`.
- **[Observability] Unstructured error logs** -- `event` field or required keys deviating from the structured-log spec.
- **[Recurrence] No recurrence-prevention action** -- a bug-fix PR description not declaring which of {lint / horizontal rollout / add guideline / nothing} applies.

These are categories **human reviewers tend to miss even when they try** (especially doc consistency and recurrence-prevention judgments). Pushing them to AI cuts the miss rate.

### Actual false-positive rate

It's not zero. A few times a month we get "this is Nit, not Major" type misjudgments. The fix path is the one described above -- not a comment on the individual PR, but a guideline edit that corrects the judgment for all subsequent reviews.

## What changed / Bridge to Part 4

Over the past six months, the engineer's role on cortex shifted from "**writer**" and "**reviewer**" to "**operator**" -- the human running the system, not acting inside each individual decision.

- AI writes the code (Claude Code)
- AI reviews the code (auto review)
- A different AI applies the fixes (author mode running on the PR author's machine)
- AI decides when to merge (auto-merge script)
- Deploys go in parallel (Turborepo + Pulumi)

What stays in human hands: "**what to build at all** (product / requirements)," "**is this direction actually right** (architectural judgment)," "**which guideline to add and where**," and "**look at the reviews and adjust prompts and guidelines accordingly**." High-abstraction work -- **not individual decisions, but watching the whole system from above and steering**. **From human-in-the-loop to human-on-the-loop**, you could say.

The widely-reported phenomena -- "AI lowers quality," "the reviewer becomes the bottleneck" -- happen when **the harness is extended on the writer side only, and the reviewer side is left to humans**. If writing speeds up and reviewing doesn't, of course it bottlenecks. Of course things get missed.

cortex is the opposite. **We extended the harness on the reviewer side first, before fully extending it on the writer side**. Anthropic's observation that the bottleneck shifts from writing to reviewing is exactly right -- which is precisely why "**move the reviewer role to AI as well**" is the answer cortex chose.

"The AI writes the code, the AI reviews the code." That's the core of cortex's auto-review pipeline. **Quality drop and review bottleneck are functions of how far you extend the harness** -- they are not inherent to AI-assisted development.

---

Up next in **Part 4**: **Alert-Fix** -- a pipeline where a production alert triggers AI investigation, an AI-authored fix PR, auto-review, auto-merge, and auto-redeploy, all without human involvement. If auto review protects quality at PR time, Alert-Fix protects it **at production time**.

The headline number above includes `auto-fix`-flavored PRs (= Alert-Fix output). For certain classes of incidents, the fix is already merged before anyone has time to react -- that's where cortex sits today. See you next time.
