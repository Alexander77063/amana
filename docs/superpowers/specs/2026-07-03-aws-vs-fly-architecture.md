# Hosting Architecture — AWS vs Fly.io (Well-Architected comparison)

**Status:** ✅ **DECIDED (2026-07-03): stay on Fly.io** — cost-rational at current scale; revisit
AWS (Candidate A) when a compliance/enterprise or scale forcing-function appears. **Proceeding with
the cloud-readiness refactor anyway** (portable hygiene that also keeps Candidate A low-friction).
No AWS IaC/spend.
**Date:** 2026-07-03
**Owner:** Alex
**Scope:** Where to run the Amana backend + cron + Postgres. Mobile (EAS) and media (S3 `af-south-1`) are unaffected.

## Workload shape (from the repo)

- **Backend:** Hono on Node 20, **containerized** (`apps/backend/Dockerfile`), stateless HTTP on :3000, `/health` checked. Postgres via `postgres-js` (a **long-lived pooled connection** — matters for the serverless option).
- **Cron:** a **separate always-on process** (`node dist/cron.js`) — recon sweep (5 min) + bump-TTL sweep (1 min). Not spiky; a scheduled/always-on worker.
- **Data:** **Postgres 16 + PostGIS** (geolocation on transactions). Small today (256MB VMs).
- **Traffic:** steady, latency-sensitive payments API + Anchor webhooks (inbound-credit, transfer settle/fail). Not spiky/scale-to-zero-shaped.
- **Today:** Fly.io app `amana-api`, region **`jnb`** (Johannesburg), two process groups (`app` auto-stop/start min 1, `cron` always-on), migrations via Fly `release_command`. Sentry + Pino wired.

**Region reality:** the only AWS region in Africa is **`af-south-1` (Cape Town)** — Cape Town↔Lagos is ~4,500 km, so AWS-in-Africa latency to Lagos is *worse* than a Lagos-proximate provider, and comparable-ish to Fly `jnb`. Anywhere else (Ireland/Paris) is much farther. **Any AWS option must run in `af-south-1`**, which constrains the service menu (see Candidate B).

---

## Candidates

### Baseline — **Stay on Fly.io** (the honest do-nothing)
- **Topology:** current setup — 2 process groups, Fly Postgres (or managed PG), `jnb`.
- **Pillars:** Op-Ex ✓ (deploy is one command, release_command migrations) · Security △ (Fly secrets, TLS; less granular than IAM/KMS) · Reliability △ (single-region, Fly Postgres HA is add-on; no formal Multi-AZ) · Perf ✓ (jnb ~ af-south-1 for Lagos) · **Cost ✓✓ (cheapest — ~$20–40/mo at this size)** · Sustainability ✓ (auto-stop).
- **Best when:** cost-sensitive, small scale, small team, no hard compliance/ecosystem driver.

### Candidate A — **ECS Fargate + ALB + RDS Postgres (Multi-AZ)**  ← recommended *if* moving to AWS
- **Topology:** ALB → **Fargate** service (the existing Docker image, arm64/Graviton) in private subnets across 2 AZs; cron as a **scheduled Fargate task** (EventBridge Scheduler) or a 2nd small always-on task; **RDS PostgreSQL Multi-AZ** (PostGIS supported) in private subnets; NAT for egress; ECR, Secrets Manager, KMS, CloudWatch.
- **Pillars:** Op-Ex ✓ (IaC + CI/CD, near-parity with current containers) · **Security ✓✓** (private subnets, least-priv IAM, Secrets Manager, KMS, WAF on ALB) · **Reliability ✓✓** (Multi-AZ RDS + Fargate auto-heal/scale) · Perf ✓ (RDS Proxy for pooling) · **Cost △ (~$90–130/mo** — ALB ~$18, NAT ~$32, RDS Multi-AZ t4g.micro×2 ~$30–40, Fargate ~$15–25) · Sustainability ✓ (Graviton, scheduled cron).
- **Migration effort: LOW** — reuse the Dockerfile; swap Fly release_command for an ECS one-off migrate task; re-wire secrets. **No app rewrite.**
- **Best when:** you want AWS's security/reliability/ecosystem with minimal code change and PostGIS on managed RDS.

### Candidate B — **AWS App Runner + RDS** — ⚠️ disqualified by region
- App Runner would be the simplest managed-container option, **but App Runner is NOT available in `af-south-1`** — running it in Ireland/Paris would add major Lagos latency. **Excluded** unless you accept non-African hosting. (Verify at build time; region list changes.)

