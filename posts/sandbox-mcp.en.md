---
title: "Bridging 'I Want to Build' and 'I Want to Publish Safely' for Non-Engineers — Sandbox MCP"
publishedAt: "2026-04-27"
updatedAt: "2026-05-16"
slug: "sandbox-mcp"
summary: "Non-engineers can build AI apps, but publishing safely is still gated by engineers. Sandbox MCP gives them a one-command path to deploy Web/API/DB/Cron with guardrails."
tags:
  - "ai"
  - "typescript"
  - "mcp"
  - "webdev"
lang: "en"
syndication:
  zenn:
    id: "65efe9614f8e73"
  devto:
    id: 3559369
    slug: "bridging-i-want-to-build-and-i-want-to-publish-safely-for-non-engineers-sandbox-mcp-392a"
cover: /posts/sandbox-mcp.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

In my previous posts, I've introduced our internal MCP servers: [an MCP server for natural-language search across all our databases](/posts/db-graph-mcp), [the full picture of our 17 internal MCP servers](/posts/17-mcp-servers), and [a custom Graph RAG that lets AI answer "Did that initiative actually work?"](/posts/initiative-graph-rag).

This time I'm covering something a bit different: **Sandbox MCP** — a platform that lets non-engineer employees deploy apps they built with AI to a safe, internal-only URL **with a single command**.

The pitch is simple: "If Claude Code can build an app, why not publish it directly?" The hard part is making "directly" mean **safely**.

## The Problem: Building Got Easy. Publishing Safely Did Not.

The arrival of Claude Code and other AI coding agents is reshaping how work happens inside our company.

"Building an app" used to be an engineer's job. You had to do requirements, design, frontend, backend, database, CI/CD, production deploy — all in one head.

Now PMs, designers, and customer-success folks are talking to Claude Code with "build me a screen that does X" and getting working mockups on the spot. Inside airCloset we're seeing more and more:

- Mockups for new project proposals
- Interactive reports that visualize research findings
- KPI dashboards used only by a single team
- Small tools for everyday operational improvements

These **non-engineer outputs** are growing fast. People are even saying "let's just run with this in production for a bit."

That's where the wall hits.

### Easy to Build. Hard to Publish Safely.

Anyone can build something that runs locally now. Spin up `python -m http.server 8000`, view it on your Mac — five minutes max.

But the moment it becomes "I want my team to see this" or "I want others to actually use it," the difficulty curve goes vertical.

- **Where do you run it?** Cloud means GCP/AWS accounts, IAM, billing.
- **What URL?** Domain registration, DNS, SSL certificates, Cloudflare.
- **What about auth?** If it touches confidential info, you need employees-only. OAuth implementation, domain restriction.
- **And the data?** Is localStorage enough, or do you need a real DB? If a DB, who manages the password?
- **How do you deploy?** Can you write a Dockerfile? Cloud Run config, env vars, service accounts, IAM.
- **What about security?** What if the AI-written code has a vulnerability? An auth bypass?

You *could* "let the AI write all of it." But the result is **left to the AI**. Cloudflare misconfigured and exposed to the world. Auth bypassed. A service account with production database write access slipped into the code. The more code AI writes, the higher the risk of these accidents.

When a non-engineer says "I want to try building this," we need to clearly separate **what the builder is responsible for** from **what the platform must guarantee by default**.

There's also a quieter problem.

### UI Inconsistency and Data Sprawl

When non-engineers build apps independently:

- One person uses React, another Vue, another raw HTML
- Buttons look and behave differently
- Some store data in localStorage, some in Google Sheets, some in Firebase

After 10 or 20 such apps, internal tooling becomes **chaos**. Users wonder "wait, who built this one?" and "why does this button work differently?"

Even for internal tools, you need **a baseline of consistency** — both in design and in where data lives.

## Sandbox MCP — Standing Between "Build" and "Publish"

That's why we built **Sandbox MCP**.

