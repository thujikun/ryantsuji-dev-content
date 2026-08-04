---
title: "When Shipping Gets Cheap, Deciding Gets Expensive: Guardrails for AI-Era Cloud Costs"
publishedAt: "2026-08-06T08:30:00+09:00"
updatedAt: "2026-08-06T08:30:00+09:00"
slug: "ai-cost-governance"
summary: "We spent a week going through our AI platform's cloud bill. Cloud Run instance-based billing dropped 84%, container image storage dropped 65%. But the numbers aren't the point. When implementation gets cheap, the slowness that used to force you to ask whether something was worth building disappears with it. This is about what replaced that gate: a cost check at merge time, daily visibility, and quotas set from measured usage rather than the platform default."
emoji: "🧾"
tags:
  - "gcp"
  - "cloudrun"
  - "devops"
  - "ai"
lang: "en"
syndication:
  devto:
    id: 4308732
    slug: "when-shipping-gets-cheap-deciding-gets-expensive-guardrails-for-ai-era-cloud-costs-5g43-temp-slug-1164259"
    contentHash: "7e409a8c61610f6a"
    publishAt: "2026-08-06T08:30:00+09:00"
cover: /images/posts/ai-cost-governance.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

We spent a week going through the cloud bill for our internal AI platform. The results, up front:

- Cloud Run instance-based billing down 84% (44% on the single service we tested first)
- Container image storage down 65% after revisiting how many versions we keep
- The thing that mattered most wasn't any single cut. It was the gate at merge time and the daily visibility

But the savings aren't really what I want to write about. **When implementation gets cheap, the cost of deciding whether to build something stays exactly where it was, and suddenly it's the expensive part.**

## Slow implementation used to be a decision gate

This isn't a post about AI, exactly. But AI is what makes this particular thing grow.

Building anything used to cost real time. You'd estimate it, review the design, carve out the engineering time. That process is tedious, and it also had a side effect nobody designed for: it forced you to ask whether the thing was worth building at all. **The slowness itself was the gate.**

Make implementation fast and that gate comes off. You can ship an idea the same day you have it. That's genuinely good, and it makes "just build it and find out" the right call far more often than it used to be.

What also comes off, though, is any reason to hold back. Each individual thing is small enough that nobody objects. And what's left behind isn't engineering hours, it's the running cost of whatever you shipped. That part doesn't show up on the day you build it. It accumulates quietly afterward.

## The starting point: we couldn't attribute spend to an app

What kicked this off was a handful of occasions where usage-based spend grew more than we expected after a particular change. BigQuery scan volume, and Vertex AI / Gemini calls.

The frustrating part was that **we couldn't attribute the spend back to a specific app after the fact**. BigQuery does let you label query jobs, and job history is there. But several of our apps run under the same service account, so knowing which principal ran a query didn't tell us which app was responsible. We could push labels through every call path, but until that's fully rolled out you're in the same position.

If you can't attribute after the fact, you stop it before it grows. That's where the idea of putting a gate at the entrance came from.

## Visibility comes before any of the cuts

Here's the conclusion first: **the highest-leverage part of this whole week was the gate at merge time and the daily reporting, not any individual optimization.** Cuts are one-time. Left alone, the same things pile up again.

### The gate: changes above a threshold go to a human

We added cost as a review dimension for our AI reviewer. If a PR pushes usage-based spend past a threshold, it gets handed to a human. Three thresholds:

| Category | Threshold |
| --- | --- |
| Ongoing daily cost increase | ¥2,000/day (~$13) |
| One-off execution cost | ¥10,000 (~$65) |
| Monthly storage growth | ¥1,000/month (~$6) |

The design choice I care about here: **the AI doesn't do the arithmetic**. It reads the change and measures quantities like scan volume, call counts, and token counts. Converting to currency and comparing against the threshold happens in a deterministic script. Hand the money math to a model and you get occasional arithmetic slips, the wrong unit price, and answers that drift between runs. A gate that gives different answers on different days isn't a gate.

Unit prices come from our actual billing export (spend ÷ usage), not from the published rate card. Hardcoding list prices means carrying three separate sources of drift: USD conversion, exchange rate, and committed-use discounts.

