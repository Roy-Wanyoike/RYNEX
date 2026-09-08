# RYNEX Roadmap

> **The trust and intelligence infrastructure for mobility.**
> Principle: *Don't ask buyers to trust the seller. Give buyers evidence.*

This roadmap is sequenced against the product spec (`CarTrust Kenya — Vehicle Commerce &
Trust Infrastructure`, sections referenced as `Spec §N`). The companion audit of what is
actually built lives in [FEATURES.md](FEATURES.md) — read them together.

Sequencing logic: **evidence infrastructure before intelligence**. A valuation model or
fraud engine is only as good as the provenance graph underneath it, so the roadmap
builds identity → provenance → verification → transactions first, and AI on top.

---

## Now — this sprint

**Goal:** turn the legacy marketplace into a hardened RYNEX foundation, and stand up
every platform domain as a real module behind the versioned gateway — so all 10 products
exist as code, not as slideware.

### Shipped

| Deliverable | What landed | Spec |
|---|---|---|
| Hardened marketplace core | `/auth/register`, `/auth/login` (bcrypt, JWT 1h), `/products` CRUD + soft delete (admin-gated), `/cart` with server-side price resolution, `/users` (admin only); `verifyToken` + `requireAdmin` middleware chain; Joi validation; central error handler; `{ success, message, data }` envelopes | Spec §30, §49 (partial) |
| Trust module | Seller profiles, trust score, ratings, leaderboard | Spec §20 (partial), §45, §46 (partial) |
| Passport module | Vehicle identity + provenance event timeline (append-only events) | Spec §14, §15, §16 (partial) |
| Intelligence module | Market overview, brand stats, heuristic valuation | Spec §27 (partial) |
| Parts module | Parts catalogue, vehicle compatibility, stock | Spec §36, §37 (partial) |
| Service module | Service bookings + status state machine | Spec §43 (partial) |
| Fleet module | Fleets + vehicle assignment | Spec §51 (partial) |
| Finance module | Transactions + escrow state machine + payment webhook stub | Spec §33, §34 (partial), §35 (partial) |
| Data module | Append-only audit log + helper for platform events | Spec §70 (partial) |
| API gateway | `/api/v1` mounted in `services/vehicles-api/src/server.ts`; module self-registration registry in `Router/modules.ts`; module SQL slots in `database/extensions/` + `master.sql` | Spec §78 (partial) |
| CI | GitHub Actions: type-check + build both services, compile web app, secret scan; issue/PR templates | Spec §76 (partial) |
| Docs | Vision, architecture, roadmap, features audit, research, AI strategy | — |

### PRs landing this sprint (parallel, merged into `main`)

| PR | Scope |
|---|---|
| `feat/trust*` | Trust: seller profiles, trust score, ratings, leaderboard |
| `feat/passport*` | Passport: vehicle identity + provenance event timeline |
| `feat/intelligence*` | Intelligence: market overview, brand stats, heuristic valuation |
| `feat/parts*` | Parts: catalogue, compatibility, stock |
| `feat/service*` | Service: bookings + status state machine |
| `feat/fleet*` | Fleet: fleets + vehicle assignment |
| `feat/finance*` | Finance: transactions + escrow state machine + webhook stub |
| `feat/data*` | Data: append-only audit log + helper |
| CI / hardening PRs | Marketplace security fixes (auth bypass, plaintext-password endpoint removal, admin guards, 1h JWT expiry, server-side pricing), CI workflow, templates |
| `docs/*` | Vision, architecture, research, AI strategy, roadmap + features audit (this PR, `Refs #3`) |

### Success metrics (exit criteria for Now)

- All 8 module routers mounted under `/api/v1/*` and green in CI (`tsc --noEmit` + build).
- Every marketplace mutation writes an audit-log row via the Data helper.
- Zero known critical security regressions (auth failures never fall through; prices never client-trusted).
- A new engineer can bootstrap DB + API + worker + web from the README in under 15 minutes.

---

## Next — 1–2 quarters

**Goal:** make the evidence loop real end-to-end. A buyer should be able to reserve a
vehicle, have it inspected by a real person, pay through a protected rail, and get the
ownership transfer tracked — all evidenced in the Passport.

| # | Capability | What it means | Spec |
|---|---|---|---|
| 1 | **Protected transactions end-to-end (M-Pesa Daraja)** | STK Push through the Finance payment abstraction; authenticated, idempotent, replay-safe, logged, reconciled callbacks; real escrow state-machine transitions (`PAYMENT_PENDING → PAYMENT_SECURED → …`) wired to audit events. Licensed payment/escrow partner structure — no unlicensed fund holding. | §33, §34, §35 |
| 2 | **Inspection platform & inspector network** | Inspection workflow (`Assigned → Accepted → At Location → … → Published`), Kenyan checklist (16 zones), evidence upload, inspector profiles with certification, service area, ratings, quality score, random quality audits. | §21, §22, §44 |
| 3 | **Seller verification with document checks** | Verification levels (identity, phone, business, physical location, vehicle ownership); logbook/import-document intake with OCR extraction clearly separated from authenticity verification. Never sell verification. | §20, §37 |
| 4 | **Search service** | OpenSearch (or equivalent) indexed off the marketplace + module data: make/model/year/price/mileage/fuel/location filters plus verification status, inspection status, trust score; natural-language query v0 mapping to structured filters. | §7 |
| 5 | **Notification fan-out** | Event-driven email/SMS/in-app dispatch from platform events (inspection booked/completed, payment secured, transfer completed, price changed); consent + preference management; builds on the existing cron worker. | §48 |
| 6 | **Dealer OS v1** | Dealer dashboard: inventory import (CSV/API), listing management, inspection scheduling, leads/customers tracking; dealer onboarding flows with verification gating. | §41, §42 (partial) |
| 7 | **Web app SPA rebuild** | Replace the vanilla multi-page frontend with a typed SPA (Next.js per spec) consuming `/api/v1`; buyer marketplace, vehicle details, Passport timeline UI, transaction dashboard, admin console; mobile-first, low-bandwidth friendly. | §53, §54, §55, §62 |

