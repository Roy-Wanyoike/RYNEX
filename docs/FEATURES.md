# RYNEX Features Audit — shipped vs pending

> The honest map. Spec sections refer to the product spec (*CarTrust Kenya — Vehicle
> Commerce & Trust Infrastructure*, sections `Spec §N`). Statuses below are audited
> against the repository: `✅`/`🟡` claims were verified by reading the cited code on
> `main` (commit `b2dbcf2`) plus the sprint's parallel module PRs.

**Status legend**

| Symbol | Meaning |
|---|---|
| ✅ | **Shipped in repo** — code on `main`, verified by reading it |
| 🔵 | **Module shipped this sprint** — parallel PR landing now (Trust, Passport, Intelligence, Parts, Service, Fleet, Finance, Data); follows the `src/Modules/<Name>/` + `database/extensions/<name>.sql` convention in `Router/modules.ts` |
| 🟡 | **Designed, pending** — specified, with some groundwork/scaffold in the repo (schema slot, module hook, partial capability) |
| ⚪ | **Not started** — specified only; no code in the repo yet |

---

## 1. Vehicles — marketplace core

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Vehicle catalogue (public reads) | §30 | ✅ | `services/vehicles-api/src/Router/product.router.ts`, `Controller/products.ts` | `GET /products/getproducts`, by-bodyType, by-brand, by-id |
| Listing create / soft delete | §30, §31 | ✅ (partial) | `product.router.ts` (`POST ""`, `POST /softdeletecar/:carId`, admin-gated), `database/procedures_cars.sql` (`spAddCars`, `softDeleteProduct`) | Soft delete via `isDeleted` bit; write ops require `verifyToken` + `requireAdmin` |
| Listing lifecycle states (`DRAFT → PENDING_VERIFICATION → VERIFIED → PUBLISHED → …`) | §31 | ⚪ | — | Repo only has available/soft-deleted; state machine is the top lifecycle gap |
| Listing versioning (price/mileage/description change audit) | §32 | ⚪ | — | Data-module audit log (this sprint) is the natural substrate |
| Cart with server-side price resolution | §49 | ✅ | `Router/cartRouter.ts`, `Controller/cartController.ts`, `database/procedures_cart.sql` (`spAddToCart`) | Client sends only `{carId, quantity}`; brand/price derived in the SP; upsert on `(userId, carId)` |
| Admin cart overview | §69 | ✅ | `GET /cart/all` (admin), `spGetAllCart` | Legacy admin console covers orders/users/cars |
| Legacy order intake (`specCarOrders`) | §30 | 🟡 | `database/schema_tables.sql` (table `specCarOrders`) | Table + seed exist; no dedicated API flow yet |
| Vehicle comparison | §29 | ⚪ | — | Evidence-first comparison (trust, inspection, history) |
| Marketplace moderation | §68 | ⚪ | — | Admin tooling beyond CRUD needed before scale |
| Admin console (spec-grade) | §69 | 🟡 | `apps/web/src/Admin/` (addCars, addUser, order) | Legacy vanilla pages; rebuild part of the SPA sprint |

## 2. Vehicles — web storefront (legacy)

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Home / catalogue / cart / login / registration pages | §53 | ✅ (legacy) | `apps/web/src/{Home,cars,cart,login,registration}/` | Vanilla TS/JS, no framework |
| Shared API + UI helpers (envelope handling, toasts, 401 auto-logout) | §78 | ✅ | `apps/web/src/api/api.js`, `api/ui.js` | Contract header documents every endpoint; SPA rebuild will supersede |
| SPA rebuild (Next.js, mobile-first, Passport timeline UI) | §53, §54, §55, §62 | ⚪ | — | Roadmapped for **Next** |

