---
title: "Fixed Before Anyone Notices, Stronger After Every Fix: Self-Healing + Recurrence Prevention (Series Part 4)"
publishedAt: "2026-06-02T08:30:00+09:00"
updatedAt: "2026-06-02T08:30:00+09:00"
slug: "cortex-self-healing"
summary: "Series Part 4. Production alerts trigger AI investigation, fix PR, auto-review, auto-merge, auto-redeploy. The same fix PR is required to add a new Guide -- a lint rule, CI guard, type constraint, or guideline entry -- so the same anti-pattern gets auto-rejected from then on. 115 Self-Healing PRs merged in the past 30 days, and the quality gates compound over time."
tags:
  - "ai"
  - "typescript"
  - "observability"
  - "github"
  - "devops"
lang: "en"
series: "building-ai-harness"
seriesOrder: 4
cover: /images/posts/cortex-self-healing.en.cover.png
syndication:
  devto:
    id: 3788644
    slug: "fixed-before-anyone-notices-stronger-after-every-fix-self-healing-recurrence-prevention-series-1e86"
    contentHash: "7bf146d6e9dc8274"
---


Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

> **Disclaimer**: "cortex" in this article is the internal codename for an AI platform built in-house at airCloset. It is unrelated to existing commercial services like Snowflake Cortex or Palo Alto Networks Cortex.

In [Part 3](/posts/cortex-auto-review) I covered **AI reviewing AI PRs** -- the auto-review pipeline that defends quality **at the PR stage**.

This post is the other side: **defending quality in production**, via **Self-Healing**. A production alert fires, an AI investigates it, opens a fix PR, the PR goes through the same auto-review pipeline from Part 3, gets auto-merged and auto-redeployed. And the same fix PR is **required to add a new Guide -- whether that's a lint rule, CI guard, type constraint, or guideline update** -- so the same anti-pattern gets auto-rejected from then on. The guardrails grow every time.

"Incidents get fixed automatically" is catchy on its own, but on its own it's probably not enough in the long run. You have to **close the recurrence class while you fix the incident** -- self-healing **plus** self-strengthening -- before the quality gates start to compound over time.

## Start with last month's numbers

**115 Self-Healing PRs merged in the past 30 days.**

**Effectively all of them merged and deployed without human involvement.**

**Humans only step in when the AI judges "this is not something code can fix."**

That's the current state of "incident response" at cortex.

Don't read "115 = 115 user-impacting incidents" though. Roughly:

- **About half (54) are Deploy Failed-style alerts** -- CI / Pulumi deploy step caught a failure, the AI absorbed it **before it shipped to production**. Recently the `[Recurrence]` loop (covered later) has been piling up countermeasures here, so this bucket is trending down anecdotally
- **The remaining 61 are production-runtime alerts** (Service Error Log Detected / Pipeline Failure / Generator Failure etc.) -- the service is running in production, but an error-log threshold or consecutive-failure threshold tripped. The AI absorbed them before they propagated to user impact

So it's less "incident response" than "**production anomalies that monitoring caught, fixed 115 times by AI before anyone woke up**." The number of incidents humans actually have to acknowledge is in the low single digits per month.

There's also a clear pattern of **the same service firing repeatedly** (e.g. `gcs-transformer` is 25 of the 61) -- which is exactly what the `[Recurrence]` loop covered later is supposed to **eliminate by turning into lint or type gates**. That's the back half of this post.

One more honest note: **the recent month's number is slightly inflated**. The codebase had a fair number of "silent catch" patterns -- catch blocks that swallow exceptions without logging anything. We added the `no-silent-catch` lint rule and **swept the existing silent catches in batches**, which exposed previously hidden production errors as alerts. So part of the spike is "monitoring caught up to reality." Once the `[Recurrence]` loop converts these into lint over time, the number should converge. **"Things we couldn't see, we can see now" is a quality improvement** -- what we're seeing is the catch-up phase.

One more thing worth saying: doing this by hand is utterly unsustainable. Running 115 manual cycles of "ack alert -> read logs -> context switch -> understand the code -> fix -> open PR -> review -> deploy" would bankrupt any team's engineering bandwidth. **The system absorbs them without anyone noticing, and converts the fix into a new Guide (lint / CI guard / type constraint / guideline) at the same time** -- that's the actual subject of this post.

