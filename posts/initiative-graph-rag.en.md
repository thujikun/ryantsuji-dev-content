---
title: "Still Measuring Initiative Impact Manually? How We Used Graph RAG + MCP to Make It Explorable"
publishedAt: "2026-04-20"
updatedAt: "2026-05-16"
slug: "initiative-graph-rag"
summary: "Measuring 'did that initiative actually work?' usually means manual SQL spelunking. We modeled initiatives × KPIs as a graph and let an LLM traverse it via MCP."
tags:
  - "ai"
  - "typescript"
  - "bigquery"
  - "webdev"
lang: "en"
syndication:
  zenn:
    id: "7a0b06cb2a35d8"
  devto:
    id: 3527776
    slug: "we-built-a-custom-graph-rag-to-let-ai-answer-did-that-initiative-actually-work-3oda"
cover: /posts/initiative-graph-rag.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

In my previous posts, I introduced [an MCP server that lets you search all company databases in natural language](/posts/db-graph-mcp) and showed [the full picture of our 17 internal MCP servers](/posts/17-mcp-servers). This time, I'm diving deep into what I briefly mentioned as "Biz Graph."

**This is the story of how we represented the relationship between business initiatives and KPIs as a graph structure, enabling AI to answer "Did that initiative actually work?"**

## Why Graph RAG?

To get more value from AI, what matters is not just feeding it data — it's conveying **the relationships between data**.

If your data volume is small enough, tools like NotebookLM can deliver great results. But you can't fit all your business data into a context window. Initiative reports, KPI spreadsheets, marketing weekly reports, logistics daily metrics — you simply cannot dump all of that into a prompt.

That's why I believe the best available option right now is **Graph RAG**: making the right data searchable at any time, along with its relationships. When AI is asked "What metrics are related to this initiative?", it can traverse the graph and extract only the information it needs — because that structure was built in advance.

But there's a catch.

## Making Non-Graph Data Into a Graph

Many of you have heard of "knowledge graphs" and "GraphRAG." But when you actually try to build one, most people hit the same wall:

**Business data doesn't naturally form a graph.**

With our DB Graph project, things were different. Tables had foreign keys. ORMs had `@JoinColumn` and `belongsTo`. **Relationships already existed in the data** — we just had to parse and convert them.

But the relationship between "initiatives" and "KPIs" has none of that.

- A meeting slide says "SNS ad campaign launched"
- A spreadsheet records "This week's new members: 1,234"
- **There's no FK between these. No join key.**

"The SNS campaign affected new member signups" — that relationship **exists only in someone's head**. It's nowhere in the spreadsheet.

This is what "business data doesn't form a graph" means. The relationships between entities aren't self-evident — **you have to design the graph structure itself**.

## The Problem: "Did That Initiative Actually Work?"

Every week, our company reports initiative progress in all-hands meetings and group-level standups.

"We launched the spring SNS ad campaign"
"We improved the recommendation engine"
"We're raising our CS SLA achievement rate"

— Dozens of initiatives reported weekly. Hundreds per year. **Over 5,000 total**.

Meanwhile, a separate spreadsheet tracks 200+ metrics daily and weekly: member count, new signups, retention rate, satisfaction scores, acquisition CPA...

**The problem: these two worlds are completely disconnected.**

"How much did last month's SNS campaign contribute to new member acquisition?"

Answering this requires:
1. Confirm the initiative's execution period (which slide was that again?)
2. Find KPI data for that period (which sheet, which tab?)
3. Align timeframes and compare numbers (week-over-week? month-over-month? year-over-year?)
4. Check if other initiatives were running simultaneously (confounding factors?)

This manual analysis takes 30-60 minutes, **happening every week for multiple initiatives**. Realistically, most initiative effectiveness reviews end with "it probably worked, I think."

## Biz Graph: The Big Picture

We built **Biz Graph** to solve this.

![System Overview](/images/posts/initiative-graph-rag/5h5bh00l1qeisenx8e8t.png)

### Scale

> Note: The numbers below differ from actual values but convey the order of magnitude. In any case, this is far too much data to fit in an LLM's context window.