A non-engineer just says "build this" to Claude Code, and:

1. An app is generated using a unified UI Kit
2. They can verify it works locally
3. A single command deploys it to `https://sbx-{nickname}--{app-name}.example.com/`
4. Self-hosted OAuth on the Cloudflare Worker enforces internal-only access
5. Data is stored, isolated, in a dedicated Firestore database

— all of this completes within a single chat session with the AI.
The builder is only responsible for **functionality**. **Security, data isolation, domain & SSL, authentication** are all handled by the Sandbox MCP platform by default.

![System Overview](/images/posts/sandbox-mcp/xv3llcbuytnfvmog7bxr.png)

### Scale

| Resource | Details |
|---|---|
| MCP tools | 10 (publish, status, schedule, list, delete, write_file, read_file, list_files, init_repo, unschedule) |
| Supported runtimes | Python (Flask + gunicorn), Node.js, static HTML/SPA, custom Dockerfile |
| URL | `sbx-{nickname}--{app-name}.example.com` (covered by Universal SSL, no ACM) |
| Authentication | Self-hosted OAuth on a Cloudflare Worker (Google Workspace) |
| Data | Firestore named DB `sandbox`, namespaced per nickname × app |
| Infrastructure | Self-hosted Git Server (GCE) + Cloud Run + Cloudflare Worker + KV |
| Deploy time | Typically 2–5 minutes (git push to public URL) |

Let's walk through the internals.

## What It Does — Web, API, DB, and Cron

Sandbox MCP supports four app shapes so it can cover almost any "I want to ship something internally" use case.

| Type | Detected by | Use cases |
|---|---|---|
| **Python** | `.py` files present | Flask + gunicorn for APIs, analysis tools with a UI |
| **Node.js** | `package.json` present | Express APIs + UI; Bun also works |
| **Static HTML/SPA** | only `.html` files (no Python/Node) | nginx-served, React/Vue dist supported |
| **Custom** | includes a `Dockerfile` | Any runtime — Go, Rust, Bun, anything |

Pick any of these and `sandbox_publish` deploys it with no extra config.

There's also `sandbox_schedule` for **scheduled batch apps via Cloud Scheduler**. Things like "post a risk summary to Slack at 9 AM every morning" become one-line cron setups.

```ruby
sandbox_schedule(
  app_name: "risk-alert",
  schedule: "0 9 * * *",
  path: "/api/cron",
  timezone: "Asia/Tokyo"
)
```

Cloud Scheduler now hits the app's `/api/cron` every morning at 9. No need to open the scheduler UI or translate cron syntax into IaC.

## Frontend — Unified Design via sandbox-ui-kit

Even apps built by non-engineers should feel **consistent as a tool family**. That's the job of the `sandbox-ui-kit` repo.

It lives on `mcp-sandbox.example.com/git` and provides:

| File | Contents |
|---|---|
| `sandbox-ui.css` | Design tokens + glass-morphism component styles (dark/light) |
| `sandbox-ui.js` | Theme switcher, modals, toasts, generic JS utilities |
| `sandbox-db.js` | SandboxDB client SDK (more below) |
| `index.html` | Storybook-style component catalog |
| `README.md` | Full API documentation |

The key: it's designed **for AI to read and use**.

The `sandbox_publish` tool description literally says:

> When building an app, first read README.md with read_file and use the UI Kit.

When Claude Code builds a new app, it `read_file`s this README, learns which CSS/JS to load and which component names to use, then generates code accordingly. **Instead of a human walking the AI through UI guidelines, we centralized the "how to use" in one place targeted at the AI.**

The result: apps built by anyone (with AI) end up with consistent buttons, modals, and forms.

## Backend — Auto-Generated Dockerfile + Cloud Run

"I don't want to write Docker." "I don't want to think about runtime configuration." Classic non-engineer requests.

Sandbox MCP **inspects the source files and generates a Dockerfile automatically**.

