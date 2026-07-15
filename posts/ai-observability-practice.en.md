---
title: "Observability Design for the AI Era — Reconciling PII Protection With AI Searchability, and Driving Self-Healing"
publishedAt: "2026-07-14T08:30:00+09:00"
updatedAt: "2026-07-14T08:30:00+09:00"
slug: "ai-observability-practice"
summary: "Part 1 laid out four monitoring axes (application / infrastructure / CI / LLM) and the shape each one ends up in. Part 2 picks up where the data actually flows: it's production data, with PII in it. This post is about a multi-layer PII design that hashes at both write and search time with the same function, an integration surface where humans (web dashboard) and AI (MCP) share the same backend, and how all of that becomes the real driver of Self-Healing — running from CI failure to PR proposal end-to-end."
emoji: "🛡️"
tags:
  - "ai"
  - "observability"
  - "mcp"
  - "typescript"
lang: "en"
series: "ai-observability"
seriesOrder: 2
syndication:
  devto:
    id: 4022945
    slug: "observability-design-for-the-ai-era-reconciling-pii-protection-with-ai-searchability-and-driving-2f0l"
    contentHash: "7fc2c7de194b8c1a"
    publishAt: "2026-07-14T08:30:00+09:00"
cover: /images/posts/ai-observability-practice.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

In [Part 1](/posts/ai-observability-design), I walked through the four monitoring axes (application / infrastructure / CI / LLM) and the deliberately different shape each one ends up in. That's the **write-side** of the observability stack, more or less wrapped up.

But shaping the write side isn't the end of the story. The moment **production data flows through the stack**, you have to block the path PII can take to slip in — and that's true with or without AI. It's the kind of classic observability problem where, if you cut corners, you walk straight into a leak incident.

Historically, the set of people who could read logs mostly overlapped with the set who could read the DB. For engineers with DB access, logs weren't an *additional* path to personal data — which put log-side defenses in a position where hardening them didn't meaningfully move the overall defense line for most organizations.

AI breaks that premise. Non-engineers pulling logs over MCP don't have DB access. Logs became, for the first time, **a path where someone without DB access can reach personal data**. On top of that, log content now flows into AI's input, which introduces new exposure surfaces: transmission to the model, and re-surfacing in the model's output. Log PII protection has shifted from "hygiene worth doing" to **"required as a trust-boundary redesign."** That's the premise this post starts from.

And on top of that, if **the observability stack isn't queryable by AI**, the whole "AI-consumable observability" goal from Part 1 falls apart.

Part 2 is about how I reconciled these two — **protecting PII while keeping searchability for AI** — and how that combination ends up driving **Self-Healing from CI failure to PR proposal**.

## The Observability Stack Is a Natural Path for PII

App emits a log → it lands in Loki → AI queries it through MCP. Stand up this naive flow and you get:

- Customer email addresses and phone numbers in error logs
- Order response payloads riding inside traces
- DB query logs that emit full table rows

Plain-text PII pooling in the observability stack means **AI can search it directly**. This isn't really an AI problem, it's an observability problem: the stack itself becomes a PII conduit. At the same time, if you scrub PII completely, you lose **"I want to investigate Customer A's support ticket"** as a query, which is a normal support workflow.

cortex (the internal AI platform) had to reconcile both. The key principle was: **don't make "block the PII path" and "search by PII" mutually exclusive**.

> **Note**: "cortex" here refers to airCloset's internal AI platform codename. Unrelated to Snowflake Cortex, Palo Alto Networks Cortex, etc.

## Multi-Layer PII Design — Six Layers

cortex's PII handling is six layers, each with a different role:

| Layer | Purpose | Mechanism |
|---|---|---|
| **Write: BQ Policy Tag** | Column-level access control | `pii_high` / `pii_medium` / `pii_low` three-tier taxonomy. Without fine-grained reader on the column, SELECT errors out with `Access Denied` (pure CLS (Column-Level Security) — no dynamic masking) |
| **Write: ETL DLP** | Strip plain-text PII from derived tables | Cloud DLP redacts during transforms (customer support data, etc.). Placeholders like `[EMAIL_ADDRESS]` / `[PHONE_NUMBER]` preserve the structure |
| **Write: log hashing** | Plain text never reaches Loki | App-side hash via `hashEmail` (HMAC-SHA256 → 12-char prefix; key lives outside the observability stack) before log emit |
| **Search: same function on both sides** | Look up a specific customer's logs without ever touching plain text | Query-side runs the same `hashEmail` before sending to Loki |
| **Output: MCP masking** | Mask when AI consumes | Column-name detection masks the local part (e.g. `r***@air-closet.com`), keeping `@domain` so first-response triage can still tell which domain the account belonged to |
| **Identity separation** | Internal staff email is handled in a separate track from customer PII | HMAC-signed by Edge Router as auth attribution; not part of the masking pipeline |