## 3. Auth & identity

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Register / login (email + username) | §12 | ✅ | `Router/authRoute.ts`, `Controller/authController.ts` | bcrypt (cost 10) hashing; hashes never returned via API |
| JWT sessions | §12, §49 | ✅ | `authController.ts` (`jwt.sign … expiresIn: '1h'`), `Middlewares/verifyToken.ts` | 1h expiry; auth failures always terminate the response (bypass fixed) |
| Role-based access (admin) | §12 | ✅ (partial) | `Middlewares/requireAdmin.ts` chained in routers | `isAdmin` normalized to strict boolean; only user/admin roles exist |
| Full RBAC (10 spec roles) | §12 | ⚪ | — | buyer/private_seller/dealer_admin/inspector/… roles not yet modelled |
| Phone auth, MFA, device & session management, suspicious-login detection | §12 | ⚪ | — | |
| Multi-tenancy / organization isolation | §13 | ⚪ | — | Roadmapped for **Later** with explicit leakage tests |

## 4. Passport (vehicle identity & provenance)

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Vehicle identity (VIN/chassis/engine/reg) | §14 | 🔵 | Sprint Passport PR (`src/Modules/Passport/`, `database/extensions/passport.sql`) | Identity fields captured with the vehicle record |
| Identity confidence scoring | §14 | 🟡 | Passport module groundwork | Spec'd (e.g. 98/100); scoring not in module scope yet |
| Provenance event timeline | §16 | 🔵 | Sprint Passport PR | Append-only events; corrections create new events, no destructive edits |
| Passport assembly (identity + ownership + inspection + service + trust) | §15 | 🟡 | Passport module + Trust/Service modules | Timelines exist; VERIFIED/SELLER_DECLARED/… evidence-grade labelling pending |
| Vehicle QR identity | §62 | ⚪ | — | |
| Public (shareable) vehicle passport page | §63 | ⚪ | — | UX incl. timeline is designed in spec |

## 5. Trust (sellers, reviews, reputation)

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Seller profiles | §20 | 🔵 | Sprint Trust PR (`src/Modules/Trust/`, `database/extensions/trust.sql`) | Profile + verification fields |
| Trust score (heuristic) | §45 | 🔵 | Sprint Trust PR | Explainable component scores (seller/identity/ownership/…) are the follow-up |
| Ratings | §40, §45 | 🔵 | Sprint Trust PR | Verified-transaction-only weighting not yet enforced |
| Leaderboard | §45 | 🔵 | Sprint Trust PR | |
| Seller verification levels (identity/phone/business/location/ownership) | §20 | 🟡 | Trust module groundwork | Document-checked verification is a **Next** deliverable |
| Trust levels (`UNVERIFIED → PARTIALLY_VERIFIED → VERIFIED → HIGH_CONFIDENCE`) | §46 | 🟡 | Trust module groundwork | No "100% safe" language; no purchasable scores (spec §67) |
| Verified transaction reviews (separate from complaints) | §40 | 🟡 | Trust ratings groundwork | Verified/unverified/complaint separation pending |

## 6. Intelligence (pricing & market data)

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Market overview | §27 | 🔵 | Sprint Intelligence PR (`src/Modules/Intelligence/`, `database/extensions/intelligence.sql`) | |
| Brand stats | §27 | 🔵 | Sprint Intelligence PR | |
| Heuristic valuation | §27 | 🔵 | Sprint Intelligence PR | Estimates never presented as guaranteed values |
| Price intelligence (market ranges by year/mileage/trim/location/import) | §27 | 🟡 | Heuristic valuation groundwork | Full factor model + AI training on provenance is **Later** |
| TCO (1/3/5-year: fuel, insurance, maintenance, depreciation) | §50 | ⚪ | — | Major AI recommendation input |
| EV platform (battery health score, charging intelligence, EV passport) | §49 | ⚪ | — | |
| AI buying assistant (NL → inventory with exclusions explained) | §28 | ⚪ | — | |
| Recommendation engine + explanations | §60 (f2), §61 (f1) | ⚪ | — | Paid ads must never override trust ranking |

