---
title: "We Built 17 MCP Servers to Let AI Run Our Internal Operations"
publishedAt: "2026-04-07"
updatedAt: "2026-05-16"
slug: "17-mcp-servers"
summary: "Overview of 17 MCP servers we built in three months at airCloset, covering DBs, infra, docs, project management, observability, CI/CD, and even non-engineer code edits."
tags:
  - "ai"
  - "gcp"
  - "typescript"
  - "webdev"
lang: "en"
syndication:
  zenn:
    id: "d9fc317c1336c2"
  devto:
    id: 3467141
    slug: "we-built-17-mcp-servers-to-let-ai-run-our-internal-operations-3lk2"
cover: /posts/17-mcp-servers.en.cover.png
---

## Introduction

In a previous article, I introduced "DB Graph MCP" — a system that enables safe, cross-schema search and query execution across our entire database estate of 17 DBs and 994 tables.

/posts/db-graph-mcp

Thanks to the positive response, this time I'd like to introduce **the rest of our MCP server fleet** beyond DB Graph.

These were all built in roughly 3 months starting January 2026. We now have **17 MCP servers** in production, covering databases, infrastructure, documentation, project management, observability, CI/CD, and even code editing and deployment by non-engineers — making virtually every aspect of our operations accessible to AI.

## Overview

Here's the full lineup:

| Category | Server | Description |
|----------|--------|-------------|
| **Data** | DB Graph | Company-wide DB dictionary + query execution ([previous article](/posts/db-graph-mcp)) |
| **Infrastructure** | GCloud | GCP resources, read-only |
| | AWS | AWS resources, read-only |
| **Docs & Knowledge** | GWS | Full Google Workspace access |
| | Git Server | All Git repos, read-only |
| **Graph** | Code Graph | Codebase analysis (function → API → DB → event dependency tracking) |
| | Product Graph | Unified knowledge graph: code + DB + docs |
| | Biz Graph | Business initiative × KPI relationship graph |
| **Observability** | Grafana | Logs, metrics, and alert inspection |
| **CI/CD** | CircleCI | Pipeline execution, build logs, test results |
| **Project Management** | Project Management | BQ/Firestore/Sheets-integrated PM support |
| **Domain-Specific** | Stylist Insights | Stylist performance & KPI data |
| | UX Insights | UX analytics from BQ |
| | freee | Accounting API integration |
| **Dev Platform** | Workspace | ACL-gated monorepo editing & deployment |
| | Sandbox | [App deployment for non-engineers](/posts/sandbox-mcp) |

All servers are implemented in **TypeScript**, deployed to **GCP via Pulumi**, and authenticated with **Google OAuth**.

## Design Philosophy

### Why So Many Servers?

We could have built one monolithic MCP server, but we deliberately split them. Here's why:

- **Auth scope isolation** — GWS needs Workspace API scopes; the DB query server doesn't. Minimizing scopes prevents privilege escalation.
- **Deploy independence** — A Grafana server change doesn't affect DB queries. Blast radius stays small.
- **Per-user selection** — Engineers add everything; marketing adds only GWS. Just put what you need in `.mcp.json`.

### Shared Foundation

Every server shares common patterns:

**Auth**: A shared package implements Google OAuth 2.0 + PKCE with RFC 8414 auto-discovery. Just add the URL to `.mcp.json` and Claude Code handles the auth flow automatically. For business users, we simply register them as custom connectors in the Claude organization settings.

```json
{
  "mcpServers": {
    "server-name": {
      "type": "http",
      "url": "https://mcp-xxx.your-domain.example/mcp"
    }
  }
}
```

That's it. No `auth` block needed. Same format for every server.

**Session management**: Upstash Redis as a shared session store across all servers. SSO cookies mean one login grants access to everything.

**Tool usage logging**: Every tool invocation is recorded in BigQuery. Who used what, when — fully auditable. We monitor usage rates, error rates, and usage patterns to drive improvements.

## Infrastructure: GCloud / AWS

Have you ever wanted to let AI investigate your cloud environment? And simultaneously thought: **"Is it safe to let it do that?"**

In my case, I have admin-level privileges, which makes it even scarier. So I built **MCP servers that are physically incapable of writing anything**.

Two key design decisions:
1. **OIDC / STS / Impersonate for secure auth** — Zero persistent credentials
2. **Per-account audit logging** — Individual email addresses recorded in GCP Audit Log / CloudTrail

### GCloud MCP

```plaintext
Claude Code → MCP Server → gcloud CLI subprocess → GCP APIs
```

Runs `gcloud` CLI on Cloud Run. The key point: **writes are made impossible at the OAuth scope level**.

