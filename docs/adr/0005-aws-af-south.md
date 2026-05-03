# 5. AWS af-south (Cape Town) for initial hosting

Date: 2026-05-03
Status: Accepted (with parallel legal-review track)

## Context

We need low-latency hosting for Lagos users and storage that satisfies CBN
expectations on financial-data residency. CBN's stance on data residency for
non-bank fintechs is evolving; we need to start somewhere defensible without
blocking on legal certainty.

## Decision

Initial hosting on AWS af-south-1 (Cape Town) — the closest AWS region to
Lagos with full service support. Backend runs on ECS Fargate; database on
Aurora Postgres with PostGIS.

A parallel legal-review track confirms whether CBN requires Nigerian-resident
data for our specific BaaS-routed model. If yes, we migrate to a Nigerian
provider (e.g. Layer3, MainOne, Galaxy Backbone) before public launch.

## Alternatives considered

- **AWS eu-west-1 (Ireland).** Higher latency to Lagos (~120 ms vs ~80 ms).
  Likely worse data-residency posture too.
- **Local NG cloud (Layer3 / MainOne / Galaxy).** Best CBN posture, smaller
  managed-service surface, harder to hire ops talent for. Defaulting here
  too early would slow MVP.
- **Self-hosted on a Lagos colo.** Out of scope at our team size.

## Consequences

af-south is a real AWS region with most services we need (ECS, Aurora, S3,
CloudWatch, KMS, Secrets Manager). Cost: some newer AWS services lag in
af-south by months. Switch path to a Nigerian provider stays clean because
the backend uses standard SQL/Postgres and stateless container deploys.