## 7. Finance (transactions & payments)

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Transactions | §33 | 🔵 | Sprint Finance PR (`src/Modules/Finance/`, `database/extensions/finance.sql`) | |
| Escrow / transaction state machine | §34 | 🔵 | Sprint Finance PR | Strongly-validated states incl. `CANCELLED`/`DISPUTED`; transitions audited |
| Payment webhook | §35 | 🔵 (stub) | Sprint Finance PR | Stub today; authenticated/idempotent/replay-safe handling is the M-Pesa work |
| M-Pesa Daraja integration (STK Push → callback → reconcile) | §35 | 🟡 | Finance payment abstraction groundwork | Top **Next** item; licensed partner structure, no unlicensed fund holding |
| Payment abstraction (bank, cards, partners) | §35 | 🟡 | Finance module groundwork | Callbacks must be authenticated, idempotent, replay-safe, logged, reconciled |
| Ownership transfer workflow | §36 | ⚪ | — | Lawful/authorized integrations only; never fabricate verification |
| Digital deal room (transaction workspace) | §43 (f2) | ⚪ | — | |
| Buyer protection (limits made explicit) | §47 | ⚪ | — | |
| Disputes (evidence-backed packages, human review) | §38 | ⚪ | — | Depends on evidence vault |

## 8. Parts

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Parts catalogue | §36 (f2) | 🔵 | Sprint Parts PR (`src/Modules/Parts/`, `database/extensions/parts.sql`) | Seller tiers (authorized distributor → unverified) spec'd for later |
| Compatibility engine (vehicle → part numbers/OEM/aftermarket) | §37 (f2) | 🔵 | Sprint Parts PR | Never claim compatibility without sufficient data |
| Stock management | §36 (f2) | 🔵 | Sprint Parts PR | |
| Parts price intelligence (OEM vs aftermarket ranges) | §38 (f2) | ⚪ | — | Flag suspiciously low prices, never auto-label counterfeit |
| Parts trust score / warranty network / parts passport | §39–41 (f2) | ⚪ | — | |

## 9. Service

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Service bookings + status state machine | §43 (f1) | 🔵 | Sprint Service PR (`src/Modules/Service/`, `database/extensions/service.sql`) | |
| Service history events feeding the Passport | §42 (f2), §18 (f1) | 🟡 | Service + Passport modules | Verified provider events appending to provenance pending |
| Garage marketplace (profiles, real availability, transparent quotes) | §32–34 (f2) | ⚪ | — | |
| Service centre platform (verified events, invoices, diagnostics) | §43 (f1), §54 (f2) | ⚪ | — | Providers can create events/corrections, never edit history |

## 10. Fleet

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Fleets + vehicle assignment | §51 (f2) | 🔵 | Sprint Fleet PR (`src/Modules/Fleet/`, `database/extensions/fleet.sql`) | |
| Drivers, maintenance, fuel, insurance, utilization, depreciation, AI fleet insights | §51 (f2) | ⚪ | — | |

## 11. Data (platform data infrastructure)

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Append-only audit log + helper | §70 (f1) | 🔵 | Sprint Data PR (`src/Modules/Data/`, `database/extensions/data.sql`) | Marketplace + module mutations feed this |
| Digital evidence vault (hash-chained immutable artifacts) | §39 (f1), §48 (f2) | ⚪ | — | Hash proves artifact unchanged, not document authenticity |
| Event bus / long-running workflows | §9–10 (f1) | ⚪ | — | |
| Object storage (signed URLs, malware scan) | §11 (f1) | ⚪ | — | |
| Analytics warehouse (ClickHouse: pricing, fraud, conversion) | §52 (f1), §12 (f2) | ⚪ | — | |