| Resource | Count |
|----------|-------|
| Nodes | ~10,000 (14 types) |
| Edges | ~71,000 (22 types) |
| Initiatives | ~5,000 |
| KPI Metrics | ~4,000 (members/signups/retention/satisfaction/UX/marketing/logistics) |
| Marketing Channels | ~100 (SEM/LINE/email/CRM etc.) |
| Data Sources | 9 tables/spreadsheets |

### Three Components

1. **Biz Graph Transformer** — Weekly graph rebuild from all data sources (Cloud Run Job, every Friday 22:00)
2. **Biz Graph MCP Server** — Graph search + time series analysis accessible from AI (Cloud Run)
3. **Biz Data Loader** — Daily auto-import of marketing/logistics data (Cloud Run Job, every morning 6:00)

## The Core Design: The Week Node

Here's the heart of this article.

How do you connect "initiatives" and "metrics" in a graph? The obvious first thought is direct edges:

```plaintext
Initiative("SNS campaign") ──AFFECTS──→ Metric("new_members")
```

**This design breaks down.** Three reasons:

1. **Edge explosion**: 5,000 initiatives × 4,000 metrics = up to 20 million edges
2. **Causal uncertainty**: "SNS campaign affected new members" is a hypothesis, not a fact. Direct edges make it look like a confirmed relationship
3. **Missing temporal info**: There's no way to express *when* the impact occurred

Instead, we designed **Week nodes as shared anchors for indirect connections**.

![Week Anchor](/images/posts/initiative-graph-rag/lklff5l2jw4nqayu1b4o.png)

```plaintext
Initiative("SNS campaign")     ──ACTIVE_DURING_WEEK──→  Week:2026-03-03
Metric("new_members")          ──HAS_DATA_AT──→         Week:2026-03-03
QualityMetric("avg_rating")    ──HAS_QUALITY_DATA_AT──→ Week:2026-03-03
MarketingChannel("SEM brand")  ──HAS_MARKETING_DATA_AT──→ Week:2026-03-03
```

Initiatives and metrics aren't directly connected — they're **indirectly linked through the same week**.

### Why This Works

**1. Prevents edge explosion**

Initiatives only connect to "weeks they were active." Metrics only connect to "weeks that have data." Instead of a cross-product, each connects independently to Week nodes — edge count grows linearly.

**2. Expresses co-occurrence, not causation**

"Initiatives that were active the same week as metric fluctuations" — this isn't asserting causation, it's a structure for **discovering causal candidates**. It leaves room for human or AI judgment.

**3. Edge types distinguish data sources**

Same Week node, but `HAS_DATA_AT` (business KPIs), `HAS_QUALITY_DATA_AT` (service quality), `HAS_UX_DATA_AT` (UX metrics), `HAS_MARKETING_DATA_AT` (marketing), `HAS_LOGI_DATA_AT` (logistics) — "what kind of data" is embedded in the edge type itself.

**4. Time series traversal is natural**

Week nodes are connected by `NEXT_WEEK` edges. "How did metrics change in the 3 weeks before and after initiative start?" can be expressed as graph traversal.

## MetricDomain: Bridging Worlds Without Join Keys

Week nodes tell us "what happened the same week," but not **which metrics are relevant to a given initiative**. There's no point looking at logistics data when analyzing an SNS ad campaign.

However, there's **no join key** between initiative categories ("Marketing (Advertising)") and metric groups ("New Acquisition"). The knowledge that "ad initiatives relate to new acquisition" is tacit — it exists only in people's heads.

**MetricDomain** (6 domains) structuralizes this tacit knowledge.

![MetricDomain](/images/posts/initiative-graph-rag/1gk36ev3zjhg301k2frw.png)

| Domain | Meaning | Connected metric types |
|--------|---------|----------------------|
| acquisition | New acquisition | Marketing channels, new member count, registration CV |
| retention | Retention / churn prevention | Member count, churn rate, plan transitions |
| service_quality | Service quality | Satisfaction, ratings |
| operations | Operations | Selection, shipping, returns, logistics KPIs |
| ux | UX experience | Sessions, funnels |
| revenue | Revenue / purchases | Purchase CV, upsell |