```typescript
// apps/mcp/git-server/src/sandbox/tools.ts
if (hasPy) {
  dockerfile = generatePythonDockerfile(hasRequirements);
  // Auto-create requirements.txt if missing
  if (!hasRequirements) {
    await writeFile('requirements.txt', 'flask\ngunicorn\n');
  }
} else if (hasPackageJson) {
  dockerfile = generateNodeDockerfile(true);
} else if (hasHtml) {
  dockerfile = generateStaticDockerfile();
}
```

For example, a Python app gets:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
CMD ["python", "-u", "$(ls *.py | head -1)"]
```

If `requirements.txt` is missing, `flask` + `gunicorn` get added automatically. AI can write `from flask import Flask` and the dependencies will resolve — no missing-package surprises.

Deployment uses `gcloud run deploy --source`, with Cloud Build handling the image build. App authors **can** write a `Dockerfile`, but they don't have to. No Dockerfile gets the standard, with one customizes — friendly to both non-engineers and engineers.

![Deploy Flow](/images/posts/sandbox-mcp/vy5mw049o12upk2mldy0.png)

## Database — Transparent Fallback Between localStorage and Firestore

"I want to save data. I don't want to set up a database."

The **SandboxDB SDK** handles that. The same code uses `localStorage` locally and Firestore once deployed.

```html
<script src="https://mcp-sandbox.example.com/api/db/sdk.js"></script>
<script type="module">
  const db = new SandboxDB({ token: googleOAuthAccessToken });

  // Save (storage location auto-detected from hostname)
  const { id } = await db.collection('items').add({ name: 'test' });

  // List
  const items = await db.collection('items').get();

  // Get / update / delete
  await db.collection('items').doc(id).update({ name: 'updated' });
  await db.collection('items').doc(id).delete();
</script>
```

The SDK internals:

```javascript
this._isLocal = location.hostname === 'localhost'
              || location.hostname === '127.0.0.1';

async add(data) {
  if (this._db._isLocal) return this._localAdd(data);  // localStorage
  return this._req('', 'POST', data);                  // Firestore REST API
}
```

When running on `localhost`, it uses localStorage. The moment it's deployed under `sbx-*.example.com`, it switches to Firestore. **No code changes required.**

This dramatically improves the experience of building apps with AI:

- Local: no network, no auth, all features work
- Deployed: same code runs, data is properly persisted
- Development data never leaks into systems outside Sandbox (it physically can't reach them)

### Firestore Namespace Isolation

Once deployed, data paths are strictly isolated:

```plaintext
sandbox_data/{nickname}--{app}/{collection}/{docId}
```

- `nickname`: user identifier resolved via OAuth
- `app`: Sandbox app name
- `_createdAt` / `_updatedAt`: auto-attached by the SDK

Data from different apps is physically unreachable from each other. Even apps built by the same person live in different paths.

The most important point: **we use a dedicated `sandbox` named database**. It's a completely separate Firestore database from the `(default)` DB used by other internal systems. No matter how badly an app's code misbehaves, it can never touch data outside Sandbox.

## Infrastructure — Wildcard DNS + Cloudflare Worker + Self-Hosted Git Server

Now for the infrastructure highlights.

### How URLs Are Determined

The public URL takes the form:

```plaintext
https://sbx-{nickname}--{app-name}.example.com/
```

`nickname` is **automatically pulled from the MCP OAuth session**. When a user logs into Sandbox MCP via Google, the email is looked up in a Firestore `users` collection to resolve the nickname. Users never have to repeat "I am ryan" each time.

```plaintext
r.tsuji@air-closet.com → users[r.tsuji@air-closet.com].nickname → "ryan"
                                                       ↓
                                  sbx-ryan--todo-app.example.com
