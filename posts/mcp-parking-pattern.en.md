---
title: "Cutting Self-Built MCP Server Token Usage by 90% — The Parking Pattern"
publishedAt: "2026-05-01"
updatedAt: "2026-05-16"
slug: "mcp-parking-pattern"
summary: "MCP responses fill the context window fast. The parking pattern stores heavy payloads externally and returns only a key — about 90% token savings in production."
tags:
  - "architecture"
  - "ai"
  - "mcp"
  - "webdev"
lang: "en"
syndication:
  zenn:
    id: "4c5f49f89db19f"
  devto:
    id: 3593900
    slug: "cutting-self-built-mcp-server-token-usage-by-90-the-parking-pattern-3e7o"
cover: /posts/mcp-parking-pattern.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

In my previous posts I introduced [the full picture of our 17 internal MCP servers](/posts/17-mcp-servers), [an MCP server that lets you search 991 internal tables in natural language](/posts/db-graph-mcp), [a Graph RAG MCP for measuring initiative impact](/posts/initiative-graph-rag), and [the Sandbox MCP that lets non-engineers publish AI-built apps safely](/posts/sandbox-mcp).

This time I want to share something that came out of running those in production — **a small trick we use to cut token consumption on self-built MCP servers**.

## The Annoyance: MCPs Eat More Tokens Than You'd Think

The first surprise when extending an AI agent with MCP is that **token consumption is higher than expected**.

An MCP tool call is, at the end of the day, JSON-RPC over HTTP. Both the arguments the AI sends and the result the tool returns **land directly in the conversation context**. If you implement things naively:

- Sending whole files as arguments → thousands of lines of source code stick to the context
- Returning all DB query rows → a multi-thousand-row × multi-column table sticks to the context

A single tool call can easily consume tens of thousands of tokens, putting the Claude Code session straight into compaction.

It's worse than just inefficiency: above a certain row count, **the response simply fails to come back at all** because it exceeds MCP's payload size limit.

![Naive implementation bloats the context](/images/posts/mcp-parking-pattern/bgsnxmhtggzp1mryc5l6.png)

When we were ramping up our internal MCP fleet, this little mismatch was reliably making the tool experience worse.

## The Pattern: Park the Big Stuff Elsewhere, Pass Only a Key

The fix is embarrassingly simple:

> **Take the parts that tend to grow and move them off the MCP wire. Pass only a reference key (or URL) through MCP itself.**

Both the request side and the response side benefit from the same idea.

| Direction | What to remove | Where to park it |
|-----------|----------------|------------------|
| Request | Large files / source code | GitHub, Drive, or any object store |
| Response | Large list data / query results | Spreadsheet / GCS / BigQuery |

![The parking pattern](/images/posts/mcp-parking-pattern/y6781jcptumie8fs413y.png)

Two examples from airCloset.

## Example 1: Lighter Requests — Sandbox MCP × Self-Hosted Git Server

[Last time](/posts/sandbox-mcp) I wrote about **Sandbox MCP**, the platform that lets non-engineers publish AI-built apps internally. The first iteration was fully **MCP tool-driven file uploads**.

```ruby
sandbox_write_file(app_name: "todo-app", path: "index.html", content: "<html>...")
sandbox_write_file(app_name: "todo-app", path: "app.js", content: "import ...")
sandbox_publish(app_name: "todo-app")
```

The moment apps got slightly bigger, this collapsed:

- **Constant chunking**: hitting the payload size limit, the AI looped through "first half of file A → second half → first half of file B → ..."
- **Tokens going up in flames**: full source code landed in the conversation context — a single deploy of a few-thousand-line app could burn tens of thousands of tokens
- **Retries made it worse**: the AI would "verify after sending" by re-reading the same file with `sandbox_read_file`. Write → read → write loops

So we changed the contract: **MCP only returns a URL; the actual content moves over git push**.

```shell
# 1. MCP returns a git URL — no payload involved
sandbox_init_repo(app_name: "todo-app")
# → https://mcp-sandbox.example.com/git/sandbox/ryan/todo-app.git

# 2. AI runs git in the background — MCP isn't involved
git init && git add . && git commit -m "init"
git remote add sandbox <returned URL>
git push sandbox main

# 3. Only the deploy command goes through MCP
sandbox_publish(app_name: "todo-app")
```

git push gives us:

- **No file size limit**
- **Differential transfer — second-time pushes are fast**
- **Source code never lands in the MCP conversation context**

From the AI's point of view, it's just "I got handed a git URL; I push to it." Fundamentally different in token economics.

By the way, we **don't use GitHub Organizations** here. Issuing GitHub seats for every employee wasn't worth the cost or operational overhead, and we already had a self-hosted Git Server on GCE for a different purpose, so we just added one repo (`sandbox-apps`). The "park" doesn't have to be something you build from scratch.

## Example 2: Lighter Responses — DB Graph MCP × Spreadsheet