The moment an alert fires, the AI starts an investigation, traces Loki / Product Graph / git blame to root cause, opens a fix PR, runs it through the auto-review from [Part 3](/posts/cortex-auto-review), APPROVE -> auto-merge -> auto-redeploy. One full loop.

## Series

| # | Theme | Key scene | Article |
|---|---|---|---|
| 1 | Series intro: cortex harness | PRs merging unattended / incidents fixed before anyone notices | [ai-harness-intro](/posts/ai-harness-intro) |
| 2 | Product Graph (cpg) | Code / docs / DB / infra unified into one graph | [cortex-product-graph](/posts/cortex-product-graph) |
| 3 | Auto PR review | webhook -> AI review -> auto-fix -> squash merge | [cortex-auto-review](/posts/cortex-auto-review) |
| 4 | Self-Healing + observability + auto-added guardrails | Alert -> AI investigates -> fix PR + new lint/type gate -> auto redeploy + same pattern auto-rejected from then on | This article ← you are here |
| 5 | Democratizing the maintenance phase | Domain experts open PRs to production; the harness owns the quality gate | [cortex-non-engineer-prs](/posts/cortex-non-engineer-prs) |
| 6 | Series wrap-up | The underlying philosophy (what was given up, what was kept, why this design) plus a retrospective on the failures and lessons | Coming soon |

## Big picture -- the three layers: Observation, Repair, Strengthening

For Self-Healing to work, you need an **Observation layer** in front and a **Strengthening layer** (recurrence prevention) behind it. Self-Healing itself is the middle **Repair layer**. The "self-healing + self-strengthening" loop only spins up when all three are in place.

> **Prerequisites**: The three layers only stand up on top of two prior pieces: **cpg** (the unified code / docs / DB / infra knowledge graph from [Part 2](/posts/cortex-product-graph)) and the **Observability stack** covered in this post.
>
> - **No Observability** -> the observation layer is empty, nothing gets detected -> the repair layer never even fires
> - **No cpg** -> the AI cannot see "where else does this trap exist" -> the repair layer does symptom-level patching at best, and the strengthening layer's horizontal expansion stops working
>
> Put differently: **trying to copy this setup without those two will just multiply incidents**. An AI that blindly looks at error logs and rewrites production code is just speeding up the rate at which `gh pr create` ships accidents. cpg and Observability are the **minimum bar** for being able to delegate auto-repair to AI.
>
> Note also that cortex is a **several-hundred-thousand-line codebase**, and at that scale loading the whole codebase as AI context is **impossible for the AI as well** (let alone for a human). Tell the AI to trace impact with just grep and file reads, and it'll run out of context window before it finds anything. cpg is what lets it ask "which other code does this function's change ripple into" and get the answer in one hop. Small repos may not need this. Past a certain scale, cpg is not optional, it's **required**.
>
> In Fowler's Guides / Sensors terms from Part 1, cpg and Observability are **the substrate that supports both Guides (pre-execution controls like lint) and Sensors (post-execution gates like auto-review and Self-Healing)**. Observability feeds Sensors via firing alerts; cpg feeds the Guides side by supplying the auto-review with impact-scoping context. **Neither belongs on one side only** -- they're foundational to both, and Self-Healing and auto-review only function on top of this substrate. That's the structural claim this post is built around.

![Three layers -- Observation -> Repair -> Strengthening loop](/images/posts/cortex-self-healing/three-layer-overview-en.png)

| Layer | Role | Key components |
|---|---|---|
| **Observation** | Real-time detection of production anomalies | OTel SDK / Loki / Mimir / Tempo / Faro / Grafana / Pino logs with trace_id |
| **Repair** | AI receives the alert, investigates root cause, opens a fix PR, auto-review, auto-merge, auto-redeploy | Event Relay -> SSE -> `self-healing` mode script -> claude -p (worktree) -> gh pr create |
| **Strengthening** | The fix PR is required to add a new Guide (lint / CI guard / type constraint / guideline). The same anti-pattern can't reach production again | `@cortex/eslint-plugin-graph` (26 rules), `scripts/check-*.ts` (13 guards), [`recurrence-prevention.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/en/guidelines/recurrence-prevention.md), the `[Recurrence]` lens of auto-review |