The fourth row — **search with the same function on both sides** — is where the security / usability tradeoff gets really tight.

I'll use email as the running example, but the six layers guard more than email. PII spans **names (including phonetic readings), phone numbers, addresses, postal codes, dates of birth, card and bank details, external-service IDs**, and more. The anonymization technique varies by the nature of the field — same-function hashing to preserve correlation (email, phone), partial masking (names, addresses), full redaction (card numbers, tokens) — and that call is made per field. What stays constant is **the structure: which of the six layers guards it, and how**. That's the reusable part of the design.

And this anonymization isn't confined to observability logs (Loki) either. An MCP tool that queries a service DB, for instance, pulls customer names, addresses, and phone numbers into its result set, so the same PII anonymization rules run before anything is handed back to the AI. The consistent rule is **"anonymize PII on every data path that reaches the AI,"** applied across data-source types, not just one.

## Hash on Both the Write and Search Sides

Naively "remove PII from logs" and you can no longer answer "let me look up Customer A's logs." But if you **hash at write time and store that hash in the log**, the search side can run **the same hash function over the input** and find the matching record. Plain-text email never touches either end.

![Hash on both write and search to keep plain-text PII out of the observability stack while preserving search](/images/posts/ai-observability-practice/pii-round-trip-en.png)

Concretely:

**Write side:**

```ts
// Application code
logger.info("Subscription updated", {
  user: hashEmail(user.email), // → '7a3f9c2e0b1d' (HMAC-SHA256 12-char prefix)
  plan: "monthly",
});
// → Only the hashEmail result ends up in Loki
```

