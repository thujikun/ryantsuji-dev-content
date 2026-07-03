---
title: 'AI-Native Redesign: Re-solving "How Do We Make Accurate Information Accessible?" with AI as a Given'
publishedAt: "2026-07-21T08:00:00+09:00"
updatedAt: "2026-07-21T08:00:00+09:00"
slug: "ai-native-redesign"
summary: "Every organization eventually faces the same design problem: keeping important information stored, current, and reachable at scale. This post frames that as a three-node loop (creation / maintenance / consumption) and works through what redesigning it with AI as a given looks like, as opposed to bolting AI onto a human-first setup. Along the way it recasts earlier posts on cortex — code-graph, product-graph, AI-Observability, auto-review harness — as different applications of the same underlying principle."
emoji: "🧭"
tags:
  - "ai"
  - "architecture"
  - "knowledgegraph"
  - "observability"
lang: "en"
syndication:
  devto:
    id: 4056809
    slug: "ai-native-redesign-re-solving-how-do-we-make-accurate-information-accessible-with-ai-as-a-given-3e22-temp-slug-1100473"
    contentHash: "f7866bc88fe1828a"
    publishAt: "2026-07-21T08:00:00+09:00"
cover: /images/posts/ai-native-redesign.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset (a fashion-rental subscription service based in Japan).

> **Disclaimer**: "cortex" in this article is the internal codename for the AI platform built in-house at airCloset. It is unrelated to existing commercial services like Snowflake Cortex or Palo Alto Networks Cortex.

I've been writing about individual application designs and about cortex — the AI platform we're building internally at airCloset. Each post has been centered on one piece of it: [code-graph](/posts/code-graph-46-repos), [product-graph](/posts/cortex-product-graph), [db-graph](/posts/db-graph-mcp), [biz-graph](/posts/initiative-graph-rag), [AI-Observability](/posts/ai-observability-design), the [auto-review harness](/posts/cortex-auto-review), and [Self-Healing](/posts/cortex-self-healing).

This post isn't about any of those implementations. It's about the design principle sitting behind all of them — one abstraction level up from any individual system, so more essay than build log.

The principle, in one sentence: **how do we make accurate information accessible?** It's an old question. Libraries, legal case books, encyclopedias, search engines — every era has had its own answer using whatever tools that era gave it. Even the technology revolutions people call "paradigm shifts" mostly just changed the *means*. The underlying question didn't move.

Now AI has arrived, and my read (probably not a controversial one) is that its shift is at least on the scale of the internet, possibly larger. As with every previous paradigm shift, the means of answering "how do we make accurate information accessible?" will get redesigned from the ground up. That's what this post is about: **AI-Native Redesign** — a view where you rebuild the whole design with AI treated as a given, instead of bolting an "AI tool" or a RAG layer onto a design that was optimized for humans doing everything.

## The Underlying Principle

### Splitting the Principle into Three Nodes

The frame I use: split the principle into three nodes — **creation / maintenance / consumption**. Someone (or something) creates it. Someone maintains it. Someone consumes it.

A library: creation = the catalog and classification system, maintenance = adding new titles and updating the shelves, consumption = someone borrowing a book. Legal case books and lawyers: creation = courts writing their rulings, maintenance = new cases getting added to the corpus, consumption = a lawyer looking up a matching case for a client. Engineering docs at a company: creation = writing the spec or README, maintenance = updating it when the code changes, consumption = another engineer reading it while implementing. In every case, each of the three nodes has someone owning it, and the whole thing only works when all three keep turning.

As long as the three of them are held together by a chain of trust and incentive, the system holds itself up. If one of them drops out, the whole thing slides into a negative spiral and quality decays. I'll come back to the specific mechanism later in this chapter.

"Information" here changes shape depending on the domain — knowledge in books, legal precedent, internal documentation at a company, runtime behavior of a service, customer trends, the reasoning behind a decision. What they all share is this: **as long as it lives only in one person's head, the moment scale kicks in the whole system stops working**. It only starts to work at scale once the information is stored in a form you can look up, and reachable when someone needs it.

### What Has Changed, What Hasn't

The means have changed a lot. Clay tablets, oral tradition, manuscripts, dictionaries and indices, the printing press, legal codes and lawyers, library classification, then in the last few decades: wikis and paper docs, APM and structured logs, searchable knowledge bases, distributed tracing, web-scale search engines, BI dashboards, RAG. Each era tried to optimize the three-node balance with whatever tools it had.

Wikis fit the 90s because "humans write, humans update, humans search" was the only shape available. APM appeared in the 2000s because storage got cheap enough to hold the telemetry that machines generate. Each generation had its own subject and its own tooling to answer with.