These 6 domains aren't fixed — they can be freely added or split as the business grows and the organization evolves. Domain definitions are just mapping tables in code, so the cost of expansion is nearly zero.

By **humans defining** the mapping between initiative categories and MetricDomains, and between metric groups and MetricDomains, we enable "automatically show acquisition-related metrics when viewing a marketing initiative."

```plaintext
Category("Marketing ads") ──CATEGORY_IN_DOMAIN──→ MetricDomain("acquisition")
                                                           ↑ IN_DOMAIN
                                                  MetricGroup("New Acquisition")
                                                  MarketingChannel("SEM brand")
                                                  UxMetric("registration_completed")
```

**Result**: Pass `domain: "acquisition"` to `compare_metrics`, and the initiative overlay automatically filters to acquisition-related initiatives only.

## SIMILAR_TO: AI Answers "Have We Done Something Like This Before?"

Another unique design element: **SIMILAR_TO edges**.

Initiative text (title + description) is vectorized to 768 dimensions using Vertex AI's gemini-embedding-001, then BigQuery's VECTOR_SEARCH auto-detects similar pairs with cosine similarity >= 0.75.

```sql
SELECT base.id, query.id, distance
FROM VECTOR_SEARCH(
  TABLE cortex.biz_graph_nodes,
  'embedding',
  (SELECT id, embedding FROM cortex.biz_graph_nodes WHERE node_type = 'Initiative'),
  top_k => 6,
  distance_type => 'COSINE'
)
WHERE base.id != query.id AND distance <= 0.25  -- distance <= 0.25 = similarity >= 0.75
```

Currently **~13,000 SIMILAR_TO edges** exist. Up to 5 similar initiatives are pre-computed for each one.

"Didn't we run a similar SNS campaign last summer? How did that one perform?" — traverse similar initiatives on the graph instantly, then compare KPI changes during weeks those initiatives were active.

## Real Usage Examples

Here's how exploration works via MCP tools.

> All tool execution examples below run through MCP from an AI coding agent. The response format matches the real system, but numbers are dummy values and content is simplified.

### "Find marketing initiatives that drove acquisition"

```json
search_initiatives({
  "query": "SNS advertising for new acquisition",
  "domain": "acquisition",
  "dateFrom": "2025-10-01",
  "dateTo": "2026-03-31",
  "limit": 5
})
```

Response (excerpt):
```plaintext
5 initiatives found (by vector similarity):

1. SNS Ad Spring Collection Campaign (2026-03-09)
   Category: Marketing (Advertising)
   Similarity: 892/1000

2. Instagram Reels Ad Test (2026-02-23)
   Category: Marketing (Advertising)
   Similarity: 845/1000
   ...
```

### "Show me the impact of that initiative"

```json
get_initiative_context({
  "initiative_id": "Initiative:2026-03-09:SNS Ad Spring Collection Campaign",
  "metric_window_days": 30
})
```

Response (excerpt):
```markdown
## Initiative Context

Title: SNS Ad Spring Collection Campaign
Execution Period: 2026-03-01 to 2026-03-31
Category: Marketing (Advertising)
Target Domain: acquisition

## Similar Initiatives (SIMILAR_TO)
- Instagram Reels Ad Test (similarity: 0.82)
- 1-Month Free Trial Campaign (similarity: 0.78)

## KPI Changes During Initiative (30-day window)
| Metric | Pre-avg | Post-avg | Change |
|--------|---------|----------|--------|
| new_regular | 50 | 60 | +20.0% |
| new_lite | 30 | 35 | +16.7% |
| monthly | 1,000 | 1,050 | +5.0% |

## Service Quality Metrics
| Metric | Before | After | Change |
|--------|--------|-------|--------|
| avg_rating | 3.50 | 3.60 | +2.9% |

## UX Metrics
| Metric | Before | After | Change |
|--------|--------|-------|--------|
| total_sessions | 10,000 | 12,000 | +20.0% |
| registration_completed | 100 | 130 | +30.0% |
```

