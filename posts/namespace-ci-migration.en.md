---
title: "GitHub Actions Getting Expensive? We Cut CI Costs to a Quarter With a One-Line Change"
publishedAt: "2026-07-28T08:30:00+09:00"
updatedAt: "2026-07-28T08:30:00+09:00"
slug: "namespace-ci-migration"
summary: "AI-driven development inflates CI cost on two axes at once: more runs, and more tasks you now want CI to do. We migrated our GitHub Actions runners twice, from GitHub-hosted to Blacksmith to Namespace, and measured everything along the way. Per-run CI cost dropped to roughly a quarter, p90 came down 37%, and silent never-finishing runs went from 32 to zero. Failure story included: we skipped estimating peak concurrency and had to roll back in two days."
emoji: "💸"
tags:
  - "ci"
  - "githubactions"
  - "namespace"
  - "devops"
lang: "en"
syndication:
  devto:
    id: 4158688
    slug: "github-actions-getting-expensive-we-cut-ci-costs-to-a-quarter-with-a-one-line-change-16ac-temp-slug-1285806"
    contentHash: "4cb4c921ccdce01b"
    publishAt: "2026-07-28T08:30:00+09:00"
cover: /images/posts/namespace-ci-migration.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset.

We've migrated our GitHub Actions runners twice: **GitHub-hosted to Blacksmith, then Blacksmith to Namespace**. The results, up front:

- Per-run CI cost is roughly a quarter of what we paid on GitHub-hosted
- The slow tail (p90) is 37% shorter
- Runs that silently never finish went from 32 to zero
- Each migration was a one-line change

This post is the measured record: how we measured, what we found, and the one migration that failed. If you're deciding whether to move off GitHub-hosted runners, the numbers here should help.

## With AI in the loop, CI swells quietly

First, why this matters now. Once AI agents become the main driver of development, CI cost grows on two axes at the same time.

The first axis is **run count**. Agents open PRs and push fixes faster than humans do, so the number of pushes climbs. In our environment, a single test workflow runs **3,000 to 3,500 times a month**. Reviews are done by AI too, and every fix push triggers CI again, so this number only grows as development accelerates.

The second axis is **task count**. When development gets faster, you start wanting CI to do all the things that never used to be worth the cost. Another lint layer, stricter coverage gates, docs consistency checks. Each run gets longer.

It's run count multiplied by task count. Leave it unattended and the bill grows quietly, but steadily.

## First things first: if you fit in the free tier, stay put

Let me state the opposite conclusion before anything else: **if you fit inside the free tier, there is no reason to migrate**. Public repositories get standard runners for free, and private ones come with 2,000 minutes a month on the Free plan and 3,000 on Team.

In fact, across airCloset, some repositories are still on GitHub-hosted runners today. Anything that fits inside the 3,000 free minutes stays where it is. There is no reason to move something that runs for free onto something you pay for.

This post is for teams that blew past the free tier a long time ago and are watching the bill climb every month.

## The migration path

Here's the road we took.

| Period | Runner | Trigger |
| --- | --- | --- |
| Until late March | GitHub-hosted (2-core) | -- |
| Late March to June | Blacksmith (4 vCPU) | Speed and cost |
| Late June to now | Namespace (4 vCPU/8GB) | Speed, cost, and the hang problem below |

Along the way we also evaluated **self-hosting on AWS spot instances, and decided against it because every job would pay the instance startup overhead**. CI is a world where boot latency compounds, so always-pooled runners win.

Each migration is literally a one-line change to `runs-on`:

```diff
 jobs:
   test:
-    runs-on: ubuntu-latest
+    runs-on: nscloud-ubuntu-24.04-amd64-4x8
```

The rest is a one-time GitHub App connection in the provider's console, and the whole edit takes a few minutes. Standard features like `actions/cache` keep working as-is. With migration cost this close to zero, the decision comes down to measurements.

## Migration 1: GitHub-hosted to Blacksmith

The motivation was simple: speed and cost. We compared successful runs of the same test workflow in the two weeks on either side of the migration, a window where **the workflow content was identical**, using run history from the GitHub API. Note that run counts were far lower back then, which is why the sample sizes look modest.

| | Median | p90 | n |
| --- | --- | --- | --- |
| GitHub-hosted (2-core) | 340s | 598s | 237 |
| Blacksmith (4 vCPU) | **139s (-59%)** | **157s (-74%)** | 130 |

To be clear about what this is: it is not "Blacksmith is 2.4x faster at the same size." We doubled the machine, from 2-core to 4 vCPU.

The real point is the unit price. GitHub-hosted 2-core costs $0.006/min, and the 4-core larger runner costs $0.012/min. Blacksmith charges $0.004/min for 2 vCPU and $0.008/min for 4 vCPU. In other words, **for 1.33x what GitHub charges for 2 cores, you rent twice the machine**. Run time shrank to 41%, so per-run cost worked out to roughly **45% less** (1.33x price times 0.41x time), while runs got 2.4x faster. Faster and cheaper. "The same money buys twice the machine" is the actual nature of this kind of migration.

## The snag with Blacksmith: flaky install hangs

Blacksmith earned its keep at that price, but one problem in daily operation was impossible to ignore: **dependency installation (the npm install step) would occasionally hang in silence, and CI would never finish**.