**Search side (when you want to pull a specific customer's logs):**

Here's the awkward part. "Pull up Customer A's logs" — the naive way to build it hands the raw email to the AI, which then passes it to an MCP tool to search. But that means **handing plain-text PII to the AI (the model, and the vendor behind it)**. Guard the inside of Loki with hashes all you want; it leaks at the search input, one step earlier.

So in cortex the search tool takes a **non-PII ID, resolves it to an email inside the MCP server, hashes it there, and returns only the hash**. The email exists only inside the MCP server and never reaches the model:

```ts
// MCP tool resolve_email_hash (runs server-side)
// Input is an ID (non-PII). The email is never returned to the caller = the AI.
const email = await resolveEmailById(userId); // resolved from the DB, server-side
const hash = hashEmail(email, secret);        // same function, same key as the write side
// → the AI gets back only the hash, never the email
```

The AI takes that `hash` and searches Loki via Grafana MCP as `{service_name="subscription"} |~ "${hash}"`. Both the write side and the search side run **the same `hashEmail` with the same key**, so logs from the same customer collapse to the same hash. Meanwhile:

- **Plain-text email never enters Loki**
- **The query string Loki sees doesn't contain plain-text email either** (only the hashed value reaches it)
- And **the AI (the model) never receives plain-text email either**. All it touches is a non-PII ID and hashes that already live in Loki. The plain-text email never leaves the trust boundary of the MCP server.
- **Enumeration resistance comes from keeping the HMAC key outside the stack**. Email is a low-entropy, enumerable input space, so **a bare one-way hash (plain SHA-256, etc.) is breakable**. The hash function is public, so once logs leak, an attacker just hashes a list of likely emails on their own machine and matches against the leaked values, no key required. **HMAC folds a secret key into the hash computation itself**, so an attacker who doesn't have the key can't even turn a candidate email into "the same shape as the leaked hash." They never get onto the brute-force field. Keep the key only at the write side and the search tool, never in Loki itself, and you get "a log leak alone doesn't expose the plaintext unless the key leaks too", one more condition an attacker has to satisfy
- Truncating to a 12-char prefix (48 bits) means collisions are possible in theory, but negligible at customer-base scale. By the birthday problem, the 50% collision point sits around 20M records (≈ 2^24.5), and below that the expected collision count stays tiny. More to the point, a collision **wouldn't leak plaintext anyway**: this hash is a correlation key for identifying a customer's logs, not a security boundary, so the worst case is "another customer's logs occasionally land on the same hash", a degradation of correlation accuracy, not a disclosure

This reuses the property "same input → same hash" of hash functions in the form "**the same function on both sides makes search work**." The security / debug usability tradeoff compresses cleanly.

And of course, this is all just the **app log layer**. The BQ side is protected by Policy Tag-based column-level access control as its own layer (rows 1–2 of the table above). The whole thing is multi-layered.

What makes the "take an ID, resolve and hash inside" shape work is that **plain-text email never crosses the trust boundary of the MCP server**. The easy implementation (hand the AI a raw email, let the tool search) leaks the plaintext to the model at the search input, no matter how well you guard the inside of Loki. You could argue "the vendor's terms say it won't leave," but that's a dependency on terms, and it's weak under audit. Take an ID and hash inside, and you keep plaintext away from the model **structurally**, not contractually. When I said up top that PII protection has become "a trust-boundary redesign," this is the kind of design call I meant.

An aside: when I was working this out, I asked an AI for help, and it suggested building an admin screen where a human manually turns emails into hashes. That's one way to keep PII away from the model, sure, but it **doesn't fit autonomous operation** — a human has to step in before any investigation can start. cortex is built to run all the way through to "fixed before anyone notices" self-healing, so a solution that inserts a human isn't on the table. "Take an ID, hash inside the MCP server" came out of that constraint. What counts as an acceptable solution was, in the end, a design judgment on my side.

## Integration Surface — "Humans = Web, AI = MCP" on the Same Backend

Three backends (Prometheus / BigQuery / Loki) now carry the observable data, and PII is handled. The next question is **who queries them, and how**. The common trap is to build "human dashboard aggregations" and "AI data feeds" separately. The moment you do:

- Two implementations chasing the same question
- Numbers drift between them
- It becomes unclear which is canonical
- Aggregations for AI and for humans update on different schedules

cortex's choice: **share one observability backend; only the consumer-facing interface differs.**

![Same observability backend (Prometheus / BQ / Loki) — humans through the web dashboard, AI through MCP](/images/posts/ai-observability-practice/integrated-surface-en.png)

### Human side: AI Operations Portal

There's an internal portal (codenamed PI Lab) that aggregates dashboards by monitoring target:

- **Claude Code usage** (the cc-usage screen from Part 1)
- **MCP tool usage** (by server / tool / user / team)
- **Infrastructure cost** (Gemini / GCP / AWS / GitHub on one screen)
- Alert state, deploy history, etc.

Here's what the MCP usage dashboard actually looks like:

![MCP tool usage dashboard — call count per server / tool plus average execution time](/images/posts/ai-observability-practice/mcp-usage-dashboard-en.png)

Over the past 30 days, `service-product-graph` had 37,946 calls (with 7,106 errors), `gws` had 19,350, `db-graph` had 17,297 — and that's just the top. **Which MCP is used how much, where the failures are showing up** — all visible at a daily glance. (The "high error rate" some servers seem to have is partly typed errors counted in — expected rejections like "permission denied" — so the interpretation needs care.) The "annotation graph MCP, ~50,000 calls / 73 users" figure from the previous series came from this same view.

These pages on the React side pull from BQ / Prometheus / Loki through an internal API. The aggregation logic lives at the API layer.

### AI side: MCP

When AI agents need the same data, they go through purpose-specific MCPs:

- **Grafana MCP** — LogQL / PromQL queries against Loki / Mimir / Prometheus / Tempo. Natural-language questions like "What time window had the most errors on Service X last week?" are the agent's job to translate into LogQL / PromQL before they go over MCP
- **BQ MCP** (via cortex-product-graph) — SQL queries against `claude_usage.claude_usage` / `cortex.mcp_tool_calls`

The design pivot: **the human dashboard and the AI MCP share the same backend.** No separate "AI aggregation table" and "human aggregation table." Build the observability backend once, then provide **a consumer-specific interface layer** (web dashboard / MCP) on top.

In DDD terms, MCP and the web dashboard are both just **presentation layers** — different I/O channels into the same domain (the observability backend). Treating MCP as "something special" leads to duplicate implementations; treating it as one presentation layer form keeps the design clean.

That's exactly why "the observability stack is visible to AI" actually holds. Build the backend, but without **an AI-facing presentation layer (= MCP)**, AI can't query it. MCP is the piece that makes "hand it to AI" actually work.

## The Real Driver of Self-Healing

The layer that keeps the observability stack from being "just a screen to look at" is Self-Healing. I covered the full picture in [AI Harness Series Part 4](/posts/cortex-self-healing), so I'll skip the details here, but from the observability side, the start and end of the chain are clear:

![Self-Healing chain from CI failure / production alert to PR proposal](/images/posts/ai-observability-practice/self-healing-chain-en.png)

The flow:

1. **Detect** — Production alert / CI failure fires a Loki LogQL alert
2. **Deliver** — POST to event-relay (the internal webhook hub)
3. **Launch** — auto-review bot starts up (= an agent backed by Claude Code)
4. **Gather context** — The bot pulls full logs via **Grafana MCP**, traces related PR / commit / code via **Product Graph MCP**
5. **Propose** — File a fix PR
6. **Verify** — If CI passes, the bot auto-merges; if not, another bot reviews

So the starting point of Self-Healing is **whether the observability stack can hand "what broke" to AI in the right shape**. If errors aren't recognized / stacktraces aren't preserved / related code (PR / commit / graph) isn't reachable — any of those missing and the chain stops cold. (The specific failure modes are in the next section.) Put another way:

> **The quality of observability is the ceiling for AI autonomous operation.**

That's the central claim of Part 2. Reframe the observability stack as **"input that drives AI,"** not "monitoring infrastructure," and the priorities of your design decisions shift accordingly.

## What's Still Open — Defining "What Counts as an Error" and the Stacktrace Design

The biggest remaining issue, honest version.

You can polish the observability stack to a mirror finish, but if the design of **what counts as an error** and **whether the stacktrace survives** falls apart, all of it is wasted. I touched on this earlier in [AI Harness Series Part 2](/posts/cortex-product-graph) in the context of cortex's internal knowledge graph, and it shows up on the observability side too.

Concretely, here are the failure modes:

- `try ~ catch` swallows the error without logging → nothing reaches the observability stack
- catch *does* log, but at `console.log`-equivalent info level → not recognized as an error
- Error gets emitted, but only `error.message` is written; stacktrace is dropped → AI can't trace back to the original code
- An async error goes unhandled and the process falls over

These are all **problems at the code that creates the observability entry point**, not at the observability stack itself. No matter how polished the stack is, if the faucet at the entry point is broken, nothing flows out.

What's in place today is three layers, none of them complete:

- **lint (static)** — The `no-silent-catch` rule blocks empty catches and `.catch(() => null)`-style swallows. But once there's *any* function call inside the catch, lint is satisfied — so patterns like "demote to `logger.info(err.message)`" or "log only `error.message` and drop the stacktrace" slip through statically
- **Guideline document** — Rules like "use `serializeError(error)` to store stacktrace as a structured field" and "dropping `stack` via `logger.error(err.message)` is a Major violation" are written down in the internal guidelines. But static checking can't enforce these; they rely on human / AI review
- **AI auto-review** — The PR auto-review bot does look at test coverage including "are error cases being tested," but it has no observability-specific checklist, so it can't systematically catch stacktrace design quality

In other words: **"There's a guideline, lint catches some, AI review catches some, but it's not airtight"** is the honest description. The real gap is that **at the moment new code is being written, there isn't a harness that proactively suggests / completes "this should be treated as an error, this should keep its stacktrace."** Auto-review picks things up at PR time, but a proactive harness for the observability entry-point design itself isn't built yet.

"Observability stack: done. Observability target design: still on humans." That's the honest picture. Closing that gap with a harness is the next step.

## Closing — Static Edition + Dynamic Edition Are Lined Up; Merging Them Is the Next Series

[The code-graph series](/posts/code-graph-46-repos) was about reshaping a static analysis graph so AI could query it — **handing the structure of code as fact**. This two-part series was about **handing what's happening in production right now, also as fact**.

| | Shape | What's Handed Over |
|---|---|---|
| Static edition (code-graph + db-graph + annotation graph) | 3-graph parallel + SAME_ENTITY | Code and meaning |
| Dynamic edition (Part 1 + this post) | Prometheus / BQ / Loki + MCP | Production behavior and cost |

The honest part: these two **still sit side by side**, not joined. For cortex's stated principle of "**don't let AI infer — hand it facts**" to truly reach completion, the next step is to **pour dynamic data into the static graph and merge them**. This is the exact same gap I flagged as the "absence of dynamic analysis" open issue at the end of code-graph Part 2: putting "how often is this edge actually used in production?" on the static graph's nodes. That's when "hand it as fact" reaches its final form.

Layer Self-Healing on top of static + dynamic and you get "AI autonomously operates," which works today. But **merging the two editions into one graph is still ahead — that's the next series.**

And one more time, observability target design (what counts as an error, whether stacktrace survives) is what really sets the ceiling. Harness-ifying that is the next homework item.

Thanks for reading this far.