But the underlying question hasn't moved. Every era in every domain was solving the same problem — "make accurate information accessible" — with that era's tools. And in some sense, each generation was consciously designing the three-node balance. But once humans are in the loop, they cut corners on writing, forget to update, get things wrong, eventually stop maintaining, and the whole thing breaks. Some systems have held up (library systems, legal frameworks, established academic disciplines), but most have fallen into the negative-spiral side because the human limit was the binding constraint.

What makes AI different is that it dramatically widens the range where creation and maintenance can run without much human labor. Automating creation and maintenance is itself old news — deterministic systems have covered a huge amount of it, so widely that we don't even notice anymore. It's not just engineering infrastructure (APM, CI/CD, log collection, schema validation). Media services run on the same shape: articles get created, updated, and deleted through a system, then distribution pushes them to the app, the website, and the print edition. Bank transactions, e-commerce catalogs, routing data in a map app, the timeline in a social network. Deterministic automation is everywhere, quiet enough that it's easy to forget it's there.

But deterministic automation has a ceiling. There's a class of work it can't touch: qualitative judgment, articulating design context, updating documentation to follow a code change, adding annotations — anything that needs interpretation and context. AI is the first thing that reaches into that zone. And it can even sit on the consumption side (in the APM example, this means AI running the "look at the dashboards, close the improvement loop" work that humans used to do). Once the human requirement drops structurally, many domains can start running a positive spiral for the first time. But *how* to wire this expanded capability into your own organization's loops is still a human design call. That's what this post — **AI-Native Redesign** — is about.

> **Where this post lands**
> AI isn't a replacement for deterministic automation. It's a new capability that brings the zones deterministic tools never reached into the automation envelope — but redesigning your organization's loops around that expanded capability is what turns it into a change on the ground.

### A Closer Look at Each Node

**Creation.** Putting information into a form that can be looked up later. Writing the structure of your code down as docs. Instrumenting the runtime to emit logs and traces. Leaving the reasoning behind a decision as a design doc. Turning a customer trend into a KPI definition. Anything that leaves something behind in a form someone (or something) can come back to.

**Maintenance.** Keeping what you already wrote from drifting away from its source as that source changes. Code changes, the doc should follow. Service topology changes, the metric definitions should follow. Customer trends shift, KPIs should follow. Decisions get overridden, the record should follow. If creation is a one-shot act, maintenance is the standing chore that never ends.

**Consumption.** Actually reaching for what's stored and using it to decide or act. Humans reading. Machines querying. Alerts firing. AI agents pulling context. All of it counts.

These aren't sequential phases (creation → maintenance → consumption). They're **a single system held together by mutual trust and incentive** — you can't evaluate any one of them in isolation.

### The Negative Spiral — Why It Collapses in Most Real Places

Concretely, the interdependence looks like this:

- **If it doesn't get consumed, no one is motivated to create it.** Nobody keeps writing docs no one reads. No engineer polishes a dashboard no one looks at.
- **If it doesn't get maintained, it becomes unfit to consume.** A doc from six months ago gets a "probably stale" tag in someone's head and is skipped. A dashboard whose metric definition drifted since the last product change quietly seeds wrong decisions.
- **If it doesn't get created, there's nothing to maintain in the first place.** Information that was never stored in a queryable form can't be tracked as it changes.

As long as all three sides believe "my part is worth doing," the loop keeps turning. But if any one of them gets too expensive, the other two lose their incentive too. "Nobody's going to read it, and it'll rot anyway," "I updated it but no one cared," "when I search it's stale or wrong" — three separate excuses that reinforce each other, and the negative spiral picks up speed.

> **How this collapses in most places**
> If any one of the three nodes gets too expensive, the other two lose their reason to invest. The reason documentation cultures don't stick, monitoring stacks go stale, and knowledge bases quietly hollow out isn't a tool problem — it's structural. The balance between the three nodes has to hold, or the whole thing decays in silence.

That's why patching a single node never fixes it. Many people have seen the "our Confluence has 100k pages and no one reads or updates them" version of this. Not a Confluence problem — what happens when at least two of the three nodes (creation and maintenance) stay expensive, and the fix that gets applied is a search feature on the consumption side. The loop never closes.