Storage gets its own threshold because **cumulative cost behaves differently from execution cost**. Stop a job and its daily cost goes to zero. Data you've written keeps billing until someone deletes it. So for storage we ask a different question: is there an expiration policy, and what does this add per month going forward? That's a **forward projection**, computed from call volume times payload size, not a measurement of what already happened.

### Daily reporting: post to Slack twice a day

We post per-app cost to Slack twice a day. A few decisions in there worth mentioning.

**Post even on days when nothing crossed a threshold.** "Nothing to see today" is information, and more importantly, the reader needs to be able to tell the difference between a quiet day and a broken reporter. A monitor that only speaks up when something's wrong can't tell you it's dead.

**Compare against the same weekday last week, not yesterday.** Batch volume varies by day of week, so a day-over-day comparison flags every Monday as a spike, and people stop reading it within a week.

**Treat "no data last week" as an increase.** This is the dangerous case. A batch that just started running is exactly the thing that surprises you. Percent-change metrics tend to drop these on the floor because the math is undefined when the baseline is zero, so we handle that case explicitly.

### The backstop: put a ceiling on usage-based services

Gates and reporting still leak. There are paths that don't go through a PR at all, like manual runs, external triggers, and usage patterns nobody anticipated.

So for anything that bills by usage, **set a ceiling that matches how you actually operate**. BigQuery, Vertex AI, and Gemini all let you cap this with quotas.

The important part is to **derive the ceiling from measured usage, not from what the platform allows**.