- OAuth scope: `cloud-platform.read-only`
- GCP APIs check **both** scope and IAM — even admin users cannot write
- GCP Audit Log records the user's email address
- Account revocation on departure: just disable the Google Workspace account

```markdown
# What you can do
"Show me the Cloud Run services in prod"
"Check the env vars for this service"
"List the Secret Manager secrets"
```

### AWS MCP

Same philosophy, but AWS can't accept Google OAuth directly, so we use STS as a bridge.

```plaintext
Claude Code → MCP Server → GCP metadata → ID Token
                         → AWS STS AssumeRoleWithWebIdentity → temp credentials
                         → aws CLI subprocess → AWS APIs
```

**Two layers of safety**:
1. IAM Role with `ReadOnlyAccess` policy only
2. Temporary credentials with 1-hour expiry

Supports multiple AWS accounts via `profile` parameter. CloudTrail records `assumed-role/mcp-aws-readonly/user@example.com`.

## Docs & Knowledge: GWS / Git Server

### GWS (Google Workspace) MCP

Operate **all Google Workspace services** from Claude Code.

```plaintext
Claude Code → MCP Server → gws CLI subprocess → Google Workspace APIs
```

Runs [gws CLI](https://github.com/nicholasgasior/gws) remotely, passing the user's OAuth access token directly. **Each user accesses resources with their own permissions** — you can see your Drive but not someone else's.

Since OAuth authentication and Google Workspace authorization happen simultaneously, **the moment you connect to the MCP you have immediate access to your Workspace resources**. No additional login or token setup required — the experience is seamless.

```markdown
# What you can do
"Summarize the sales data in this spreadsheet"
"Extract meeting notes from last week's calendar"
"Summarize this document"
```

### Git Server MCP

A **read-only** server for all company Git repositories.

The motivation: **bypassing GitHub MCP rate limits**. GitHub's official MCP server hits the GitHub API under the hood, and the rate limit kicks in surprisingly fast when AI is investigating a codebase.

Git Server MCP keeps main-branch clones of all repos on a GCE VM, operating via **local git commands with zero rate limiting**. Query as much as you want.

| Tool | Description |
|------|-------------|
| `git_blame` | Last change commit per line |
| `git_log` | Commit history |
| `git_grep` | Cross-repo text search |
| `git_show` | Commit details |
| `git_diff` | Diff between commits |
| `read_file` | Read file contents |
| `list_files` | List directory contents |
| `search_repos` | Search repositories |

No GitHub account needed — OAuth authentication is sufficient.

## Observability: Grafana MCP

The official `mcp/grafana` Docker image deployed on Cloud Run, with an OAuth proxy in front.

```plaintext
Claude Code → OAuth Proxy → mcp-grafana → Grafana Cloud
```

Supports PromQL/LogQL queries, dashboard inspection, and alert rule review.

What's important is that Grafana dashboards and alert rules are also defined in the same repository as **Pulumi (TypeScript)**. This means:

1. Write application code
2. Define alert rules in the same repo
3. Alert fires in production
4. Claude Code reads logs via Grafana MCP
5. Fix the code in the same repo

The **code → infra → observability → investigation → fix** loop is completely closed.

## CI/CD: CircleCI MCP

Integrates with CircleCI API v2. A shared CircleCI token sits behind Google SSO, so the whole team uses it without managing tokens.

```plaintext
Claude Code → OAuth Proxy → CircleCI MCP (sidecar) → CircleCI API v2
```

Cloud Run multi-container setup: the official `@circleci/mcp-server-circleci` runs as a sidecar, with our OAuth proxy in front.

```markdown
# What you can do
"What's the status of the latest pipeline on main?"
"Show me the failure logs for this build"
"Find flaky tests"
```

## Project Management MCP

A server for managing issues in Firestore and semantically searching Slack/Meet conversations.

Key capabilities:
- **Issue management**: Create, update status, and list Issues in Firestore (with spreadsheet dual-write)
- **Context search**: **Vector search + Gemini summarization** across Meet notes and Slack conversations
- **Project overview**: View milestones, members, design docs, and test cases for your projects
- **Backlog integration**: Retrieve ticket parent-child relationships via BQ

## Domain-Specific

### Stylist Insights / UX Insights MCP

Servers providing access to stylist performance/KPI data and UX analytics, respectively. Query interfaces over BQ aggregate tables.

### freee MCP

An OAuth-authenticated proxy to the freee API for accounting data access.

## Dev Platform: Workspace / Sandbox

This might be the most unique part.

### Workspace MCP — Code Editing Without a GitHub Account

Provides **ACL-gated file editing, commits, PR creation, and deployment** for our internal monorepo.

**No GitHub account required**. Only a Google Workspace account (OAuth) is needed.

```plaintext
1. workspace_init          → Create worktree, initialize branch
2. workspace_write_file    → Edit code
3. workspace_diff          → Review changes
4. workspace_commit        → Commit
5. workspace_push          → Push to GitHub
6. workspace_deploy        → Deploy from feature branch (test)
7. Verify it works
8. workspace_create_pr     → Request review
```

Access control is managed in Firestore. Admins configure **which stacks (directories) each user can edit and deploy**.

```json
{
  "allowedPaths": ["apps/web/xxx/", "apps/api/xxx/"],
  "allowedStacks": ["api-xxx", "pages-xxx"],
  "role": "developer"
}
```

Non-engineers can **safely edit and deploy only the stacks they're authorized for**. In practice, a non-engineer team member is already using AI + Workspace MCP to improve a full-scratch KPI dashboard.

### Sandbox MCP — App Deployment for Non-Engineers

Going even further: **non-engineers can deploy their own apps for internal use**.

```plaintext
1. sandbox_init_repo(app_name: "my-tool")    → Initialize repo
2. sandbox_write_file(...)                    → Write files
3. sandbox_publish(app_name: "my-tool")       → Deploy to Cloud Run
   → https://sbx-{nickname}--my-tool.example.com/
```

No gcloud, no Docker. Just tell Claude "I want a tool that does X" and it's published on an internal URL.

Deployed apps are protected by **Cloudflare Access with Google Workspace authentication**, so only internal members can access them. Even though they're on the public internet, access from outside the organization is impossible.

I wrote [detail article](/posts/sandbox-mcp).

## Graph Servers: Code Graph / Product Graph / Biz Graph

A family of servers that analyze codebases and business logic as graph structures.

| Server | Scope | Key Feature |
|--------|-------|-------------|
| DB Graph | Company-wide DBs ([previous article](/posts/db-graph-mcp)) | Table dictionary + semantic search + live DB queries + PII anonymization |
| Code Graph | All source code (cross-repository) | Static analysis tracking function → API → DB → event dependencies across repos |
| Product Graph | Internal monorepo | Unified knowledge graph of code + DB + docs. Every node has business context |
| Biz Graph | Business initiatives & metrics | Initiative × metric relationship graph |

Each has a different design philosophy and solves different problems. See the previous article for DB Graph; details on the others are coming in future posts.

## Security Model

Here's the security approach shared across all servers.

### Defense in Depth

```plaintext
Layer 1: Google Workspace OAuth + domain restriction
  → Organization domain only. External users cannot log in.

Layer 2: SSO + session management
  → Upstash Redis, 7-day TTL, sliding window

Layer 3: Per-server scope restrictions
  → GCloud: cloud-platform.read-only
  → AWS: ReadOnlyAccess policy
  → DB Graph: SELECT only + PII anonymization

Layer 4: Data-level protection
  → Automatic PII anonymization (40+ column patterns)
  → Confidential datasets controlled by BQ IAM
  → Production DBs via read replicas only

Layer 5: Audit logging
  → All tool invocations recorded in BQ
  → Individual email in GCP Audit Log / CloudTrail
```

### Automatic Revocation on Departure

Since every server depends on Google OAuth, **disabling a Google Workspace account instantly revokes access to all MCP servers**. No individual token revocation or account cleanup needed.

## Takeaways

Lessons learned from building and operating our MCP server fleet:

**1. Centralize authentication**
Building OAuth as a shared package made adding new servers dramatically easier. Auth code per server is about 10 lines.

**2. Start read-only**
GCloud, AWS, and Git Server are all read-only. Allow reads first; add writes only when truly needed. This keeps security discussions simple.

**3. Wrap existing tools**
gcloud CLI, aws CLI, gws CLI, CircleCI MCP — put existing CLIs and MCP servers behind an OAuth proxy and the whole team can use them safely. No need to build from scratch.

**4. Non-engineer access is the most exciting frontier**
Workspace MCP and Sandbox MCP provide the foundation for non-engineers to edit code and deploy without a GitHub account. It's still early and the big wins are ahead, but this is where the most potential lies.

**5. Keep everything in one repository**
Application code, infrastructure (Pulumi), observability (Grafana alert rules), MCP servers — all in a single monorepo. This closes the loop: write code → deploy → monitor → find issues → fix.

---

In the DB Graph article, I described the problem of "how tables relate to each other existing only in specific people's heads." Looking at the full MCP server fleet, it's clear this isn't limited to databases.

**Infrastructure state, code dependencies, document contents, project progress, user behavior logs** — all of these were trapped in people's heads. Eliminating that is the essential role of our MCP server fleet.

Externalizing knowledge into a form that AI can access. That's the common theme across all our MCP servers.