![Three-node loop: negative spiral vs. positive spiral. A system built on the assumption that humans handle every node slides into a negative spiral where each side reinforces the others' reasons not to invest. Rebuilding with AI as a given — each of the three nodes as an AI × deterministic hybrid, where the split is a design call and deterministic is preferred — turns it into a self-sustaining positive spiral](/images/posts/ai-native-redesign/three-nodes-spirals-en.png)

### The Rest of This Post

Everything from here on works off the same principle: make information accessible, and run it as a three-node loop.

- **Chapter 2** lines up concrete cases from around us (internal docs, monitoring, business data, schema management, security) and shows how each one has been carrying its own version of the three-node problem.
- **Chapter 3** argues why AI is the pivot, from the angle of "the first thing that brings zones deterministic automation couldn't reach into range of automation."
- **Chapter 4** walks through the AI-native implementations in cortex (code-graph / db-graph / biz-graph / product-graph / Observability) side by side.
- **Chapter 5** goes into the difference between "adding an AI tool" and AI-Native Redesign, and why keeping pre-AI design in place while adding AI is a losing pattern.
- **Chapter 6** sketches what widens between organizations that have multi-layered self-sustaining loops and organizations that don't — the evolution-speed gap I think grows non-linearly over time.

Each chapter reads independently, but read in order, they form a single chain: unchanging principle → common applications → what's special about AI → concrete implementations → the redesign argument → what's next.

## Where Deterministic Automation Couldn't Reach

I said earlier that deterministic automation has already reached almost everywhere. And I said that deterministic automation still has zones it can't touch. This chapter breaks those remaining zones down.

If you look at each domain and split it into the three nodes, two categories show up.

### Type 1: Domains Where One Node Is Still Human-Only

Domains where deterministic automation covers some nodes but not others. Laying them out side by side:

| Domain | Creation | Maintenance | Consumption |
|---|---|---|---|
| **Internal docs** | Manual (specs / design docs / runbooks) | Manual (keeping them current) | Manual (reading them) |
| **Observability** | Automatic (APM / logs / metrics) | Automatic (metric def changes still manual) | **Manual (dashboard triage, improvement cycles)** |
| **Business data (BI reports)** | Automatic (SQL / ETL) | Automatic (schema changes still manual) | **Manual (analysis, interpretation)** |
| **Schema management (basic CRUD)** | Automatic (ORM generation) | **Manual (migration decisions)** | Automatic (validation) |
| **Security posture** | Automatic (logs, anomaly detection) | Automatic (rule updates still manual) | **Manual (threat assessment, alert triage)** |

Every remaining human dependency is in **the parts that need qualitative judgment or contextual interpretation**. In most of these, the bottleneck settles on the consumption side — "the information is there, but no one uses it" is the classic symptom. Humans interpreting a room full of dashboards and log streams at once hits a cognitive ceiling, and that ceiling has been the structural bottleneck. Internal docs is a special case where all three nodes are human, which is why it's the most obvious pain point.

### Type 2: Domains Where Building the Artifact Wasn't Worth the Return

Separate from Type 1, there's a deeper category: **the zones we never tried in the first place**. The individual data and code are there, but the cost of building the "system that structures the relationships between them" never matched the payoff. This covers two subtypes — relationships that already exist but aren't visible to humans (like connections across code, or across tables) and relationships that were never even defined (like the causal link between a marketing initiative and a KPI). I'll come back to Type 2a and Type 2b in a moment.

What's interesting is that the underlying work — static analysis, SQL aggregation, graph-building pipelines — is often perfectly writable in deterministic logic. The reason nothing existed here wasn't "we couldn't build it." It was "the ROI didn't clear the bar."

Break down why no one built it and you get problems on both sides — a double whammy:

- **Cost side.** Even if deterministic logic can build it, standing up the system to do so (the static analyzer, the extraction pipeline, the graph substrate) is real engineering effort.
- **Payoff side.** Even if you build it, humans can't consume it usefully. A human traversing a graph node-by-node isn't a real workflow, and no semantic search layer existed to sit on top.
- When cost is high and payoff is thin, no one signs up.
- So the thing that would have been useful just... didn't exist.

**Type 2a: Making existing relationships visible (an analysis problem).**

Relationships that are already there in the code or the data, but that humans can't see or follow. For example:

- Boundary connections across a codebase (which API is called from other repos, and where)
- Semantic relationships between tables (which set of tables represents the same business entity)
- Log correlation across distributed services (the causal chain of logs across services)

These are all "the information already exists, but no human can analyze it" failure modes.

**Type 2b: Designing new relationships (a design problem).**

Relationships that don't exist anywhere yet — you have to design a conceptual model first, then extract against it. For example:

- The causal link between an initiative and a KPI (which campaign moved which number)
- The pairing of a decision to its outcome (how the call in a design doc played out after implementation)
- The structure connecting customer segments to behavior patterns

These are a deeper failure mode: "the information doesn't exist at all — you have to design it before you can extract it." The classic example is relationships that individuals hold in spreadsheets or in their heads, which don't scale up to an organization.

In my earlier biz-graph post ([Making Initiative Impact Analysis Explorable with Graph RAG + MCP](/posts/initiative-graph-rag)), I put the difference this way:

> db-graph made existing relationships discoverable. biz-graph designed relationships that didn't exist yet and produced them. The first is an analysis problem, the second is a design problem.

### Type 1 vs. Type 2

Even though they're both "zones deterministic automation couldn't reach," they behave differently:

- **Type 1**: "this piece is human, so it's slow or stuck" — a bottleneck in an existing workflow.
- **Type 2**: "this didn't exist to begin with" — opening a domain that was never charted.

Type 2 has the larger ceiling. Removing a bottleneck makes an existing workflow faster. Charting new territory makes decisions and insights possible that weren't possible before.

![Type 1 vs. Type 2. Type 1 removes the human-judgment bottleneck sitting in the middle of an existing flow by widening it with AI. Type 2 takes scattered points (code, tables, initiatives, KPIs) that were previously unconnected and weaves them into a semantic web using an AI × deterministic combination](/images/posts/ai-native-redesign/type1-type2-concept-en.png)

### The Pattern Underneath Both

What Type 1 and Type 2 share: **the parts that resisted rule-based encoding**.

- Type 1's leftover work: "is this dashboard anomaly a real incident or a known false positive?" "when and how do we run this migration?" "what should this doc say to its reader?"
- Type 2's leftover work: "which pieces of code represent the same boundary?" "which initiative moved which KPI?" "how do you lay out a conceptual schema like Week × MetricDomain?"

The common thread is **qualitative or contextual judgment, or semantic connection**. Those can't be written as rules, which is why they've been left standing.

That framing sets up the next chapter — why AI is the pivot. AI:

- covers the remaining qualitative-judgment nodes from Type 1, and
- shifts both sides of the Type 2 double whammy (it lowers the cost of building deterministic extraction systems, and it becomes the missing consumer that can pick up the resulting artifact semantically).

Not only "the zones deterministic automation couldn't reach," but also "the zones deterministic automation could reach but wasn't worth building" — both come into range of automation for the first time. That's what makes AI new.

## Why AI Is the Pivot

The previous chapter split "zones deterministic automation couldn't reach" into two types: the leftover qualitative-judgment nodes in Type 1, and the cost-vs.-payoff bind in Type 2. This chapter goes into why AI is the first thing that can address both.

### What's Genuinely New About AI

Every automation technology before AI stayed inside the region where **you can write deterministic logic**. Enumerate rules, put in branches, match patterns. It's a very powerful stack, and as I said earlier, it's threaded through nearly everything in modern life.

But it hit a class of work it couldn't touch — the same class the previous chapter arrived at from a different angle: **qualitative judgment, contextual interpretation, semantic connection**. A judgment that a human "kind of understands" explodes into an unmanageable condition tree the moment you try to write it as code. What Type 1's leftover human-only nodes and Type 2's un-built structuring systems had in common was that neither survived rule-based encoding.

What AI brings for the first time is **making that whole class machine-processable**. An LLM handles judgments that don't survive being turned into code by treating them as statistical patterns. This isn't an extension of the deterministic stack. It's a new capability, orthogonal to it.

### Three Directions of Change

This new capability shifts systems in three distinct directions. They map onto the Type 1 / Type 2 split from the previous chapter: direction 1 addresses Type 1, and directions 2 and 3 address Type 2.

**Direction 1: automate the remaining qualitative-judgment nodes in Type 1.**

In Type 1 domains, the human-only node — dashboard interpretation, threat assessment, documentation updates, KPI analysis — is now something AI can carry.

**Direction 2: cut the cost of building the structuring system.**

The Type 2 side "deterministic logic could build this, but the effort was too much." AI assists at each step of building the system (spec design, code generation, testing, debugging), which drops the barrier to standing up these systems. Extraction pipelines that used to take months now regularly land in days. As a concrete data point, the initial version of cortex's biz-graph (the MCP server that handles initiative × KPI causality) went from implementation to Pulumi deployment in one day.

**Direction 3: consume structured data semantically.**

This one dissolves Type 2's "even if we build it, no one can use it." A graph a human couldn't traverse by hand, AI walks with a mix of graph traversal and semantic search. A question like "which of last month's marketing initiatives contributed most to new-user acquisition?" gets answered with both structures working together.

### Deterministic-First

> **Design principle: deterministic-first**
> If a thing can be written deterministically, write it deterministically. Keep the surface where AI does inference as narrow as necessary — this is what "containing hallucinations" actually means in practice.

Let AI touch parts that deterministic logic could have handled, and you widen the hallucination surface for nothing. The "containing hallucinations" phrase I've used across earlier posts is really this call — where to draw the line between deterministic and AI.

Leaning deterministic also gets you side benefits:

- **Idempotency.** Same input, same output, every time. Critical for testing, auditing, and reproducibility.
- **Cost, by orders of magnitude.** Inference calls are token-metered. Deterministic execution is typically 10× or more cheaper.

Where AI goes is a decision, not a default. "AI can do it" isn't the criterion. Deterministic where deterministic works. AI only where deterministic doesn't. That division of labor sits at the core of AI-Native Redesign.

Some concrete pairings:

- Static analysis, SQL, pipelines → deterministic (Type 2 creation side).
- The structured artifact those produce → AI consumes it semantically (Type 2 consumption side).
- Wherever qualitative judgment is what's actually needed → AI takes it (Type 1).

### Why AI Requires Whole-System Redesign

With earlier automation tools (APM, CI/CD, monitoring, BI), the standard move was to drop them on top of existing operations. They stood alone and didn't disturb the existing workflow, so adding them was enough.

AI is different. "Add an AI tool to the existing system" won't solve what I described above. The reason is that AI's value doesn't come from any single tool feature — it comes from shifting the balance across all three nodes.

- Replace just the human node in Type 1 with AI, and if the downstream consumption workflow doesn't line up, no one uses the AI's output.
- Stand up new Type 2 structure, and if consumption is still shaped around a human doing the judging, the artifact never actually gets used.
- If you don't redesign the boundary between "AI handles this" and "deterministic handles this," ownership gets ambiguous fast.

This is why "add an AI tool" isn't enough. The whole system has to be redesigned with AI as a given. That's the **AI-Native Redesign** thesis, and I go into it in more detail later on.

## Examples from cortex

This chapter walks through the concrete systems running in cortex and shows how the principles I've laid out play out in each of them. There's a dedicated post for each system that I'll link inline. Here I'm keeping the focus on the same three questions: where's the deterministic layer, where's AI, and how was the division decided.

### code-graph

[code-graph](/posts/code-graph-46-repos) surfaces the code connections across 46 repositories (API boundaries, DB boundaries, event boundaries) into a single knowledge graph. Type 2a — making existing relationships visible.

- **Creation.** Deterministic (tree-sitter static analysis). Function, class, and import call relationships get extracted as written.
- **Maintenance.** Static analysis re-runs on code changes. Maintenance stays deterministic.
- **Consumption.** AI over MCP, combining semantic search and graph traversal.
- **Hallucination containment.** Boundary nodes (API endpoint, DB table, event topic) are materialized explicitly during static analysis, so AI's inference range is scoped to "stop at the boundary."

### db-graph

[db-graph](/posts/db-graph-mcp) covers relationships between database tables and the business context around them (Type 2a). Both the ORM-level JOIN relationships and the business-entity-level semantic relationships get graphed.

- **Creation (structure).** Deterministic (static analysis of the ORM, schema extraction) + **human review** as the guarantee.
- **Creation (business context).** AI generation + **human review** as the guarantee.
- **Maintenance.** ORM and schema changes get detected deterministically; drift in the business context is caught in human review.
- **Consumption.** AI answers natural-language questions like "which tables are involved in the customer purchase cycle" by combining graph traversal and semantic search.
- **Hallucination containment.** Structure stays deterministic. Business context is AI-generated but gated by human review as the final check. The reason db-graph goes through human review while cortex-product-graph runs on AI review comes down to blast radius: wrong DB structure or wrong business context feeds directly into organizational decision-making, so the risk of being wrong is much larger than for a code error. The call isn't just "if AI is accurate enough, let AI handle it" — it's paying the cost of human review whenever the downside of being wrong is large.

### biz-graph

[biz-graph](/posts/initiative-graph-rag) covers the causal relationship between initiatives and KPIs (Type 2b — designing new relationships). Unlike db-graph, there's no "JOIN target" sitting between initiatives and KPIs to begin with. The relationship has to be designed by a human first.

- **Creation.** AI (extracting structure from initiative slide decks) + deterministic (KPI data extraction, embedding-based similarity edges) + **human schema design** (someone defines conceptual anchors like Week and MetricDomain).
- **Maintenance.** New initiative decks and KPI updates keep flowing in to keep the graph current — slide parsing on the AI side, the value pipeline deterministic.
- **Consumption.** An AI agent handling "what's the causal relationship between last month's social campaigns and this week's new-user counts?" traverses Initiative → Week → co-occurring KPIs on the graph.
- **Hallucination containment.** The human-designed schema (conceptual anchors like Week and MetricDomain) is the deterministic frame around AI. AI can only reason inside that frame. KPI extraction, similarity edges, graph construction — all deterministic. AI is confined to the consumption side and to the judgment calls during slide extraction.

### cortex-product-graph

[cortex-product-graph](/posts/cortex-product-graph) is cortex's main knowledge graph, unifying cortex's own code, DB schema, docs, and Pulumi IaC. AI is used heavily in cortex development itself, and this system is a good example of how the AI-Native Redesign principles land in a working setup.

- **Creation (structure).** Deterministic (ts-morph extracts @graph-* JSDoc from code and Pulumi IaC, then merges with the documentation and with db-graph).
- **Creation (code + annotation).** Developer + AI assist (Claude Code / Codex generate code and the annotations at the same time).
- **Maintenance.** cortex's AI review runs per-PR and checks code logic, doc consistency, and annotation drift together, filing REQUEST_CHANGES when they don't line up.
- **Consumption.** AI over MCP, combining semantic and structural search.
- **Hallucination containment.** cortex's AI review looks at code + annotation + docs together on every PR. Even PRs that get merged without a human reviewer go through AI as a review layer. Because the code and its @graph-* annotations sit next to each other in JSDoc (code and intent as an SSoT inside the same file), AI spots the gap between the code change and its intent immediately, which is why AI review stays accurate. This is also a bet on **AI-Readability** — writing code in a form that's not only readable by humans but also structurally parseable by AI agents.

### Observability + Self-Healing

[AI-Observability](/posts/ai-observability-design) handles the four monitoring axes (Application / Infrastructure / CI / LLM), and the loop from there to [Self-Healing](/posts/cortex-self-healing) is where AI-Native Redesign is at its clearest. Type 1 — removing the consumption-side bottleneck.

- **Creation + maintenance.** Deterministic (OpenTelemetry, metrics, logs, traces, deterministic alerts).
- **Consumption (detection).** Deterministic alert thresholds fire incidents.
- **Consumption (judgment and response).** AI cross-references log and trace context (pulled via Grafana MCP in practice) with the relevant source code / tables / docs (found by traversing cortex-product-graph), produces a root-cause hypothesis, and then a fix PR.
- **Maintenance loop.** The generated fix PR is quality-checked by the AI review flow that runs on top of cortex-product-graph before it merges.
- **Hallucination containment.** AI never touches production directly. AI's output is always a PR — something reviewable. cortex-product-graph + AI review + auto-merge chain acts as the final gate.

This is the fully-formed loop of AI-Native Redesign: monitoring → detection → AI inference → PR generation → AI review → merge. The whole loop turns, and cortex ends up in the "fixed before we notice" state (the title of the Self-Healing post).

### The Pattern Underneath All Five

Building these five systems, some design calls kept recurring by choice.

- **Creation side stays deterministic by default.** Anything that reads "the data as written" — static analysis, ORM, OTel, SQL, extraction pipelines — leans deterministic.
- **AI is confined to consumption and to the meaning layer on top of structured artifacts.** Graph traversal, semantic search, annotation generation — the judgment work that doesn't survive being written as rules — is where AI sits.
- **There's always a hallucination-containment mechanism.** Boundary nodes, AI review, human review — the specific mechanism differs, but every system has some form of lid on AI output. AI's free-writing zone is kept narrow, and even inside that zone, its output goes through a review layer.
- **AI review quality depends on the context foundation.** AI can do comprehensive PR review in cortex because cortex-product-graph exists as the structured context foundation. Without it, AI would only see local information from the PR diff, and couldn't judge consistency with the rest of the codebase or the docs. Before "where and how do we use AI," the question that comes first is: "what context can we give AI to reason over?"
- **The review choice has a risk-profile component.** Even when AI review would be accurate enough, if the downside of being wrong is large, human review can still be the right call. As I mentioned with db-graph, it's a comparison between the cost of being wrong and the cost of human labor.
- **Human design judgment sits above the whole thing.** Schema design (biz-graph), guideline definitions (auto-review), monitoring target selection (Observability) — these are human calls.

The pattern to notice: the same AI-Native Redesign principles land in different shapes depending on the subject and the goal.

## AI-Native Redesign vs. "Adding an AI Tool"

So far the argument has been: AI is the first thing that reaches into the zones deterministic automation couldn't, and making that actually work needs whole-system design — a context foundation like cortex-product-graph, or a closed loop like Observability + Self-Healing.

This chapter goes into why the "just add AI to the existing system" approach — the approach that skips the whole-system redesign — falls short.

### What "Adding an AI Tool" Usually Looks Like

Over the past year I've put a range of AI tools into the organization myself. Here are the shapes I've tried at least once:

- **AI summary on dashboards.** AI reads the dashboard and gives you the takeaway.
- **AI-generated docs.** Docs get produced from code.
- **AI PR review.** AI reads the PR and comments.
- **AI search on the internal knowledge base.** Natural-language queries against internal knowledge.
- **AI-assisted coding.** Claude Code, Cursor, etc.

Each one was useful in isolation. But honestly, the results topped out around 1.x — worth the deployment cost, but nowhere near a paradigm shift.

That was the point where I had to step back and ask what it would take for the organization to use AI better. What came out of that were the three failure modes below, and the AI-Native Redesign direction that follows from them.

### Failure Mode 1: The Three-Node Balance Stays Optimized for Humans

Existing systems were shaped, within the capabilities of their era, around "humans handle every node." That assumption is baked into things you don't usually see as design choices:

- Dashboards: density and count set for what a human can consume.
- Documentation: structure and granularity set for what a human can read.
- Code: conventions and granularity set for what humans write and review.

Add AI on top and AI has to operate inside "the balance optimized for humans." AI's actual strengths — watching a room full of dashboards at once, traversing docs structurally, verifying code exhaustively — get suppressed because the surrounding two nodes stay shaped for humans.

### Failure Mode 2: AI Is Asked to Judge Without a Context Foundation

As the earlier examples showed, AI review works comprehensively only when there's a context foundation like cortex-product-graph. Ask AI to judge without one, and it only sees local information, and its actual value doesn't come out.

- PR review AI: seeing only the PR diff, all it can do is comment on coding style.
- Dashboard AI summary: summarizes the numbers on that one dashboard; the relationship to the rest of the system is invisible.
- Doc AI search: keyword match or semantic search, each a local result.

The feeling "AI is shallow" is usually not about the AI. It's about the missing context foundation the AI was supposed to reason over.

This is adjacent to what's now being called context engineering. I've written about the retrieval-side design in [an earlier agentic Graph RAG post](/posts/agentic-graph-rag-mcp), but in the three-node frame, retrieval quality is only the consumption node. The failure here is upstream — the creation side never produced a form that could be pulled as context.

### Failure Mode 3: The Creation Side Doesn't Shift into a Form AI Can Consume

Of the three directions I laid out earlier, Direction 1 (automate the leftover qualitative-judgment nodes from Type 1) can be reached by adding AI to an existing system. But Direction 2 (cut the cost of building structuring systems) and Direction 3 (consume structured data semantically) both require the creation side to change into a form AI can consume.

- JSDoc @graph-* annotations on code express structure and business intent as an SSoT (Single Source of Truth) → AI can understand structure and intent together.
- Logs emitted as structured events, correlated with traces and metrics from other services → AI can follow causal chains across a distributed system.
- Docs restructured from standalone files into data tied to code, design, and domain → AI can pull them as context.

These are creation-side design changes. Adding a feature to the existing system doesn't produce them. "Add AI on the consumption side" alone caps AI's ceiling at whatever the input-side constraints are — a rough format, implicit context, purely local data.

### What AI-Native Redesign Actually Is

Flip the three failure modes and you get what AI-Native Redesign is:

- **Rebalance all three nodes around "AI + human" as the assumption.** Which node gets AI and which stays human is redesigned from scratch. Not "add AI to a human-balanced system" — draw a new balance where AI-carried nodes are first-class parts of it.
- **Build the context foundation first.** The structured context AI can reason over (something like cortex-product-graph) gets built first, and AI review and self-repair go on top of it. The opposite order — "put AI in, then notice context is missing" — is what fails.
- **Change the creation side.** Reshaping the creation side into a form AI can consume — annotations, structured events, fine-grained docs — is part of the redesign. Consumption-side additions alone aren't enough.

The five cortex implementations from earlier all did these three. code-graph shaped structure through static analysis into a form AI could reach (creation-side change). cortex-product-graph became the context foundation for judgment itself. Observability + Self-Healing redesigned all three nodes with AI in the mix, from monitoring through to auto-repair.

This is the underlying reason the evolution-speed gap I sketch in the next chapter widens over time. The gap between "add an AI tool" and "AI-Native Redesign" is bigger than a linear-vs.-exponential ROI gap, from what I've seen.

## Life After AI-Native Redesign

### What Building cortex Has Actually Felt Like

Some things I couldn't see back when we were just deploying individual AI tools have come into view while building and running cortex.

- Fix PRs now ride straight into AI review and auto-merge with no human in the path — 115 of them via Self-Healing alone in the last 30 days ([details in the Self-Healing post](/posts/cortex-self-healing)).
- Drift between docs, annotations, and code gets repaired automatically in places that used to sit uncorrected.
- The cost of chasing "how was this actually built again?" through past decisions has dropped.
- Individual writing speed hasn't changed much. What did change: the quality bar for what actually ships, and the fact that people other than me can now contribute. Monthly merged PRs going from 23 in March to 518 in April 2026 came from the workflow switch (main push → PR + AI review + auto-merge), not from writing more. The number is really the shape of "the ceiling of 'reviewed manually by me' came off, so this scale and this quality bar can now be sustained by more people than just me" ([data in the harness intro post](/posts/ai-harness-intro)).

This isn't "add an AI tool, get 1.x." It's what happens when multiple self-sustaining loops start turning across layers. Qualitatively a different kind of change from a one-off productivity bump.

### What Multi-Layered Self-Sustaining Loops Actually Look Like

Each of the cortex systems has its own self-sustaining loop.

- **code-graph.** Every code change updates the graph, AI reviews using the updated graph.
- **cortex-product-graph.** Every PR keeps annotations and code aligned, and AI review accuracy tightens with each pass.
- **Observability + Self-Healing.** Monitoring detects an incident, AI produces a fix PR, AI review checks it, and it merges.
- **biz-graph.** Initiative-to-KPI relationships get extracted continuously and stay in a form usable for decision-making.

These loops run independently, but they're connected through cortex-product-graph as a shared context foundation. The output of one loop becomes the input to another — that shape of connection.

Once this kind of multi-layer loop starts running inside the organization, it changes how time gets spent at a fundamental level. Not "AI helps" — closer to "a substantial share of daily work completes inside the loops."

![Multi-layered self-sustaining loops — code-graph, db-graph, biz-graph, and Observability + Self-Healing each turn as satellite loops around cortex-product-graph as the shared context foundation. In Self-Healing, both AI inference (Grafana MCP logs + cortex-product-graph) and AI review (cortex-product-graph as context) reference the shared foundation, and the loop closes without a human in the path](/images/posts/ai-native-redesign/multi-layer-loops-en.png)

### Where This Structure Could Rot

If the three-node symmetry is the axis, then AI-Native systems' own negative spiral is a question that has to be asked too. The circular dependency I presented as a virtuous cycle (AI review maintains cortex-product-graph, cortex-product-graph supports AI review) turns into a self-amplifying error loop the moment errors get into the foundation. AI reasoning confidently and consistently wrong on top of a contaminated context foundation is a real, symmetric failure mode of this design, not a hypothetical.

The defenses split three ways. The reason db-graph puts human review at the final gate is entry-side containment — narrowing the flow of contamination into the foundation wherever the downside of being wrong is large. Materializing boundary nodes explicitly through static analysis is inference-range containment — narrowing where AI is allowed to reason. And keeping cortex-product-graph in a form that can always be regenerated from deterministic extraction + annotations + docs is recoverability — a way back once contamination is detected. All three are held together by "the foundation is never something AI alone writes into." The signal that this failure mode is starting to show is drift in AI review's own accuracy metrics (REQUEST_CHANGES rate, false positive / negative rate) that no one can explain — which is the symmetric-side extension of what I meant in the [AI-Observability post](/posts/ai-observability-design) when I argued LLMs should be the fourth monitoring axis.

### How I Read the Evolution-Speed Gap

The rest is my read. I don't know how much of this generalizes to other organizations.

Between organizations running AI as individual tools and organizations that have assembled multiple self-sustaining loops across layers, my sense is the evolution-speed gap widens over time.

- In the first, AI is a useful tool, but decision-and-implementation speed itself doesn't change much.
- In the second, the full cycle — decision → implementation → detection → repair — gets an order of magnitude faster.

Compound that gap over time and how much you can get done in the same period starts to diverge — gradually or sharply. "Exponentially" would be overstating it, but at least the way I see the gap widening, "linear" doesn't describe it either.

### What This Post Was Trying to Say

Take the timeless question — "how do we make accurate information accessible?" — and redesign for it with AI as a given capability. That's the idea at the center of AI-Native Redesign.

- AI isn't a replacement for deterministic automation. It's a new capability that brings zones deterministic automation couldn't reach into the automation envelope for the first time.
- Adding AI in isolation doesn't work. The positive spiral only kicks in when all three nodes are rebuilt together.
- Doing that requires a context foundation AI can reason over (something like cortex-product-graph), built ahead of the AI layer.
- The whole thing is a stack of self-sustaining loops, and the more of them turn together, the more the organization's evolution speed changes.

The cortex build is one instance of trying this out. Different organizations and different subjects will land somewhere else, but the underlying question — "how do we make information accessible?" — should be the same. If this post is useful as material for laying an AI-Native answer over other contexts, that's what I was hoping for.