I'll walk through them in order.

## Observation -- where do the alerts come from?

cortex's production observability is built on **Grafana Cloud + OpenTelemetry**:

- **OTel SDK** (the shared `@cortex/otel` package) -- every service calls `initOtel({ serviceName })` at its entry point. Trace / metric / log all go out via OTLP to Grafana Cloud
- **Loki** (logs) -- Pino structured logs get `trace_id` automatically. trace and log are cross-referenced
- **Mimir** (metrics) -- Cloud Run / pipeline / Gemini API token usage, etc.
- **Tempo** (traces) -- distributed tracing
- **Faro** (frontend) -- captures browser JS errors / performance / network failures
- **Grafana** -- dashboards + Alert Rules + Notification Policy

We also have **a strict definition of log levels, anchored on business impact**:

| Level | Definition | Examples |
|---|---|---|
| `warn` | Business-foreseeable, **does not need immediate action** (retryable / self-recovers). | Search query returned 0 results, optional field unset, short retry due to rate limit |
| `error` | **Data recovery / re-run will definitely be needed afterward**. Impact expected to be under 20%. | "User record that should exist isn't there," BigQuery insert failure, per-record enrichment failure |
| `fatal` | The feature as a whole **fails for 20%+ of requests**. Service-continuity broken, fatal config missing, full upstream outage. | OTel init failure, required secret missing at startup, full input data source outage for a pipeline |

The key point is to **not pick the level mechanically based on the exception class name** like `NotFoundError`. Same "record not found" situation: "this record must exist and doesn't" is `error` / `fatal`; "user search returned 0 hits" is `warn`. **The level is decided by business impact** -- "does this require data recovery later," "is the whole feature down" -- not by the type. Without this discipline you simultaneously get monitoring fatigue and missed critical incidents. Self-Healing reacts mainly to `error`-threshold trips; `fatal` is the human-escalation side.

Alert Rules are **managed declaratively in Pulumi**, grouped by service into categories like `BOT / Pipeline / Transformer / Generator / Gemini / CI / Deploy / Service Catch-All`. When we add a new service, one line in infra code spins up the dashboards and alerts automatically.

This is "the infrastructure that lets **the AI see the same things humans see**." Self-Healing picks up alerts coming off this stack.

### What Observability can't catch, Self-Healing can't fix either

Honest disclaimer: Self-Healing can only react to **what the observation layer can detect as an anomaly**. "Observability is everything" is literally true here.

What the current stack catches is roughly **logic-level errors** -- exceptions, error logs, deploy failures, external-API call failures, threshold-based metric anomalies.

What it doesn't catch:

- **UI errors** -- the logic ran, no error logs, but the screen **shows something different from intent / shows the wrong value**. Faro catches client-side JS exceptions and network failures, but "the logic ran and the output is just wrong" never fires an alert
- **Silent data corruption** -- aggregated values slowly drift, bad values get into a table. Unless it crosses a threshold or schema check, nothing detects it
- **Perceived UX degradation** -- requests feel slow, the UX feels off. Only catchable once SLO / latency thresholds trip

So Self-Healing is "**AI replacing the human in the loop for incidents the observation layer can catch**." **The coverage of the observation layer itself is the prerequisite.** Holes in observation stay as blind spots that neither auto-review nor Self-Healing reaches.

This isn't really a limitation of Self-Healing -- it's the **importance of growing the observation stack**, which cortex keeps investing in continuously. (From [Part 1](/posts/ai-harness-intro), Observability is one of the "supporting foundations" beneath the flywheel.)

## Repair -- the Self-Healing flow

`MODE=self-healing` runs the same `webhook-server` script as the auto-review setup from [Part 3](/posts/cortex-auto-review), but listening for Grafana firing alerts.

![Self-Healing full flow -- median 30 min to 1 hr from firing alert to production recovery](/images/posts/cortex-self-healing/self-healing-flow-en.png)

The textual flow looks like:

```
[Grafana Alert Rule firing]
   ↓ POST /webhook/grafana
[Event Relay (in-house)] -- persisted in Firestore
   ↓ SSE push (event: grafana-alert)
[self-healing mode script]
   ↓ throttle check (same fingerprint skipped for 4h)
   ↓ 👀 reaction in Slack to signal "I'm on it"
   ↓ git worktree add -b hotfix/auto-alert-{service}-{ts} origin/main
   ↓ run claude -p inside the worktree
     - search related code via Product Graph MCP
     - pull error logs from Loki via Grafana MCP
     - identify root cause and fix
     - update tests as needed
     - conventional commit
   ↓ git push + gh pr create
[fix PR]
   ↓ auto-review (the Part 3 pipeline)
   ↓ APPROVE -> auto-merge -> auto-redeploy
[recovered]
   ↓ ✅ in the Slack thread
```

### What happens when the AI judges "this is not fixable in code"

Not every alert is fixable by code. The implementation has a rule: "if you judge it unfixable, exit without changing anything." In that case Slack gets a notification of the form "**This alert cannot be addressed in code. Investigation: ...**" -- **including what the AI investigated**.

Worth clarifying on the numbers side: the headline **115** is "Self-Healing runs that reached PR-created -> merged -> deployed." This "unfixable, exit clean" case is a **separate bucket**, happening several times a month (external transient outages, infra / config issues that aren't code, cases too complex for the AI to judge confidently). **The "humans show up" bucket is this separate one** -- it isn't a "some of the 115 failed" failure rate.

Here's what a real Slack message looks like (a `styling-pattern-watch-transformer` case where the GitHub PAT had expired):

> ℹ️ This alert cannot be addressed in code. Investigation:
>
> **Investigation summary**
>
> Checked the error logs in Loki for the past hour. The single error source for `styling-pattern-watch-transformer` right now is **expiration / revocation of the GitHub PAT (Personal Access Token)**.
>
> **What I found**
>
> 1. The BQ snapshot pipeline is healthy: 7 consecutive `[BQ] Snapshot rows inserted` successes. The earlier autodetect type-drift problem was resolved in an earlier PR that put `SAFE_CAST(... AS INT64)` in place.
> 2. The single ongoing error (multiple occurrences in the past hour): `GithubUnauthorizedError: GitHub API /commits/master unauthorized (401): PAT likely expired/revoked` -- the `/check-drift` handler returns 401 every time Cloud Scheduler invokes it.
>
> **Root cause**
>
> The GitHub PAT held in Secret Manager for this service has expired or been revoked. The code already classifies the 401 with a dedicated `GithubUnauthorizedError` and is already sending the "PAT needs rotation" notification to Slack. **The detection / notification design on the code side is working as intended.**
>
> **Resolution: exit without changes**
>
> This is an external-credential operational issue (PAT expiry), and what needs to happen is **a human rotates the PAT in Secret Manager**. Not the kind of incident code can resolve. Therefore: no code change, no commit, no PR.
>
> Operator actions:
> - Add a new version of the target secret in GCP Console / Secret Manager with a valid PAT (`repo` scope, read access to the target repository)
> - No Cloud Run revision redeploy needed (`secretKeyRef version:latest` is referenced)

At this level of detail, "what was investigated, why code can't fix it, what the human should do" all come out in one Slack message. Open the thread and the operator can act immediately. The productivity gap vs. "alerts just forwarded blindly" is significant.

### Deduplication

A throttle ensures the same `fingerprint` (Grafana's unique alert identifier) is **not re-processed for 4 hours**. Without this, alerts that fire again before the fix PR has merged would spawn another worktree, another fix PR, and so on -- an easy infinite loop.

We also **permanently skip** any `alertname` containing `credential`. Credential incidents carry leakage risk if the AI touches them, so they're explicitly escalated to humans.

### Self-Healing and Part 3 auto-review -- "the fixer AI" and "the reviewer AI" are independent

This is the most consequential design choice of the agent setup, so calling it out explicitly.

PRs opened by Self-Healing are **not special PRs, just fix PRs**. They go through the Part 3 auto-review pipeline **under exactly the same conditions** -- the 9 lenses (Graph / Architecture / Security / Test / Doc / Impact / Observability / AI-Antipattern / Recurrence) get checked in order. Critical / Major findings -> `REQUEST_CHANGES`; Nit-only / no findings + CI green -> `APPROVE` -> auto-merge.

The important bit: **this is not a monolithic "AI fixing AI" loop**. The fixer-side AI and the reviewer-side AI are fully independent:

- **Different process, different session**: the self-healing-mode AI and the reviewer-mode AI are launched as separate `claude -p` processes. They do not share context
- **Different input sources**: the fixer builds the problem from Grafana alert + Loki + cpg. The reviewer judges from the PR diff + cpg + review guidelines
- **Different objectives**: the fixer is optimizing for "stop the incident." The reviewer is judging "does this violate the 9 lenses or the severity contract?" A deliberate separation of concerns where the two roles' incentives are intentionally misaligned

As a result, **PRs the fixer dashed off get blocked by the reviewer** (REQUEST_CHANGES -> back to the fixer). The AI does not approve its own output. "Just-make-it-work" fixes don't get through.

This is the often-debated **review-independence** problem in LLM-agent operation, solved here in the obvious way: split the work across separate agents.

### A concrete example: meet subscription's 409 ALREADY_EXISTS

Take the alert from the Google Meet recording auto-fetch service I covered in [the Meeting Intelligence post](/posts/meeting-intelligence). On 2026-05-21, Self-Healing opened a fix PR titled `fix(meet-subscription-renewal): auto-fix for Service Error Log Detected`.

The trigger error from Loki:

```text
Workspace Events API request failed: 409 Conflict
"Subscription associated with the resource already exists."
```

How the AI investigated:

1. **Pinned the error in Loki** -- ran `{service_name="meet-subscription-renewal"} | json | level=~"ERROR|error|Error"` via Grafana MCP, picked up the `Failed to renew Meet subscription` stack trace
2. **Traced the call path in Product Graph** -- identified `renewSubscriptions` -> `createMeetSubscription`
3. **Cross-referenced past PRs** -- the "opposite-direction inconsistency" (name in Firestore but missing from Google = 404) had already been self-healed in another PR with `patchMeetSubscriptionTtl` -> null fallback. **The current direction (still on Google's side but missing from Firestore = 409) was the gap**
4. **Verdict**: "the same pattern may exist elsewhere" -- a [Recurrence] decision matrix "**horizontal expansion required**" case

Instead of a quick patch, **it implemented the same-direction self-healing symmetrically to the opposite-direction fallback that was already there**:

- Made `createMeetSubscription` idempotent
- If POST returns 409, extract the existing Subscription name from the response and call `patchMeetSubscriptionTtl`
- The caller writes the return value back into Firestore, so the next renewal converges to the normal PATCH path (**self-healing**)
- Per the existing `graph/no-silent-catch` lint, JSON.parse failures are also `logger.warn` + `serializeError` for structured logging
- Three tests added

This is what "Self-Healing pushing all the way to root cause and rolling the fix out horizontally" looks like in practice. **"Close the recurrence class, don't just suppress the symptom"** (the spirit of [`recurrence-prevention.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/en/guidelines/recurrence-prevention.md)) executed autonomously by the AI.

## Strengthening -- Guides (lint + guidelines) grow automatically

This is the layer that **keeps Self-Healing from being just "auto-repair."**

In Fowler's Guides / Sensors terms from [Part 1](/posts/ai-harness-intro), the Strengthening layer is **the place where Guides grow** -- i.e. the pre-execution controls that prevent AI from deviating in the first place. cortex's Guides come in two flavors:

- **Machine-read Guides**: lint / type / CI guard / coverage thresholds / Prettier -- enforced at commit / CI time
- **Human-and-AI-read Guides**: guidelines like [`recurrence-prevention.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/en/guidelines/recurrence-prevention.md), [`severity.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/en/guidelines/severity.md), [`ai-antipattern.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/en/guidelines/ai-antipattern.md), etc. -- used as decision criteria by auto-review

The 9 lenses, severity contract, and no-downgrade rules from [Part 3](/posts/cortex-auto-review) are the latter; the auto-added lints in Part 4 are the former. **Together they form the Guides surface**. Lints are "formalized guidelines," guidelines are "lints that haven't been formalized yet."

The Sensors side -- Self-Healing and auto-review -- **grow these Guides every time they run**:

- Self-Healing's root-cause investigation finds "the same pattern exists elsewhere" -> demands horizontal expansion + a new lint (= new Guide)
- Auto-review's `[Recurrence]` lens blocks PRs that fix without adding lint
- Both depend on [cpg](/posts/cortex-product-graph) to see impact scope across the codebase

cpg is what lets the AI ask "where else does this trap exist." Self-Healing and auto-review (= the Sensors side) **share cpg as a substrate, and each run thickens Guides by one notch**.

![cpg as the shared substrate; Self-Healing and auto-review (Sensors) grow Guides](/images/posts/cortex-self-healing/mutual-reinforcement-en.png)

### What happens every time Self-Healing runs (the recurrence-prevention-first flow)

Every fix PR Self-Healing opens is checked for `[Recurrence]` by auto-review. The decision matrix:

| Situation | Required action | Form |
|---|---|---|
| Same trap stepped on 2+ times | **Lint required** (custom ESLint rule / type constraint / CI guard) | Machine (new Guide) |
| Pattern may exist elsewhere | **Horizontal expansion required** (cpg traversal for similar nodes, fix all of them in this PR) | Investigation + fix |
| Cannot be machine-checked but worth formalizing | **Add to an existing guideline** | Guideline entry |
| One-off, no value in formalization | **Nothing** (bug fix only) | -- |

When the "stepped on 2+ times" situation applies, **the fix PR can't merge without a new lint included**. So every Self-Healing run produces:

1. **Horizontal expansion via cpg** -- not just the immediate fix target, every similar node enumerated
2. **A new Guide added in the same PR** -- ESLint custom rule / type constraint / CI guard / guideline entry, one of the four
3. **All existing violations cleared in the same PR** -- no `warn`-as-deferral, `error` on first introduction
4. **Auto-review -> auto-merge -> auto-redeploy** -- the regular Part 3 pipeline
5. **Going forward, writing the same pattern gets mechanically rejected by CI / lint** -- the recurrence class is structurally closed

![5 steps every Self-Healing run produces -- recurrence-prevention-first flow](/images/posts/cortex-self-healing/recurrence-prevention-flow-en.png)

"Add the guard while you fix the bug" runs as a self-sustaining loop driven by Self-Healing.

### "We'll do it later" and "introduce as `warn`" are banned

A couple of important contract clauses from the guidelines:

- "Plan to lint later," "lint when we refactor," "another PR will handle this" -- **all banned**. If it can be addressed in this PR, it must be
- "Existing violations remain, so introduce as `warn` and promote to `error` later" -- **not accepted**. This is deferral in disguise. The responsibility for the `warn`->`error` promotion goes nowhere and the rule rots
- If you add a lint rule, **fix all existing violations in the same PR and ship at `error`**

These extend the **no-downgrade rules** from [Part 3](/posts/cortex-auto-review) -- preempting the typical escape hatches.

### The "step on it, mechanize it" lineage

Custom Guides currently piled up in cortex:

- **`graph/no-silent-catch`** (ESLint) -- the source of the "inflated number" mentioned in the intro. Bans catch blocks that swallow exceptions
- **Stacktrace-preservation guideline** (codified as a Major violation in [`observability.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/en/guidelines/observability.md), caught by auto-review) -- forbids `logger.error(err.message)` style logs that drop the stack and keep only the message string. Forces the `err` field to hold `serializeError(error)` so `name` / `message` / `stack` are preserved as structured fields. **Observability is everything** here, so logs that drop stack info are treated as inherently broken
- **`cortex-quality/require-fetch-timeout`** (oxlint -- a Rust-implemented JS/TS lint that runs ESLint-compatible rule sets, dozens of times faster than ESLint due to the Rust impl. cortex uses oxlint for the standard ruleset and ESLint for custom rules that need AST-level work) -- mandates `signal: AbortSignal.timeout(...)` on external `fetch` calls. Born from a case where a no-timeout `fetch` hung indefinitely and triggered a Cloud Tasks redelivery storm
- **`graph/no-bq-string-timestamp-param`** (ESLint) -- from a case where passing TIMESTAMP as a string to a BigQuery query parameter NULLed the value out through a serializer bug and silently failed every INSERT
- **`graph/require-firestore-ignore-undefined`** (ESLint) -- forces `ignoreUndefinedProperties: true` on `new Firestore()`. From a case where a single NULL row caused a 100% failure rate in a sync batch
- **`check-otel-env-injection`** (CI guard) -- the recurrence prevention for the Cloud Run OTel env injection case below
- **TypeScript type tightening** (type level) -- tighter function signatures, branded types for ID disambiguation, exhaustive discriminated unions, etc. Patterns that can't be lint-caught but are catchable at the type level get closed from the type side

These aren't textbook-learnable rules -- they're "**stepped on once, then mechanized**." The number of traps the organization has stepped on translates directly into the number of Guides piled up (across ESLint / oxlint / CI guard / types).

### How does the AI write a lint rule without breaking it?

Three structural things keep this sane:

- **Existing rules are the template**: `packages/eslint-plugin-graph/src/rules/` already holds 26 custom rules, each as `.ts` + `.test.ts` pairs. New rules follow the same shape, so the AI never has to write the AST-walking boilerplate from scratch
- **Tests first**: violation / pass fixtures go into `.test.ts` first, implementation fills in TDD-style. Coverage threshold (90% statements + branches) is gated by the [Part 3](/posts/cortex-auto-review) auto-review, so a lint without tests cannot merge
- **lint / type / CI guard sit in the same "mechanize" bucket**: the decision matrix in [`recurrence-prevention.md`](https://github.com/air-closet/cortex-review-guidelines/blob/main/en/guidelines/recurrence-prevention.md) groups lint / type constraint / CI guard together as the "lint-required" row, and leaves the choice within that bucket (write it as a lint? express it at the type level? add a separate CI guard?) to the AI based on how much AST work is involved and whether runtime semantics matter. Traps that need AST inspection but actually hinge on runtime behavior usually end up as a type constraint (branded type / discriminated union / signature tightening) rather than a custom lint

So "AI writes a lint rule" is supported by **existing rule corpus + the test harness + the mechanize-bucket selection criteria** -- three together. The path where the AI hand-rolls raw ESLint API and bricks something is structurally closed.

### A concrete example: Cloud Run OTel env injection -> promoted to CI guard

Multiple services hit this trap: when a Cloud Run Service / Job is defined in Pulumi, forgetting to inject `OTEL_EXPORTER_OTLP_ENDPOINT` and `GRAFANA_CLOUD_API_KEY` via `secretKeyRef` causes OTel init to be skipped in production, no trace/log reaches Grafana, and incidents become silently invisible.

The normal response would be "we'll be more careful next time." At cortex:

1. Incident surfaces -> Self-Healing opens a fix PR (adds the env injection to the affected service)
2. Auto-review's `[Recurrence]` decides "same trap stepped on -> lint required"
3. The same PR adds `scripts/check-otel-env-injection.ts` (CI guard) -- mechanically asserts OTel env injection across all Cloud Run resource definitions under `infra/`
4. All other existing services get their env injection added in the same PR
5. Merge -> deploy -> any future write of the same kind gets rejected by CI

That's what "the guardrails grow every time Self-Healing runs" looks like in practice. The trap is "stepped on -> mechanically checked from then on."

### Where Guides stand right now (in numbers)

Snapshot of cortex's Guide inventory:

| Category | Count | Notes |
|---|---|---|
| **Custom ESLint rules** (`@cortex/eslint-plugin-graph`) | 26 | `no-silent-catch` / `require-firestore-ignore-undefined` / `no-bq-string-timestamp-param` etc. |
| **CI guards** (`scripts/check-*.ts`) | 13 | `check-otel-env-injection` / `check-cloudscheduler-oidctoken-audience` etc. |
| **Standard oxlint rules** (set to `error`) | 183 | Base config ships everything at error |
| **TypeScript strict gates** (baseline) | 9 | `strict` / `noImplicitAny` / `strictNullChecks` / `noUncheckedIndexedAccess` etc. |
| **TypeScript type tightening** (per-recurrence) | grows over time | branded type / discriminated union / function-signature tightening etc. Patterns that can't be lint-caught but can be type-caught are closed from the type side |
| **Test coverage thresholds** | statements + branches 90% | Uniform across all packages |
| **Prettier** | 1 config | Format auto-fix |
| **Guidelines** | the entire review-guidelines repo | Used as the decision basis by auto-review |

The first two categories plus the type-tightening row -- **Custom ESLint, CI guard, type tightening** -- are the part that **compounds over time** through the `[Recurrence]` lens every time Self-Healing or auto-review runs. **The guardrails grow with time.** That's the substance of the Strengthening layer.

## The whole loop, from the top

When you compose the three layers:

```
[production anomaly] -> Observation layer (OTel/Loki/Grafana) -> Alert firing
                                              ↓
                                       Event Relay -> SSE
                                              ↓
[Self-Healing mode script]
   - claude -p in worktree
   - root cause via cpg + Loki + git blame
   - commit fix
   - (if applicable) add new lint / type gate too
   - gh pr create
                                              ↓
[Auto-review (Part 3)] -- 9 lenses in order, especially [Recurrence] forces
                         recurrence-prevention action (lint / horizontal expansion / guideline entry)
                                              ↓
                          APPROVE + CI green
                                              ↓
[auto-merge -> Turborepo build -> Pulumi parallel deploy]
                                              ↓
[production recovered + same anti-pattern mechanically rejected from now on]
```

The loop **completes without human intervention**. Not just repair, but the quality gates that grow with every repair -- that's the "auto-recovery + auto-strengthening" substance at cortex.

That said, as the front of the article spelled out, **the loop is only viable because cpg and Observability exist**. cpg makes horizontal expansion possible; Observability turns production anomalies into structured data. With those two in place at the foundation, AI can stand on the side that does Repair and Strengthening. **Self-Healing is not a standalone mechanism. It's a Sensor riding on top of cortex's Guides (cpg + Observability + lint + guidelines).** That's the single most important framing in this post.

## Self-Healing by the numbers

Breaking the headline down further.

### Main firing categories

What kicked off Self-Healing in the past 30 days (with the mapping back to the front-of-post 2 buckets):

| Category | Bucket |
|---|---|
| **Service Error Log Detected** (most frequent) | Production-runtime (61 side) |
| **Pipeline Failure** -- data pipeline failing a configured number of times in a row | Production-runtime (61 side) |
| **Generator Failure** -- AI generation jobs (embedding / annotation etc.) failing | Production-runtime (61 side) |
| **Deploy Failed** -- deploy step failures (Pulumi up / Cloud Run revision failed) | Deploy step (54 side) |

### Alert-firing to production-recovery time

Median **30 minutes to 1 hour**. Roughly:

- Alert firing -> AI investigation start: under 1 minute (Event Relay + SSE)
- AI investigation + fix + PR open: 3-8 minutes
- Auto-review (including the [Part 3](/posts/cortex-auto-review) **10.8 review-fix iterations on average**): 20-45 minutes
- Auto-merge + deploy: 3-10 minutes

Many of these finish before anyone wakes up (alert fires early morning -> by the time people come in, there's just a ✅ in Slack).

## What changed / Bridge to Part 5

We've now covered **the cortex picture across Parts 1-4**:

- [Part 1](/posts/ai-harness-intro): the cortex big picture and harness-engineering framing
- [Part 2](/posts/cortex-product-graph): Product Graph (cpg) -- the AI's "brain"
- [Part 3](/posts/cortex-auto-review): auto-review -- defending quality at the PR stage
- **Part 4 (this post): Self-Healing + Observability + auto-added guardrails -- defending quality in production while growing the quality gates themselves**

The engineering role has shifted, over the last half-year, from "**write**, **review**, **fix**, **merge**, **deploy**, **incident-respond**" -- all of that -- toward **looking at the whole system from above and tuning it**. `human-on-the-loop`, working at the Policy layer.

**Part 5** covers the harness reaching the "who writes the code" layer. The center of it is **domain experts (business-side managers, PMOs — non-engineers) opening PRs to production**, with a concrete walk-through of a +1,742 line / 41 file feature PR that landed with zero human reviewers in the loop. What guarantees the quality is the harness stack built across this series — "whoever writes, the harness owns the quality gate" is the Part 5 framing.

The toC service expansion gets a brief mention at the end for direction, but the full implementation discussion lives in a separate post.

The actual series wrap-up is **Part 6**. The center of it is **the underlying philosophy** -- why I picked this design, what I gave up, what I kept. Alongside that, since the series so far has been mostly "what's working," I want to look back at the failures and dead ends behind that surface, and the gap between the philosophy and the implementation. A retrospective for myself, and -- hopefully -- a reference for anyone starting down a similar path.