### Success metrics (Next)

- First end-to-end protected transaction completed in staging: reserve → inspect → pay (M-Pesa sandbox) → transfer tracked → settle, with a full audit trail.
- ≥ 60% of new listings have a verified seller; median inspection publish time < 72h.
- Search p95 < 300ms on 10k listings; zero cross-tenant/state leakage in the new lifecycle states.
- Notification delivery success > 98% with opt-out respected.
- SPA reaches feature parity with the legacy pages and ships the Passport timeline.

---

## Later — 2–4 quarters

**Goal:** convert accumulated evidence into intelligence and open the platform to
partners — the start of the data moat (Spec §81).

| # | Capability | What it means | Spec |
|---|---|---|---|
| 1 | **AI valuation models on the provenance graph** | Train price/valuation models on the immutable provenance + transaction history Passport modules accumulate; market ranges (low/typical/high) per model/trim/year/mileage; never present estimates as guaranteed values. | §16, §27, §59 |
| 2 | **Fraud & risk engine** | Multi-signal risk scoring (seller identity, device/IP, listing behaviour, price, payment destination, duplicates) with LOW/MEDIUM/HIGH/CRITICAL output and explained reasons; fraud intelligence graph linking sellers ↔ phones ↔ devices ↔ listings ↔ payment destinations; mileage anomaly detection ("ANOMALY DETECTED", never auto-accusation). | §24, §19, §64 |
| 3 | **AI Scam Shield** | User-submitted listing/screenshot/conversation analysis producing risk level + reasons + evidence + recommended next step; scam-warning UX with clear evidence/signal/inference/recommendation separation. | §25, §56 |
| 4 | **Open partner APIs + developer portal** | Versioned vehicle data APIs (identity, passport, history, risk, pricing, inspection, trust, parts compatibility) with API keys/OAuth and scoped permissions for banks, insurers, fleets, partner dealerships; developer portal + published OpenAPI. | §42, §58, §79 |
| 5 | **Multi-country (Uganda / Tanzania / Rwanda)** | Country adapter architecture (`VehicleRegistryAdapter`, `PaymentAdapter`, `OwnershipTransferAdapter`, `ComplianceAdapter`) — Kenya as the first implementation, expansion without premature regulatory generalization. | §82 |
| 6 | **Multi-tenancy** | Organization/tenant isolation for dealerships across API, service, repository, database, authorization, jobs, events and search indexing; explicit cross-tenant leakage tests. | §13 |

### Success metrics (Later)

- Valuation error (MAPE) beats naive baseline by ≥ 20% on held-out transactions.
- Fraud engine catches ≥ 80% of seeded fraud scenarios with < 5% false-positive rate on good sellers.
- 3 external partner integrations live against the open APIs.
- Second country live end-to-end (listing → transaction) behind the adapter layer.

---

## Beyond — 1 year+

**Goal:** RYNEX as cross-industry **trust rails**: the identity → provenance → evidence →
transaction stack generalized beyond vehicles to any asset class where provenance is the
product — equipment, property, machinery.

- The Passport + provenance graph + evidence vault pattern is asset-agnostic; vehicles are the wedge, not the ceiling.
- Trust flywheel: more vehicles → more history → better AI → better fraud detection → more trust → more transactions → more data (Spec §72–73).
- QR identity / public passport pages make every credentialed asset scannable in the physical world (Spec §62, §63).
- Marketplace recommendations, buying assistant, EV platform (battery health score, charging intelligence, EV TCO), total-cost-of-ownership scoring, digital twins and the automotive knowledge graph ride on the same rails (Spec §28, §49, §50, §56–57 file 2).

### Success metrics (Beyond)

- One non-vehicle asset class onboarded end-to-end on the same rails with no core schema fork.
- Partner/developer ecosystem generating a meaningful share of API calls.
- Platform is the default answer to "can I trust this used asset?" in its launch market.

---

## Sequencing rule of thumb

```
Identity → Provenance → Verification → Protected transaction → Intelligence → Openness
   (Now)      (Now)         (Next)            (Next)               (Later)      (Later)
```

Anything that would manufacture trust before it can be evidenced (paid badges, fake
verification, unverified reviews merged into scores) is explicitly out of scope — see
Spec §67 ("No Fake Verification") and FEATURES.md.