[DB Graph MCP](/posts/db-graph-mcp) is the MCP that lets us search and query 991 internal tables in natural language.

The annoying-but-common case here is **"give me everything"-style queries**:

```sql
SELECT * FROM service_main.user WHERE created_at >= '2026-01-01'
```

When the result is several thousand to tens of thousands of rows, you get either:

- A multi-million-token response that triggers immediate session compaction
- An MCP error because the payload exceeds the size limit

Or both. The "right" AI behavior is to do `LIMIT 100` and analyze a sample — but if the user actually wanted **the full list as a CSV**, that doesn't help them.

So we built a **"export to spreadsheet, return only the URL"** mode into DB Graph MCP. You can opt in explicitly, but the MCP **also auto-falls back to this mode whenever the result exceeds a row-count threshold**. Even if the AI forgets to add a `LIMIT` and the query is about to return 10,000 rows, the server decides "this is too big to return inline," exports to a spreadsheet, and hands back the URL.

```typescript
// Conceptual call (the real shape is documented in the tool description)
sql_query_database({
  query: "SELECT * FROM ...",
  output: "spreadsheet"  // ← explicit export mode
})

// Without `output`, the server still auto-falls back over a threshold (e.g. 500 rows)
sql_query_database({
  query: "SELECT * FROM ..."
})
// → server detects row count → spreadsheet export + URL response

// Either way, the response shape is the same
{
  url: "https://docs.google.com/spreadsheets/d/{...}/edit",
  rows: 12483,
  columns: ["id", "email", "created_at", ...],
  exported_reason: "row_count_exceeded"  // set on auto-fallback
}
```

The response is just a URL plus metadata. The real data never enters the context. **"Light if you're careful" becomes "light even when you're not"** — and that's what makes it feel safe in day-to-day operation.

This pattern works because **a surprisingly large fraction of real use cases are just "I want this data somewhere I can use it later"** — not "let's analyze this in chat with AI." Things like:

- Save it to a spreadsheet I can stare at later
- Share it with another team
- VLOOKUP it against another sheet

For those, MCP's job ends at "write the query, drop the result somewhere." That's enough.

If the user genuinely does want AI-side analysis, you do still need the data in context. The standard workflow becomes a two-step: `LIMIT 100` for sample analysis, then `output: spreadsheet` for the full export once the conclusion is clear.

## How Much Did It Save?

Every MCP we run logs every tool call. After rolling these patterns out, **total token consumption across all tools dropped 70–90%**.

## Bonus: Google Workspace OAuth Pairs Beautifully With This

A note on choosing where to "park" data: **if your MCP authenticates via Google Workspace OAuth, this whole design becomes much easier**.

The reason is that you get two things from a single OAuth flow — **two birds with one stone**:

1. **Authentication for MCP itself** — figuring out who's using the tool
2. **Authorization for Workspace apps** — scoped access to Spreadsheet / Drive / Gmail / Calendar

![Two birds with one stone](/images/posts/mcp-parking-pattern/zdefw7gcv24d3y6doi6y.png)

Once the user has logged into the MCP, you don't have to ask for any additional permissions to write to the park location. Which means you can:

- Use **the operating user's own permissions**
- To save files to **that user's My Drive**
- Without the MCP itself owning a write-anywhere service account

Files end up in the user's drive, not on a shared service account. "Accidentally world-readable" or "visible to people who shouldn't see it" stops being a realistic accident — it's structurally prevented.

You also dodge the operational cost of issuing a separate GCP service account, storing its key safely, and managing its IAM policy out of band. The safety property genuinely comes for free.

There's one catch though:

> **The AI agent has to be able to read the spreadsheet URL it got back.**

Returning a URL alone doesn't help the AI access the underlying data. Stock tooling in Claude Code can't read a Spreadsheet directly, so you need a separate Workspace-operating MCP.

At airCloset we run **a dedicated MCP that wraps the Google Workspace APIs** (Drive / Sheets / Gmail / Calendar). Combined with the export pattern above, it gives us a clean flow: "drop results into a spreadsheet → call into the Workspace MCP later if the AI wants to actually read them."

```plaintext
DB Graph MCP → exports to Spreadsheet → returns URL
                                          ↓
              Workspace MCP ← invoked when the AI decides it needs to read the data
```

From the user's side, this naturally produces the rhythm of "dump it into a spreadsheet first, ask AI to analyze only when needed."

## Wrap-Up

A few small tricks for keeping self-built MCP server token consumption under control:

- **Move the parts that tend to grow off the MCP wire**
- **Park them somewhere — Git server, Spreadsheet, GCS — and only pass keys/URLs through MCP**
- **Pick a park that pairs well with Google Workspace OAuth — you get safety almost for free**
- **If you want the AI to read parked data later, run a Workspace-style MCP alongside**

It's an unflashy design move, but **the difference in MCP usability before and after is dramatic**.

If you're running self-built MCP servers internally and feeling the token squeeze, give it a try.