## 12. Inspections & inspector network

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Inspection platform (workflow + 16-zone checklist + evidence upload) | §21 | ⚪ | — | Top **Next** deliverable; unlocks verified listings |
| Inspector network (profiles, certification, quality score, audits) | §44 | ⚪ | — | |
| Live inspection (buyer-requested remote checks) | §22 | ⚪ | — | |
| AI vehicle inspection (OCR, repaint/damage detection, confidence output) | §23 | ⚪ | — | AI always ships confidence + model/version + evidence |
| Offline inspector application | §58 (f1) | ⚪ | — | |

## 13. Fraud & safety

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Fraud & risk engine (multi-signal, explained risk levels) | §24, §22 (f2) | ⚪ | — | **Later**; needs provenance + transaction data to accumulate first |
| Fraud intelligence graph (seller↔phone↔device↔listing↔payment) | §64, §22 (f2) | ⚪ | — | |
| AI Scam Shield (submit listing/screenshot → risk + reasons + evidence) | §25, §23 (f2), §56 (f1) | ⚪ | — | |
| Duplicate image detection (perceptual hashing) | §26 | ⚪ | — | |
| Mileage integrity / anomaly detection | §19, §26 (f2) | ⚪ | — | "ANOMALY DETECTED", never auto-accusation |
| Seller verification with document checks | §20, §37 (f1) | 🟡 | Trust module groundwork | Document status lifecycle (`UPLOADED → VERIFIED/REJECTED/…`) spec'd; OCR ≠ authenticity |

## 14. Dealer OS & partner APIs

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Dealer OS v1 (inventory import, listings, leads, inspections, transactions) | §41, §52 (f2) | ⚪ | — | **Next** deliverable |
| Dealer API (scoped keys/OAuth: vehicles, events, documents, passport) | §42 (f1) | ⚪ | — | |
| Original dealer relationship (historical data contribution) | §17 | ⚪ | — | |
| Open vehicle data APIs + developer portal | §58 (f2), §79 (f1) | ⚪ | — | **Later**; for banks/insurers/fleets/fintechs |
| AI-native marketplace protocol (machine-readable inventory) | §59 (f2) | ⚪ | — | |

## 15. Search & notifications

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| Search service (OpenSearch; filters incl. verification/trust; NL query v0) | §7 (f1), §61 (f2) | ⚪ | — | Today only SQL filters (`getCarByBrand`, `getCarByBodyShape`) exist — the groundwork ceiling |
| Notification fan-out (email/SMS/push/in-app, consent, preferences) | §48 (f1), §63 (f2) | 🟡 | `services/notifications-service/` (cron worker, SMTP, ejs templates) | Worker exists; event-driven fan-out is **Next** |
| Welcome emails (cron, idempotent, retry-safe) | — | ✅ | `notifications-service/src/server.ts` (`cron.schedule('*/30 * * * * *')`), `emailService/email.ts`, `database/procedures_users.sql` (`SpSendWelcomeEmails`, `SpUpdateUserSentEmail`) | Overlap-guarded ticks; per-user failure isolation |

## 16. API platform & engineering hygiene