```

> **Note**: The `users` collection is **kept in sync from a separate internal pipeline** (a daily batch that pulls from our HR system and Google Workspace directory). Sandbox MCP just reads from it — no need to maintain its own employee master.

The benefit: you can tell **whose app it is** just by reading the URL. When someone says "go look at ryan's todo-app," reading the URL aloud naturally communicates ownership.

### Instant Publishing via Cloudflare Worker

Normally, publishing a new subdomain requires:

1. Adding A/CNAME DNS records
2. Issuing an SSL certificate (15–30 minute wait with ACM or Let's Encrypt)
3. Configuring a load balancer or DomainMapping

Sandbox MCP skips all of this with a **Cloudflare Edge Router Worker**.

![URL Routing](/images/posts/sandbox-mcp/l06g6wirc5z4xsgqtoz9.png)

DNS is fixed as `*.example.com` **wildcard** + Cloudflare proxy, with Universal SSL automatically covering every subdomain. The Cloudflare Worker receives all `*.example.com/*` traffic and routes by subdomain.

The logic is three-tier:

```typescript
// apps/worker/edge-router/src/index.ts
export async function handleRequest(request, env) {
  const url = new URL(request.url);

  // ① sbx-* prefix → Sandbox routing
  const sandboxSub = extractSandboxSubdomain(url.hostname);
  if (sandboxSub !== null) {
    return handleSandboxRequest(request, url, sandboxSub, env);
  }

  // ② KV route:{subdomain} registered → Cloud Run proxy
  const subdomain = extractSubdomain(url.hostname);
  if (subdomain) {
    const proxyResponse = await handleCloudRunProxy(request, url, subdomain, env);
    if (proxyResponse) return proxyResponse;
  }

  // ③ Otherwise → fetch(request) passthrough
  return fetch(request);
}
```

When `sandbox_publish` finishes, all it does is **write a `route:{nickname}/{app}` key into Cloudflare KV**. That single write makes the new subdomain routable instantly.

```typescript
await kvPut(`route:${nickname}/${appName}`, serviceUrl);
```

No DNS setup. No waiting for SSL issuance. No IaC deploy. Everything completes within the MCP tool execution.

### Self-Hosted Git Server for Larger Apps

This setup actually started out **without git at all**.

Since the primary users were going to be PMs and CS folks, we figured "git concepts are too high a bar — let's keep everything inside MCP tools." Write files via `sandbox_write_file`, deploy via `sandbox_publish`. That should be enough, we thought.

The approach hit two walls quickly.

**Wall 1: Constant chunking**

MCP tool calls travel over HTTP, with a payload size limit. React/Vue build bundles, SPAs with images, business tools with dozens of files — they don't fit in a single call. We added an `append` mode to `sandbox_write_file` for chunking, but every "first half of file A → second half of file A → first half of file B → ..." sequence triggered error recovery and retries. Deployments became flaky.

**Wall 2: Massive token consumption**

This was the real killer. When you tell the AI "deploy this app," it sends the entire source as MCP tool arguments. **The file contents land in the conversation context**, and a few-thousand-line app burns through tokens fast. A single deploy easily consumed tens of thousands of tokens, and Claude Code sessions hit compaction quickly.

Worse, the AI tends to "verify after sending" — re-reading the same file via `sandbox_read_file`. **Write → read → write loops, with tokens going up in flames.**

So we pivoted to **using git push as well**. With git push:

- No file size limit
- Differential transfer — second-time pushes are fast
- Source code stays out of the MCP conversation context (no AI tokens consumed)

We never expected business-side employees to run `git push` by hand. But if **Claude Code runs git commands in the background**, it's not a barrier. The user just says "build this and publish it" — the AI runs `git init && git push` on its own when needed.

### Why a Self-Hosted Git Server?

Once we adopted git push, the next question was: where do we host the repos? We considered using GitHub Organizations but ruled it out.

**Issuing and managing GitHub accounts for every employee** — including non-engineers — wasn't worth the cost or the operational overhead. Paying for a GitHub seat just to ship one app is overkill.

Fortunately, we already operated **a self-hosted Git Server on GCE for a different purpose**: hosting an internal "read-only Git MCP for code investigation." A VM with repositories cloned under `/mnt/repos/`.

We just added a **Git Smart HTTP Protocol** endpoint and one new repo (`sandbox-apps`) to it. The VM was already running, so the marginal cost was near zero. Authentication piggybacks on the existing Google OAuth setup. Repository management is just OS directory operations. Borrowing space on the existing internal Git Server was vastly simpler than spinning up new infrastructure.

### Actual Usage Flow

```bash
# 1. Get the git URL from the MCP tool (nickname is automatic)
sandbox_init_repo(app_name: "my-app")
# → https://mcp-sandbox.example.com/git/sandbox/ryan/my-app.git

# 2. Local commit (the AI does this in the background)
cd ~/my-app/
git init && git add . && git commit -m "init"
git remote add sandbox <returned URL>

# 3. Push
git push sandbox main
# Username: oauth2accesstoken
# Password: $(gcloud auth print-access-token)

# 4. Deploy
sandbox_publish(app_name: "my-app", description: "...")
```

Auth uses a Google OAuth token as the Basic Auth password (same pattern as GCP Source Repos). Only `@air-closet.com` accounts pass. No GitHub account required — any employee can push.

The remote repo is configured with `receive.denyCurrentBranch=updateInstead`, so the working tree updates server-side on push. Cloud Run uses that directory as `--source`, so there's no extra step between push and publish.

For small apps (a few files, hundreds of lines each), `sandbox_write_file` still works fine. **Switch between MCP-only and git push depending on app size.**

## Security — Four Independent Gates

That covered the "convenient to build" side. Now the **"safe to publish"** side.

As I noted at the start, exposing AI-generated code in front of users is risky. So Sandbox MCP layers four independent safety mechanisms that **don't depend on the app's own implementation**.

![Security Layers](/images/posts/sandbox-mcp/p111zuy4cxhyinp13byt.png)

### ① Public-Facing Gate — Self-Hosted OAuth on the Cloudflare Worker

`sbx-*.example.com` sits behind a **self-hosted OAuth gate built into the same Cloudflare Worker** that handles routing. When someone visits, the Worker first checks the `cortex_session` cookie; if it's missing or invalid, it redirects to a Google Workspace SSO entry point (`auth.example.com/__edge/auth/start`). Without an `@air-closet.com` account, requests never reach Cloud Run.

This is **independent of the app's implementation**. Even if the AI didn't write a single line of auth code, the Worker stops the request first. "Accidentally public" is physically impossible.

#### Why we migrated from ZeroTrust Access to self-hosted OAuth

The first iteration used **Cloudflare ZeroTrust Access**. You just configure the `@air-closet.com` domain restriction in the Cloudflare dashboard and you're done — no auth code at all. As a starting point it was ideal.

The catch: **ZeroTrust's free tier caps at 50 users**. As headcount grew and Sandbox MCP usage spread, we approached the cap, and switching to pay-as-you-go (~$7/user/month) wasn't trivially cheap. On top of that we wanted to share the same auth foundation with internal apps in production (KPI dashboards, inventory tools, etc.), so we decided to **consolidate everything into a self-hosted OAuth with no user limit**.

Conveniently, the Cloudflare Worker already in front of every `*.example.com` request — the routing layer Sandbox MCP relies on — was perfectly positioned for this. A small extension gave us:

- `auth.example.com/__edge/auth/start` to kick off Google OAuth 2.0
- `auth.example.com/__edge/auth/callback` to exchange tokens, persist the session in Upstash Redis, and issue a `cortex_session` cookie scoped to `Domain=.example.com`
- Worker-level gating for sandbox + internal-app subdomains, injecting `X-Cortex-User-Email` and friends into the Cloud Run request when authenticated

All of this fits inside the existing Worker — no extra Cloud Run, no extra VM. Workers do have a CPU-time budget, but **OAuth flows and cookie checks complete in single-digit milliseconds**, so latency is indistinguishable from ZeroTrust.

Net result: the user cap is gone, anyone with `@air-closet.com` can use Sandbox out of the box, and the auth implementation is fully visible in our own codebase.

### ② Deploy Gate — MCP OAuth

Operations like `sandbox_publish` and `sandbox_delete` **enforce Google OAuth on the MCP server side**. Sandbox MCP implements RFC 8414 (`/.well-known/oauth-authorization-server`), so Claude Code runs the OAuth flow automatically on first connection.

The strongest guarantee is **"you can't accidentally update or delete someone else's app."**

When multiple people share a Sandbox MCP, an AI accident like "wait, I overwrote a coworker's app while updating mine" would be devastating. To prevent that, **the AI doesn't get to decide whose app is being touched**. The server injects `nickname` automatically from the OAuth session.

```typescript
// Strip the `nickname` property from the MCP tool schema and have
// the server force-inject the logged-in user's nickname.
function injectNickname(tool: McpTool, userNickname?: string): McpTool {
  const { nickname: _, ...restProperties } = tool.schema.inputSchema.properties;
  return {
    schema: { ...tool.schema, inputSchema: { ...tool.schema.inputSchema, properties: restProperties } },
    execute: (args, ctx) => tool.execute({ ...args, nickname: userNickname }, ctx),
  };
}
```

From the AI's perspective, the `nickname` input doesn't exist. Even with a prompt injection like "delete ryan's app," there's no mechanism to do so. **"You can only touch your own apps" is enforced at the API spec level.**

On top of that, inputs are validated strictly against `/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/`, rejecting shell-injection and path-traversal patterns (`..`, `/`).

### ③ Data Gate — SandboxDB Namespace Isolation

As mentioned earlier, data lives at:

```plaintext
sandbox_data/{nickname}--{app}/...
```

Per request, the SandboxDB API resolves the path **server-side**:

- Browser (OAuth): resolve `email → users → nickname`, take `app` from the `Origin` header
- Backend (SA token): take `nickname/app` from the `X-Sandbox-App` header (required — missing returns 400)

The client cannot spoof the path.

We deliberately do **not** use the `K-Service` header (the Cloud Run-injected service name). That's a client-spoofable header, and another implementation that relied on it had a "read another app's data" vulnerability disclosed. Requiring `X-Sandbox-App` keeps the only valid route through an explicitly server-validated path.

The clincher: **a dedicated named database for Sandbox**. Instead of the `(default)` DB (which contains data from other systems), we use an independent Firestore database called `sandbox`, and the Cloud Run SA gets an IAM Condition that allows access only to the `sandbox` DB.

```typescript
// From infra/mcp/git-server/index.ts
// IAM Condition on roles/datastore.user:
//   resource.name == "projects/.../databases/sandbox" ||
//   resource.name.startsWith("projects/.../databases/sandbox/")
```

No matter how badly the AI-written code goes wrong, it physically cannot reach data outside Sandbox.

### ④ Execution Gate — Cloud Run SA + IAM

All `sandbox-*` Cloud Run services run under **a single shared SA** (e.g. `sandbox-run`). The permissions on that SA are minimal.

- `roles/logging.logWriter` (write its own logs)
- `roles/bigquery.jobUser` + `bigquery.dataViewer` scoped to the `sandbox_logs` dataset only (its own access logs, nothing else)
- `roles/datastore.user` (IAM Condition limiting to `sandbox` DB)

What it does **not** have:

- Access to the `(default)` Firestore that holds data from other systems
- Access to BigQuery datasets used by other internal systems
- Direct access to Secret Manager
- Permission to manage other Cloud Run services

In other words, **even if a Sandbox app goes completely rogue, the blast radius is limited to `sandbox_data` and `sandbox_logs`**. Nothing outside Sandbox is affected.

## Logging — Apps Can Query Their Own Access Logs

Sandbox apps eventually want to look at logs too. "How many views did this page get?" "Who hit that error?"

We forward Cloud Run request logs to BigQuery via a **Logging Sink**:

```typescript
// From infra/mcp/git-server/index.ts
const sandboxLogSink = new gcp.logging.ProjectSink('sandbox-logs-sink', {
  destination: `bigquery.googleapis.com/projects/${projectId}/datasets/sandbox_logs`,
  filter: [
    'resource.type="cloud_run_revision"',
    'resource.labels.service_name:"sandbox-"',
    'logName:"run.googleapis.com%2Frequests"',
  ].join(' AND '),
  bigqueryOptions: { usePartitionedTables: true },
});
```

The `sandbox_logs` dataset is locked down with **project-owner-only ACLs** (it contains PII like remoteIp and User-Agent), and the Sandbox SA gets a tightly scoped `bigquery.dataViewer` to it.

This lets apps query their own access logs from BigQuery. "Post last week's user count for this app to Slack" can be done entirely inside Sandbox.

## Tool Design — Making AI Use Tools Correctly

Let me close with a note on tool definitions. I personally think this is where MCP design really makes or breaks.

Sandbox MCP exposes 10 tools:

| Tool | Purpose |
|---|---|
| `sandbox_publish` | Start deploy (async) |
| `sandbox_deploy_status` | Check deploy status |
| `sandbox_init_repo` | Initialize git push repo |
| `sandbox_write_file` | Write file (overwrite/append) |
| `sandbox_list` | List apps |
| `sandbox_delete` | Delete app |
| `sandbox_schedule` | Configure Cloud Scheduler |
| `sandbox_unschedule` | Remove Cloud Scheduler |
| `sandbox_read_file` | Read source code |
| `sandbox_list_files` | List files |

Whether the AI picks the right tool at the right moment is almost entirely determined by **what's written in the tool description**.

For example, the description for `sandbox_publish` covers not just functionality but also:

- Supported app types and required files (Python / Node.js / static HTML / custom)
- Startup command and PORT requirement per type
- When to use `write_file` vs `git push`
- How to use SandboxDB (with SDK code samples)
- How to use the UI Kit (explicit instruction to fetch README.md via `read_file`)

With this in place, the AI can autonomously do:

1. User says "build me a tool that displays Slack emoji scores"
2. → Reads `sandbox_publish` description and sees "first read the UI Kit README"
3. → Calls `read_file` on `sandbox-ui-kit/README.md`
4. → Generates HTML/CSS/JS following the guidelines
5. → Sees the SandboxDB SDK usage in the description and integrates persistence
6. → Calls `sandbox_publish`

— without asking the user a single follow-up question. **Writing not just "what it does" but "what to do with it" into the tool definition** is the secret to AI-friendly design.

If you write tool definitions tersely, the AI keeps coming back asking "what should I do next?" The description is less of a human-facing doc and more of an **AI-facing runbook**. That framing helps a lot.

## Wrap-Up

Sandbox MCP exists to answer two challenges of building internal tools in the AI era:

- **Building** is now possible for anyone, thanks to AI
- **Publishing safely** remains hard

To close that gap, we:

- **Standardized every layer** on the platform side: frontend / backend / DB / infra / auth / domain / SSL
- **Embedded a runbook into tool descriptions** so the AI naturally uses things correctly
- **Layered four access gates** (Worker-level OAuth / MCP OAuth / namespace isolation / IAM) so safety **doesn't depend on the implementation being correct**

Building this, what struck me again is that **the role of platforms in an AI-powered development era is shifting**. Platforms used to optimize for "easy for humans." Now they also need to optimize for **"used correctly by AI."** Tool descriptions are AI-facing docs, and safety must be designed assuming AI will write incorrect code.

At the same time, by **limiting what the builder is responsible for**, we drastically lower the barrier to "let me just try something." That's the entry point that turns a non-engineer's "I want to build this" into actual operational improvements.

I hope this is useful for anyone designing internal platforms.