**This is the power of the Week node design.** Identify the weeks an initiative was active, then automatically pull all metrics (KPIs, quality, UX, marketing, logistics) from those same weeks.

### "Visualize new acquisition YoY with initiative overlay"

```json
compare_metrics({
  "metrics": ["new_regular", "new_lite", "new_monthly"],
  "dateFrom": "2025-10-01",
  "dateTo": "2026-03-31",
  "granularity": "weekly",
  "overlay_initiatives": true,
  "domain": "acquisition"
})
```

Time series data with acquisition-domain initiatives overlaid on the same timeframe. KPI spikes become instantly attributable to "that initiative's timing."

## The Build Pipeline: 9 Phases

The graph is constructed in 9 phases:

| Phase | Content | Output |
|-------|---------|--------|
| 1 | Initiative nodes + Category/Business/Team | Initiative, Category, Business, Team |
| 2 | Daily KPIs (50 metrics) | Metric → MetricGroup (10 groups) |
| 3 | Business KPIs + Departments | Department → Metric (DEPT_TRACKS) |
| **4** | **Week nodes (shared anchors)** | **HAS_DATA_AT + ACTIVE_DURING_WEEK + NEXT_WEEK** |
| 5 | Service quality metrics (~50) | QualityMetric → Week |
| 6 | UX metrics (~40) | UxMetric → Week |
| 7 | Marketing channels (~100) | MarketingChannel → Week |
| **8** | **MetricDomain (semantic bridge)** | **6 domains + IN_DOMAIN + TARGETS_DOMAIN** |
| 9 | Logistics KPIs (~10 categories) | LogiMetric → Week |

Phases 4 and 8 are the **key design points**. Other phases simply "turn data into nodes" — these two "structuralize relationships that don't exist."

### Phase 4: Week Node Generation

```typescript
// Convert initiative execution period to ISO weeks, generate ACTIVE_DURING_WEEK edges
for (const initiative of initiatives) {
  const weeks = getISOWeeksBetween(
    initiative.executionStartDate,
    initiative.executionEndDate
  );
  // Cap at 52 weeks (guard against long-running initiatives)
  for (const week of weeks.slice(0, 52)) {
    edges.push({
      edge_type: 'ACTIVE_DURING_WEEK',
      source_id: initiative.id,
      target_id: `Week:${week}`,
    });
  }
}

// Generate HAS_DATA_AT edges for weeks that have metric data
for (const metricWeek of metricWeeks) {
  edges.push({
    edge_type: 'HAS_DATA_AT',
    source_id: `Metric:${metricWeek.metric}`,
    target_id: `Week:${metricWeek.week}`,
  });
}

// NEXT_WEEK edges for time series traversal
const sortedWeeks = [...allWeeks].sort();
for (let i = 0; i < sortedWeeks.length - 1; i++) {
  edges.push({
    edge_type: 'NEXT_WEEK',
    source_id: `Week:${sortedWeeks[i]}`,
    target_id: `Week:${sortedWeeks[i + 1]}`,
  });
}
```

### Phase 8: MetricDomain Generation

```typescript
// Category → Domain (semantic mapping defined by humans)
const CATEGORY_TO_DOMAINS: Record<string, string[]> = {
  'Marketing (Advertising)': ['acquisition'],
  'CRM / Retention': ['retention'],
  'Quality / Service Improvement': ['service_quality'],
  'Operations Improvement': ['operations'],
  'New Feature': ['ux', 'revenue'],
  // ...
};

// Initiative → TARGETS_DOMAIN (main business only — limited to where KPI data exists)
for (const initiative of initiatives) {
  if (initiative.business !== MAIN_BUSINESS) continue;
  const domains = CATEGORY_TO_DOMAINS[initiative.category] ?? [];
  for (const domain of domains) {
    edges.push({
      edge_type: 'TARGETS_DOMAIN',
      source_id: initiative.id,
      target_id: `MetricDomain:${domain}`,
    });
  }
}
```

## Why Not a Dedicated Graph DB or OSS Libraries?