We never pinned down a reproduction; it was flaky. GitHub Actions jobs default to a 6-hour timeout, so left alone, a hung run keeps billing and occupying a runner for 6 hours. For a while, people noticed stuck runs, cancelled them by hand, and re-ran them, and that happened a lot. We then tightened the timeout to 30 minutes, and even after that, **32 runs died at the timeout without anyone noticing, over about two and a half months**. Manual cancels aren't in that count, so 32 is a floor. In our first three weeks on Namespace: **zero**.

The raw number may look small. But when this lands in the middle of an autonomous agent loop, a silent stall becomes a stall of the whole loop. A human notices "huh, CI is stuck," cancels, and re-runs. An agent loop needs detection and retry machinery built separately, and that quietly piled up operational cost.

One note in fairness: this is what we observed during our usage window, March through June of this year. It may well be improved by now, and I can't guarantee it reproduces elsewhere.

## Migration 2: Blacksmith to Namespace, including the failure

The motivation was again speed and cost, plus the hang problem above. But this migration **failed once, and we rolled it back**. The failure seems worth sharing as-is, so here is what happened.

### We didn't estimate our concurrency

Namespace's plans cap **concurrent capacity, counted in vCPUs**. The Developer plan (the cheapest, with a free trial) allows 32 vCPUs on Linux. With 4 vCPU/8GB machines, that's **8 machines at a time**.

Because AI agents develop in parallel, our CI concurrency is high, and peaks blow well past 8 machines. From day one of the migration, runs piled up in the queue and CI clogged. **We rolled back to Blacksmith after two days**, upgraded to the Business plan (160 vCPUs, or 40 machines), re-migrated, and it has been stable since.

The lesson is simple: **measure your repository's peak concurrency before you switch**. Pull run history from the GitHub API and the peak number of simultaneously running jobs falls out mechanically. Pick a plan on price and speed alone and you'll take the same detour we did.

### Measured: the median shrank, and the tail shrank more

Amusingly, the rollback handed us a **clean controlled experiment**. The two rollback days and the five days right after re-migration ran exactly the same workflow content, so the runner is the only variable.

| | Median | p90 | n |
| --- | --- | --- | --- |
| Blacksmith (4 vCPU, rollback window) | 378s | 839s | 335 |
| Namespace (4 vCPU/8GB) | **339s (-10%)** | **526s (-37%)** | 311 |

The median improved by about 10%, but the bigger story is the **tail**. p90 dropped from 839s to 526s, 37% shorter, and the hangs went to zero. "Occasionally slow, occasionally stuck" simply disappeared, and for agent-loop operation that is worth more than a median improvement, because the duration of a loop iteration is set by its slowest link.

## The cost math

Published unit prices (Linux x64, as of July 2026):

| Runner | Size | Price/min |
| --- | --- | --- |
| GitHub-hosted standard | 2-core | $0.006 |
| GitHub larger runner | 4-core | $0.012 |
| Blacksmith | 2 vCPU | $0.004 |
| Blacksmith | 4 vCPU | $0.008 |
| Namespace | 4 vCPU/8GB | **$0.004** (prepaid) |

A 4 vCPU Namespace machine costs **less per minute than GitHub's 2-core**. That's the single biggest lever. Normalize per run with the measured times, and GitHub-hosted to Blacksmith cut about 45%, Blacksmith to Namespace roughly halved it again. **In total, about a quarter of the GitHub-hosted era.**

Three caveats.

1. **Namespace has a plan fee**: $100/month on Team, $250/month on Business, each with the same amount of usage included. And if you fit in the free tier, GitHub Actions costs zero. No unit price beats free. That's why the earlier "stay put" advice comes first.
2. **$0.004/min is the prepaid rate** (the usage included in your plan). Overage runs at $0.006/min, which is the same as GitHub's 2-core. The assumption is that you pick a plan your usage fits inside.
3. Prices change. These are published rates at the time of writing, so check the pricing pages ([GitHub](https://docs.github.com/en/billing/reference/actions-runner-pricing) / [Blacksmith](https://www.blacksmith.sh/pricing) / [Namespace](https://namespace.so/pricing)) when you decide.

## Which tier are you in?

Three stages, by scale.

- **You fit in the free tier**: stay on GitHub-hosted. Do nothing
- **You're past the free tier and the bill is starting to sting**: Blacksmith or Namespace, either way a one-line `runs-on` change buys twice the machine for the same money. Blacksmith has 3,000 free minutes a month and Namespace has a 30-day trial, so trying costs nothing
- **AI agents are your main developers and CI concurrency is high**: choose on tail latency and stability, and **estimate peak concurrency before you migrate**

## Wrap-up

- With AI-driven development, CI cost grows as run count times task count
- GitHub-hosted to Blacksmith: 1.33x the unit price for twice the machine, 59% faster runs, about 45% cheaper per run
- Blacksmith to Namespace: median -10%, p90 -37%, hangs from 32 to zero, at half the unit price
- Namespace caps concurrency by plan. **Estimate your peak concurrency before switching**
- If you fit in the free tier, don't migrate. If you're past it, start with one line of `runs-on`

If your GitHub Actions bill keeps growing, Namespace is a choice I can recommend with measurements behind it. I hope the numbers help you make your own call.