| Capability | Spec | Status | Where in repo | Notes |
|---|---|---|---|---|
| `/api/v1` versioned gateway | §78 | ✅ | `src/server.ts` mounts `app.use('/api/v1', modulesRouter)`; `src/Router/modules.ts` registry | One-line-per-module self-registration convention |
| Platform modules mounted under the gateway | §78, §79 | 🔵 | Sprint module PRs × 8 | Trust, Passport, Intelligence, Parts, Service, Fleet, Finance, Data |
| OpenAPI contract | §78 | 🔵 | Sprint API PR | Published contract for the gateway |
| JSON envelopes | §78 | ✅ | All controllers; `apps/web/src/api/api.js` documents the contract | `{ success, message, data }` |
| Parameterized stored procedures (SQLi defense) | §49 | ✅ | `database/procedures_*.sql`; `src/DatabaseHelper/index.ts` | No string-built SQL |
| Central error handling / 404 | §49 | ✅ | `Middlewares/errorHandler.ts`, `Middlewares/notFound.ts` | No stack traces or SQL errors leak |
| CORS + JSON body limits | §49 | ✅ | `src/server.ts` | `CORS_ORIGIN` env; 1mb JSON limit |
| Validation (Joi) | §49 | ✅ | `src/Helpers/index.ts` | Request payloads validated before SP calls |
| CI (type-check + build both services, compile web, secret scan) | §76 | ✅ | `.github/workflows/ci.yml`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` | |
| Ordered idempotent DB bootstrap | §77 | ✅ | `database/master.sql` (`:r` includes, `:on error exit`), `schema_tables.sql`, `seed.sql` | Extension slots reserved in `master.sql` for module SQL |
| Rate limiting, abuse detection, encryption-at-rest, threat modeling | §49 | ⚪ | — | |
| Observability (OpenTelemetry, Prometheus/Grafana, correlation IDs) | §51 (f1), §66 (f2) | ⚪ | — | |
| Multi-country adapters (registry/payment/transfer/compliance) | §82 (f1) | ⚪ | — | **Later**: Uganda, Tanzania, Rwanda after Kenya |

*(f1) / (f2) = spec file 1 / file 2 where both documents cover the domain with different section numbers.*

---

## Top 10 pending features to build next

Prioritized by impact vs effort, given what already exists (Finance state machine ✅ this sprint, Passport timeline ✅, Data audit log ✅, cron worker ✅).

| # | Feature | Rationale (impact vs effort) |
|---|---|---|
| 1 | **M-Pesa Daraja integration** behind the Finance abstraction (authenticated, idempotent, reconciled callbacks) | Highest impact — turns the shipped escrow state machine into revenue; medium effort since the state machine + webhook stub already exist |
| 2 | **Inspection platform v1** (workflow, checklist, evidence upload) | Core to the "evidence, not trust" principle — nothing can be honestly called *verified* without it; medium effort, mostly CRUD + upload + states |
| 3 | **Listing lifecycle states** (`DRAFT → PENDING_VERIFICATION → PUBLISHED → …`) replacing binary soft delete | Small effort (state column + transition guards) but immediately makes verification statuses meaningful marketplace-wide |
| 4 | **Provenance event writers** wired into marketplace/finance/service actions (`LISTED`, `RESERVED`, `SOLD`, `SERVICED`) | Low effort — Passport timeline + audit helper are already shipped; it just needs the call sites, and it makes every other feature more trustworthy |
| 5 | **Seller verification with document checks** (identity + business, OCR extraction separated from authenticity) | High trust impact; medium effort; reuses Trust module profiles and unblocks verified-review weighting |
| 6 | **Listing versioning / price & mileage change audit** | Cheap (build directly on the Data append-only log) and disproportionately valuable for dispute evidence later |
| 7 | **Notification fan-out** (event-driven email/SMS/in-app + preferences) | Low-medium effort on the existing cron worker; high retention/safety value (payment secured, transfer completed, price changed) |
| 8 | **Search service** (indexed filters incl. verification + trust score, NL query v0) | High discovery impact; medium effort; also unblocks the AI buying assistant later |
| 9 | **Disputes v1** (evidence-backed dispute package assembling listing versions, passport, inspection, payments) | Must exist before transaction volume scales; medium effort, mostly assembling artifacts that features 1–6 already produce |
| 10 | **Dealer OS v1** (inventory import, listing management, leads) | Biggest supply-side growth lever; medium-high effort, but reuses listing lifecycle + verification from items 3 and 5 |

*Explicitly out of scope by design: purchasable verification badges, ads overriding trust ranking, merged verified/unverified review scores, fake verification claims (Spec §67, §61, §40).*

---

*Maintained by the product team. Update the status column as PRs land — this file is the audit, not the aspiration; [ROADMAP.md](ROADMAP.md) holds the aspiration.*