We implemented the graph using **BigQuery alone**, without Neo4j, Amazon Neptune, or OSS like Microsoft's GraphRAG.

### Why not a dedicated graph DB?

| Aspect | Dedicated Graph DB | BigQuery |
|--------|-------------------|----------|
| Graph traversal | Fast (native) | Fast enough (~10,000 node scale) |
| Vector search | Requires separate service | VECTOR_SEARCH built-in |
| Time series analysis | Weak | Native (window functions) |
| Operating cost | Always-on instances | Serverless (pay per query) |
| Joining other data | ETL required | Same project, instant JOIN |

For Biz Graph, "graph structure + time series analysis + vector search combined" matters more than "deep graph traversal." BigQuery handles all three in one engine.

Additionally, BigQuery has announced [Graph capabilities](https://cloud.google.com/bigquery/docs/graph-overview) — once GA, native graph queries on node/edge tables will be available. Currently we traverse with SQL JOINs, but we expect to migrate to faster, more intuitive queries in the future.

### Why not OSS libraries / SaaS?

OSS like Microsoft GraphRAG and various Graph RAG SaaS products focus on **automatically extracting entities and relationships from text documents**. Great for research papers or news articles, but not for our use case.

The reason is simple: **we need to design the graph structure itself**.

- The concept of Week nodes as "temporal anchors" doesn't exist in generic tools
- MetricDomain "semantic bridging" reflects our specific business structure
- The Initiative → Week → Metric indirect connection pattern won't emerge from LLM entity extraction

Generic tools "auto-generate graphs from text." What we needed was "design the graph schema ourselves and integrate heterogeneous data sources." Fundamentally different problems.

Internal query example (`get_initiative_context`):

```sql
-- Get weeks the initiative was active
WITH active_weeks AS (
  SELECT target_id AS week_id
  FROM cortex.biz_graph_edges
  WHERE source_id = @initiative_id
    AND edge_type = 'ACTIVE_DURING_WEEK'
),
-- Get metrics that have data in those same weeks
co_occurring_metrics AS (
  SELECT e.source_id AS metric_id, e.edge_type, w.week_id
  FROM cortex.biz_graph_edges e
  JOIN active_weeks w ON e.target_id = w.week_id
  WHERE e.edge_type IN (
    'HAS_DATA_AT', 'HAS_QUALITY_DATA_AT',
    'HAS_UX_DATA_AT', 'HAS_MARKETING_DATA_AT'
  )
)
SELECT * FROM co_occurring_metrics
```

Graph traversal and time series data retrieval complete in a single SQL query. With a dedicated graph DB, you'd need to pass traversal results to another service for time series queries — an extra hop.

## Initiative Data Ingestion: Auto-Extraction from Meeting Slides

Graph quality depends on source data quality. Initiative data comes from all-hands and group meeting slides.

| Source | Format | Frequency |
|--------|--------|-----------|
| All-hands | pptx in Drive → Slides conversion → text extraction | Weekly |
| Group standups | Google Slides (cumulative, latest week appended) | Weekly |

Text is extracted from meeting slides and structured by AI into the initiative table.

```typescript
interface InitiativeRow {
  meetingDate: string;       // Meeting date
  source: string;            // Source (all-hands / group standup etc.)
  business: string;          // Business unit
  category: string;          // Marketing (Ads), New Feature, ...
  title: string;             // Initiative title
  description: string;       // Detailed description
  team: string;              // Executing team
  executionStartDate: string; // Execution start date
  executionEndDate: string;   // Execution end date
  metrics: string;           // JSON format numeric metrics
  status: string;            // planned / in_progress / retrospective
}
```

Critical: `executionStartDate` / `executionEndDate`. The meeting date (`meetingDate`) differs from when the initiative actually runs. "We started the SNS campaign last week," reported on 3/9, means `executionStartDate` is 3/1. This distinction is essential for accurate Week node connections.

## Operating Cost

| Resource | Cost |
|----------|------|
| Vertex AI Embedding (weekly) | ~$0.05/run |
| Claude Code (initiative extraction) | Within monthly plan |
| BQ storage | A few GB (negligible) |
| Cloud Run Jobs | Nearly free (1x weekly + 1x daily) |
| MCP Server | Nearly free (Cloud Run min-instances=0) |

**A few dollars per month** to maintain a 10,000-node, 71,000-edge graph.

## Comparison With Typical Knowledge Graphs

Let's take a step back and see how this design differs from conventional approaches.

| Aspect | Typical Knowledge Graph | Biz Graph |
|--------|------------------------|-----------|
| Node design | Entities mapped directly to nodes | Deliberately designed temporal anchors ("Week") |
| Edge semantics | Relationships described as-is | Edge types encode data source classification |
| Intermediate nodes | Taxonomies for classification | MetricDomain as semantic bridge (structuralized tacit knowledge) |
| Graph construction | Relationships extracted from existing data | Deliberately designed graph from data with no inherent relationships |
| Use case | Primarily search and navigation | Goes further into causal candidate exploration for initiative impact |
| Similarity search | Text-based search | Pre-computed SIMILAR_TO edges via Embedding |

**In one sentence:**

Our DB Graph "made existing relationships discoverable." Biz Graph "designed and created relationships that didn't exist."

The former is an analysis problem. The latter is a **design problem** — designing the graph structure from scratch and integrating heterogeneous data sources (meeting slides, spreadsheets, BQ tables) into a single explorable structure. That's the essence of Biz Graph.

## Why Graph RAG Over Flat RAG

Let's revisit the "why Graph RAG?" question from the introduction.

For initiative effectiveness analysis, consider what happens with standard vector search (flat RAG). Ask "What was the SNS campaign's impact?" — flat RAG returns text chunks similar to the initiative description. You get info about the initiative itself.

But it won't return **concurrent KPI changes**. It won't return **results from past similar initiatives**. It won't return **related domain metrics**.

These are information connected "through the graph," not by "text similarity." You can only reach them by traversing Week nodes. This "need to follow relationships" use case is exactly where Graph RAG has a clear advantage over flat RAG.

## Design Honesty: Not Asserting Causation

One thing I was conscious of in this design: **not asserting causation**.

Many BI tools and AI analyses want to declare "this initiative impacted this KPI." But in reality, there's no such certainty. Multiple initiatives may have been running simultaneously, it could be seasonal, it could be external market changes.

Week node indirect connections simply "lay out what happened in the same period." Causal judgment is left to human or AI reasoning. I believe this is a statistically honest approach.

"A structure for discovering causal candidates" — not "a structure for asserting causation." This distinction matters.

## Limitations: The Designer's Tacit Knowledge Is the Bottleneck

Let me be honest about the weaknesses of this approach.

MetricDomain mappings ("Marketing Advertising → acquisition domain") are hardcoded by humans. If this design is wrong, the entire graph's exploration results are skewed.

This is simultaneously the answer to "why build it yourself." Off-the-shelf graph tools can't reflect your business structure — which initiative categories relate to which metric groups. Structuralizing this tacit knowledge requires someone who knows the business.

Going forward, we're considering having AI propose these mappings with humans reviewing them. Full automation is hard, but an "AI suggests, humans approve" workflow could reduce the maintenance cost of domain knowledge.

## Summary

Turning business data into a graph is more of a **design challenge** than a technical one.

There's no FK between "initiatives" and "KPIs." No join key. But by deliberately designing two structures — **temporal axis (Week nodes)** and **semantic domains (MetricDomain)** — it becomes an explorable graph.

- **Week nodes**: Indirect connections via "same week" instead of direct initiative-metric edges. A structure for discovering causal candidates
- **MetricDomain**: Semantic bridge between initiative categories and metric groups. Structuralized tacit knowledge
- **SIMILAR_TO**: Pre-computed similar initiatives via AI Embedding. Instant answers to "have we done this before?"

As a result, questions like "Did that initiative work?", "Find initiatives that drove acquisition", "Show metrics YoY with initiative overlay" — AI can now autonomously explore the graph to answer these.

Graphs aren't something you "find" — they're something you **design**. Especially for business data.