### Candidate C — **Lambda + API Gateway + RDS Proxy + Aurora Serverless v2**
- **Topology:** API Gateway → **Lambda** (Hono via `@hono/aws-lambda`) for web; EventBridge Scheduler → Lambda for cron; **RDS Proxy** → **Aurora Serverless v2 (PostgreSQL, PostGIS)**; S3, Secrets Manager, KMS. Lambda-in-VPC → NAT or VPC endpoints.
- **Pillars:** Op-Ex ✓ (fully managed) · Security ✓✓ · Reliability ✓✓ (managed Multi-AZ) · **Perf △ (cold starts** on a latency-sensitive payments path + webhook handlers; RDS Proxy needed because Lambda × `postgres-js` pooling doesn't fit) · **Cost △ (~$60–95/mo** — Aurora Serverless v2 **min 0.5 ACU floor ~$43**, RDS Proxy ~$15, NAT ~$32; compute itself ~$0–5) · **Sustainability ✓✓** (scale-to-zero compute).
- **Migration effort: MEDIUM–HIGH** — wrap Hono in a Lambda handler, rethink DB connection management (RDS Proxy), split cron to scheduled Lambdas. This is where a **"cloud-readiness refactor" is mandatory**, not optional.
- **Best when:** traffic is genuinely spiky/low and you value scale-to-zero + minimal ops over steady-state latency, and you'll do the serverless refactor.

---

## Scorecard (1–5; higher better)

| Pillar | Fly.io (stay) | A · Fargate+RDS | C · Lambda+Aurora |
|---|:--:|:--:|:--:|
| Operational Excellence | 4 | 4 | 4 |
| Security | 3 | 5 | 5 |
| Reliability | 3 | 5 | 5 |
| Performance (Lagos) | 4 | 4 | 3 (cold starts) |
| **Cost (at current scale)** | **5** | **3** | **3** |
| Sustainability | 4 | 4 | 5 |
| **Migration effort (5 = none)** | **5** | **4 (low)** | **2 (rewrite)** |

## Recommendation

**Two defensible calls, and I want your pick (the hard gate):**

1. **If the driver is cost + speed at current scale → stay on Fly.io.** AWS is **~2–4× the monthly cost** here (ALB + NAT + Multi-AZ/Aurora floors dominate at small size), for reliability/security you may not yet need. This is consistent with the ₦-level cost discipline in `PRICING.md`.
2. **If the driver is production-grade reliability/security, ecosystem, and headroom for scale (or a compliance/enterprise requirement) → Candidate A (ECS Fargate + RDS Multi-AZ).** It's the AWS option with the **lowest migration cost** (reuse the container, no app rewrite), PostGIS on managed RDS, Multi-AZ, and it runs in `af-south-1`. **Do not pick Candidate C** unless you specifically want serverless/scale-to-zero and will fund the refactor — the cold-start + connection-pooling + rewrite costs aren't justified by this steady workload.

**My lean:** given the workload is steady (not spiky), PostGIS is required, and cost matters — **Candidate A is the right AWS target**, but the genuine question is *whether the AWS premium buys you enough over Fly.io right now*. If there's no compliance/enterprise forcing function and scale is still early, **staying on Fly.io and revisiting at scale is the cost-rational choice.**

## Caveats / confidence
- **Costs are estimates** (~order-of-magnitude, `af-south-1` on-demand) — verify with the AWS Pricing Calculator before any commitment; NAT Gateway (~$32/mo + data) and the Aurora/RDS-Multi-AZ floors are the swing items and often surprise.
- **Region availability** (App Runner absence in `af-south-1`, Aurora Serverless v2 presence) should be re-verified at build time.
- PostGIS is supported on both RDS PostgreSQL and Aurora PostgreSQL.
- No cloud spend implied by this doc — **Phase 3 (Terraform + cost estimate) and any `apply` are separate, gated steps** after you choose.

## If you pick an AWS candidate, the next `/ship` phases are
1. **Cloud-readiness refactor** (your chosen scope): 12-factor config, graceful shutdown/SIGTERM handling, health/readiness split, statelessness check, container hardening — the app-side prep. (For Candidate C, also the Lambda handler + RDS Proxy connection rework.)
2. **Phase 3 IaC** (Terraform, `af-south-1`): VPC (2 AZs, private app tier), the chosen compute, RDS, Secrets Manager/KMS, ECR, CI/CD deploy — with `terraform plan` + a real cost estimate presented for approval before `apply`.