Take BigQuery. On-demand pricing has a default cap of **200 TiB per day, per project** (that's been the default since September 2025; before that it was unlimited). Per-TiB pricing varies by region, but at a few dollars per TiB, **that ceiling works out to somewhere north of a thousand dollars a day**. Run that for a full month and you're at tens of thousands of dollars.

Which means the default setting is: spend that much, every month, without anyone being told. That isn't a ceiling.

We cap BigQuery scan volume at roughly 1.5x our normal usage. "Ten times normal, to be safe" has the same problem as the default. A ceiling only means something if it sits where a runaway actually stops.

One thing to be clear about: **we can do this because this is internal infrastructure.** Capping at 1.5x means accepting that things stop when they hit the cap. For an internal platform, you rerun it tomorrow. Do the same thing on a customer-facing path and you've built yourself an outage. **Only put this kind of ceiling on things that are allowed to stop.** For anything touching end users, set the ceiling much higher and handle it with alerting and autoscaling instead.

Given that constraint, the side effects are fine. A legitimate job occasionally hits the cap, and when it does, that's a prompt to go find out why something needed 1.5x normal volume. Which is its own kind of detection. **Alerts tell you afterward. A quota stops it while it's happening.** With usage-based billing that difference matters.

![Three layers that stop cost from piling up](/images/posts/ai-cost-governance/three-layer-guardrails-en.png)

If you try to run any of this as a habit rather than a system, it evaporates the first busy week. **It only works once it's structural.** Gate at the entrance, daily reporting for the continuous view, quota as the hard stop. Three layers, and only together do they make the invisible visible.

## Case 1: when the default is the expensive one, speed builds debt

Now the things we actually found. Cloud Run first.

Cloud Run has two billing models: instance-based, where CPU is always allocated, and request-based, where it's allocated only while handling a request. **97% of our Cloud Run spend was instance-based.**

The cause was structural. Looking at where we define Cloud Run services in our repo, **most of them didn't specify `cpuIdle` at all**. There's no shared factory, so every new service silently landed on the expensive side unless someone thought to set it.

Worth knowing: **deploy from the console or gcloud and the default is request-based**, the cheap one. Define the same service declaratively in IaC with explicit resource limits and `cpuIdle` ends up false, which puts you on instance-based. So **click it together and you get the cheap default; write it as code and you get the expensive one**. The more disciplined your infrastructure practice, the easier this is to miss.

Which is the whole point from earlier. **When the default sits on the expensive side, going faster builds debt automatically.** The per-service difference is small enough that nobody notices.

### The name reads backwards

There's a trap in the naming. The setting is called `cpuIdle`.

| Value | Behavior | Billing |
| --- | --- | --- |
| `true` | CPU allocated only during requests | Request-based (cheaper) |
| `false` (IaC default) | CPU always allocated | Instance-based (pricier) |

Read `true` as "keeps running while idle" and you have it exactly backwards. And the failure mode is nasty: **no exception, no error, just the work that happens after the response quietly not happening**. Flip a service that does fire-and-forget background work to `true` and the work disappears without a trace in the logs.

So we reduced the decision to one question: does this service keep working after it returns a response?

### The exclusion list is narrower than it looks

When we picked which services to switch, we started with a generous exclusion list of anything that "probably needs CPU all the time." Most of it turned out not to. Two things about Cloud Run's behavior are not obvious.

First, **CPU is allocated during container startup regardless of this setting**. A service that loads a large dataset from BigQuery at boot, synchronously, before the web server starts, looks like an obvious "needs constant CPU" case. But that work happens during startup, so switching it is fine.

Second, **long timeouts are not a reason to exclude something**. A batch that takes 3,600 seconds of synchronous work is handling a request that entire time, so it has CPU. "It's a heavy job, so it needs constant CPU" doesn't hold.

What actually needs excluding is **services that keep working after the response goes out**, the fire-and-forget ones. That's the whole list. Getting there took several rewrites of the exclusion set.

Settings like this always over-exclude when you decide by intuition. **Exclude based on a condition you can state, not on a service feeling like it needs it.** Whether you can compress the rule into one line is a decent proxy for whether you've understood it.

### Results, and stopping the regression

The first service we switched came down **44% on its own**. Rolling it out brought **instance-based billing down 84%** overall. Everything is switched except the handful of services doing fire-and-forget work.

Then we added a CI guard that fails on service definitions with no `cpuIdle`. The part I like: **specifying `cpuIdle: false` explicitly is also a violation.** If a service genuinely needs constant CPU, it goes in an allowlist with a written reason. The point is to make someone type out why.

And with guards like this, we now **write a violation on purpose and confirm the build actually fails**. A guard that's been written isn't necessarily a guard that runs, and there's nothing to tell you when it isn't. All you're left with is the belief that you're covered, which is worse than knowing you aren't.

## Case 2: the data can't tell you how recovery actually works

Container image storage was the other large line item. The fix was trivial: **we went from keeping 10 image versions to keeping 2**. Storage dropped 65%.

The interesting part is how you get to that number. From the data alone, all you can say is "maybe we need 10." How far back you might roll to isn't something the data records.

Here's the actual reasoning. **If the image is gone, you restore the code from git and deploy it again.** So keeping images isn't an archive that lets you return to any point in history. It's a way to get back to the previous version quickly in an emergency. Framed that way, two is enough.

What's doing the work there isn't data, it's knowing **how recovery actually happens in your organization**. Whether restoring from git is a safe assumption. How long a deploy takes. Whether anyone has ever needed to go further back than one version in an emergency. **None of that is in your logs or your metrics.**

Ask an AI to look into it and you'll usually get "keep more versions, to be safe," because that's what the data supports on its own. What a human brings is knowing what the retention is *for*.

## Case 3: we were running full CI for every review round

The CI change that mattered most was about **when** things run, not what.

A reviewer flags something, you push a fix, they look again. **Every one of those pushes ran the full set of jobs**: build, lint, test, and knip.

The structure is the same with human reviewers. It's just that AI review makes the rounds more frequent and much faster, so waste that was always there becomes obvious. Measured, we average 3.4 rounds per PR (counting a round as one flag-and-fix cycle), with 6.8 minutes of heavy jobs per round. Which means running the same test suite three or four times before review even converged. **We were paying for a full test run against code that still had open comments on it.**

So we moved the heavy jobs behind review approval. Every push runs a lightweight check set (1.2 minutes), and when the reviewer approves, a bot triggers the heavy CI.

Light checks per round, heavy jobs once at the end. `3.4 × 6.8 min` becomes `3.4 × 1.2 min + 6.8 min`, roughly **53% less**.

### Skipping and not-running are not the same thing

There's an implementation trap here. Our first attempt used `if:` conditions to skip jobs inside the same workflow, and that was **the wrong design**.

| State | Branch protection treats it as |
| --- | --- |
| Job skipped via `if:` | **Passing** |
| Workflow never runs (no check exists) | **Not reported, blocks the merge** |

Skip a required check and you've effectively disabled branch protection. The green check appears without the tests having run, and the PR is mergeable. That fails open.

Never start the workflow and no check is created, so the unreported required check blocks the merge. That fails closed.

**That asymmetry is the whole design.** The heavy jobs now live in a separate workflow triggered only by `workflow_dispatch`. If the dispatch fails, the checks stay unreported and the merge stays blocked.

The cost optimization and the safety net came out of the same decision. "Spend less" and "stop when something's wrong" tend to share a shape.

### Also: deciding not to do something, with arithmetic

We also skip the heavy jobs on PRs that only touch documentation. The design question there was whether to split the docs-only detection into its own job.

A dedicated job is structurally cleaner, but **every PR then pays for one more runner start, about 25 seconds**. Docs-only PRs are around 4% of recent merges, and they save roughly 300 seconds of heavy jobs each.

Run the expected value: 96% of PRs paying 25 seconds outweighs 4% of PRs saving 300. So the detection happens inside an existing job and we skipped the dedicated one.

"Make the structure cleaner" always sounds right. In a cost context, **you can decide against it with arithmetic**. Go by which version feels more elegant and you'll miss reversals like this one.

## Case 4: it looks free at first, then the data grows

One more: **BigQuery MERGE**.

When you want to insert data without creating duplicates, MERGE is the obvious choice. Match on a key, update if it's there, insert if it isn't. One statement, and it's idempotent.

The catch is that **MERGE reads the target every time, no matter how many rows you're inserting**. Even for a single row, it has to scan the target side to confirm that row isn't already there.

That's awkward from a cost perspective. **While the table is small, it looks like nothing.** Nothing is wrong on the day you write it. But as the data accumulates, the scan per run grows with it. Your execution frequency hasn't changed, and the cost climbs anyway.

And because nobody edited any code, **this never shows up in PR review**. A gate at merge time asks "how much does this change add," so anything that grows without being changed is out of scope by construction. This is the purest version of what I described at the top: invisible on the day you build it, accumulating quietly afterward.

### Where the duplicate check should live

So we moved the duplicate check to **Firestore, and BigQuery only gets the insert**.

Look the key up in Firestore, and only insert the rows that come back as new. BigQuery becomes append-only, and the scan for reconciliation goes away entirely.

Same shape as Case 2. Not "how do we optimize the MERGE" but **does BigQuery need to be the thing doing the duplicate check at all**. BigQuery is excellent at scanning large volumes and aggregating. Asking it to confirm whether one key exists is using it against the grain. Firestore is the opposite: point lookups are its job, aggregation isn't. **Push each to the side it's good at and both end up doing something natural.**

### Why you need something that notices

The point here isn't "don't use MERGE." It has its place, and we haven't replaced all of ours.

The point is that **cost grows in two different ways: expensive from day one, and expensive after it grows into it**. The first kind, review catches. The second kind, review never sees.

Which is what the daily reporting is for. Comparing against the same weekday last week, "this app's cost keeps climbing and nobody has touched it" eventually shows up on its own. That's the reason a gate alone isn't enough.

## What the freed-up time is actually for

- When implementation gets cheap, the gate that slow implementation used to provide comes off with it
- What's left is the running cost of everything you shipped, which is invisible on the day you ship it
- And it grows in two ways: **expensive from day one**, and **expensive once the data grows into it**. Review only ever catches the first kind
- **So the time you gained goes into asking whether it should exist**
- Habits erode, so make it structural: a gate at merge, daily reporting, quotas on usage-based services, guards in CI
- And accept that some calls can't be automated: how recovery works, how far back you'd roll, whether this thing needs to exist at all
- Push what can be systematized into systems, and spend human attention on what can't. That's what reallocating the time means

Shipping faster is unambiguously good. But spend all of the gains on shipping more and the weight of what you shipped catches up with you later. We put a week into this cleanup. The next move isn't to schedule another one, it's to build more of the machinery that keeps things from piling up in the first place.
