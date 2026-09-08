# RYNEX — System Architecture

> How RYNEX is built today, and how it evolves into the trust and intelligence
> infrastructure for mobility. Companion to [VISION.md](VISION.md).

RYNEX is a monorepo. The architecture strategy is the one the product brief prescribes:
**start modular, enforce domain boundaries early, extract services only when scale,
ownership or reliability justifies it.** Every layer below is described as-built — with
file paths — followed by the target evolution and the decisions behind it.

---

## 1. Current architecture (as-built)

### 1.1 Component diagram

```
                                 ┌───────────────────────────────────────┐
                                 │              apps/web                 │
                                 │   Vanilla TS/JS SPA (no framework)    │
                                 │  buyer · seller · admin flows         │
                                 │  src/api/api.js  → fetch + envelopes  │
                                 │  src/api/ui.js   → toasts, form errors│
                                 └──────────────┬────────────────────────┘
                                                │ REST/JSON, Bearer JWT
                 ┌──────────────────────────────▼──────────────────────────────┐
                 │                 services/vehicles-api (:4000)                │
                 │                                                              │
                 │  Marketplace core routes   │  Versioned platform gateway     │
                 │   /auth  /products         │   /api/v1/{trust,passport,      │
                 │   /cart  /users (admin)    │          intelligence,parts,    │
                 │                            │          service,fleet,         │
                 │                            │          finance,data}          │
                 │                            │   Router/modules.ts registry    │
                 │                                                              │
                 │  pipeline: CORS → json(1mb) → route → verifyToken(JWT)       │
                 │            → requireAdmin → Joi → controller → envelope      │
                 │  tail: notFound → central errorHandler (sanitized 5xx)        │
                 └──────────────┬──────────────────────────────┬───────────────┘
                                │ parameterized stored          │ /health
                                │ procedures (lazy shared pool) │
                 ┌──────────────▼──────────────┐   ┌───────────▼────────────────┐
                 │      SQL Server (MSSQL)     │   │ services/notifications-    │
                 │  database/ — idempotent SQL │   │ service (:4002)            │
                 │   master.sql (ordered :r)   │   │  node-cron every 30s       │
                 │   ├ schema_tables.sql       │   │  → SpSendWelcomeEmails     │
                 │   ├ procedures_users.sql    │   │  → SMTP (nodemailer+ejs)   │
                 │   ├ procedures_cars.sql     │   │  overlapping-run guard     │
                 │   ├ procedures_cart.sql     │   └────────────────────────────┘
                 │   ├ seed.sql (guarded)      │
                 │   └ extensions/ (modules)   │   ┌────────────────────────────┐
                 └─────────────────────────────┘   │  .github/workflows/ci.yml  │
                                                   │  tsc matrix (both services)│
                                                   │  web tsc · secret scan     │
                                                   └────────────────────────────┘
```

Build status: the **marketplace core is fully wired end-to-end** (auth, products, cart,
users, notifications). The **`/api/v1` module gateway is live** and ships a self-registration
contract — `Router/modules.ts` reserves one commented slot per module and
`database/master.sql` reserves one commented include per module extension, so modules land
behind the gateway as single-line merges without touching shared files.

### 1.2 Request lifecycle

Every mutating or authenticated request follows the same spine:

```
apps/web (localStorage token)
   │  api.request(path, {method, body})  →  Authorization: Bearer <jwt>
   ▼
Express pipeline                    services/vehicles-api/src/server.ts
   ├─ manual CORS                   Allow-Origin from CORS_ORIGIN, preflight 200
   ├─ express.json({limit:'1mb'})   bounded payloads
   ├─ route match                   /auth /products /cart /users /api/v1/*
   ├─ verifyToken middleware        Bearer scheme enforced, jwt.verify against
   │                                SECRETKEY, payload {userId,userName,email,
   │                                fullName,isAdmin} normalized (strict boolean),
   │                                attached to req.user — fails closed (401)
   ├─ requireAdmin (admin routes)   isAdmin===true or 403
   ├─ Joi validation (controllers)  e.g. registration schema forbids client-sent isAdmin
   ▼
Controller                          src/Controller/*
   │  db.exec('spName', params, types)   src/DatabaseHelper — lazy shared mssql
   │                                      pool; inputs bound as parameters
   │                                      (default NVarChar(MAX) — no truncation)
   ▼
SQL Server stored procedure         database/procedures_*.sql
   │  business rules live in the DB: e.g. spAddToCart derives brand+price from
   │  Cars server-side (client sends only carId+quantity) and upserts on the
   │  UNIQUE(userId, carId) constraint
   ▼
Response envelope                   { success: boolean, message: string, data: T }
   │  controllers wrap recordsets; errors funnel to the central handler
   ▼
errorHandler / notFound             5xx messages generic ('Internal server error');
                                    no stack traces or SQL errors leave the service
```

The web client consumes only the envelope shape and auto-logs-out on stale 401s —
one contract across every page (`apps/web/src/api/api.js`).

### 1.3 The module gateway pattern

RYNEX products beyond the marketplace (Trust, Passport, Intelligence, Parts, Service,
Fleet, Finance, Data) mount under one versioned gateway. The pattern has three moving
parts:

1. **HTTP registry** — `services/vehicles-api/src/Router/modules.ts`. An Express subrouter
   mounted at `/api/v1` in `server.ts`. Each module owns exactly one registration line
   (`router.use('/trust', trustRouter)`) and contributes **nothing else** to shared code.
   Module source lives in `src/Modules/<Name>/` as `<name>.router.ts` (default-exported
   Router) + `<name>.controller.ts` + `README.md`.
2. **Database extensions** — each module ships idempotent SQL in
   `database/extensions/<name>.sql` and uncomments exactly its own `:r` include in
   `database/master.sql`. Schema for a module therefore ships and rolls out with the
   module, under the same `IF OBJECT_ID … IS NULL` idempotency rules as the core.
3. **Uniform contract** — modules inherit the platform middleware chain (CORS, JSON body
   limits, JWT auth, role guards, error tail) and respond in the standard envelope, so a
   module is indistinguishable from core from the client's perspective.

Why it matters: this is the seam where a modular monolith becomes a service-oriented
platform. Because every module already enters through one mounted router, extracting
`/api/v1/finance` into its own deployable later is an ops change, not a rewrite.

### 1.4 Data model overview

Authoritative definition: `database/schema_tables.sql` (idempotent, re-runnable).

| Table | Purpose | Notable constraints & decisions |
|---|---|---|
| `users` | Application accounts | `userName`/`email` UNIQUE; `password VARCHAR(255)` holds 60-char bcrypt hashes with headroom; `isAdmin`/`emailSent` are real `BIT` columns |
| `Cars` | Vehicle catalogue | Soft delete via `isDeleted`; money is `DECIMAL(10,2)`; filtered nonclustered indexes `IX_Cars_BodyType`, `IX_Cars_Brand` cover live rows only |
| `cart` | Buyer cart lines | FKs to `users` + `Cars` (cascade); `UNIQUE(userId, carId)` makes duplicate line items impossible and enables upsert quantity-merge |
| `specCarOrders` | Standalone order records | UTC defaults (`SYSUTCDATETIME()`) |

Operational rules: `database/master.sql` is the ordered bootstrap (`:r` includes,
`:on error exit` so CI fails on a half-applied schema); `seed.sql` uses guarded inserts and
is optional. All data access goes through stored procedures (`procedures_users.sql`,
`procedures_cars.sql`, `procedures_cart.sql`) — the API layer contains no ad-hoc SQL.

### 1.5 Security model

- **Parameterized stored procedures everywhere.** Inputs are bound by `DatabaseHelper`;
  there is no string-built SQL in the request path.
- **Fail-closed auth.** `verifyToken` rejects missing headers, missing `SECRETKEY`,
  malformed/expired tokens, and non-object payloads with 401 — nothing falls through.
  `requireAdmin` gates admin routes on a strictly-normalized `isAdmin`.
- **Server-resolved prices.** Cart endpoints accept only `{ carId, quantity }`; brand and
  price are derived inside `spAddToCart`. A client-sent price is never trusted.
- **Credential hygiene.** bcrypt hashes; hashes never leave the database via API; the
  registration schema forbids client-supplied `isAdmin` (Joi `forbidden()`).
- **Bounded blast radius on errors.** Central `errorHandler` logs server-side and returns
  generic 5xx messages; `notFound` closes the route table; JSON body limited to 1 MB.
- **Supply chain and secrets.** CI (`.github/workflows/ci.yml`) type-checks and builds both
  services plus the web app, and runs a secret-scan job; `.env` is git-ignored and every
  service ships `.env.example`.

### 1.6 Notifications worker

`services/notifications-service` is a standalone cron worker (port 4002): `node-cron` ticks
every 30 seconds, calls the `SpSendWelcomeEmails` / `SpUpdateUserSentEmail` stored-procedure
pair to find and claim newly registered users, and renders EJS templates through SMTP
(nodemailer). It is deliberately boring-by-design: a `/health` probe, a DB connect that
never blocks startup, and an overlapping-run guard (skip the tick if the previous run is
still in flight). This is the current answer to "how does RYNEX do background work" —
see Stage 5 for its target successor.

---

## 2. Target architecture — evolution stages

The product brief (sections 3–13 of the master engineering prompt) defines the target
stack: **Go core → PostgreSQL 18+/PostGIS as transactional source of truth → OpenSearch →
Redis → NATS JetStream → Temporal → S3-compatible storage → ClickHouse → AI services layer,
multi-tenant throughout.** RYNEX reaches that target by evolution, not rewrite — the brief
is explicit: *do not destroy working functionality unnecessarily; do not maintain duplicate
business logic indefinitely.*

```
  Target shape (each box arrives as a stage below, never as a big-bang migration)

  apps/web ─┐
  dealers ──┼─▶ /api/v1 gateway ─▶ Go core (modular monolith) ─▶ PostgreSQL+PostGIS (truth)
  partners ─┘            │                    │
                         │                    ├─▶ NATS JetStream (versioned, tenant-aware events,
                         │                    │    transactional outbox) ─▶ consumers
                         │                    ├─▶ OpenSearch (search/facets/discovery — never truth)
                         │                    ├─▶ Redis (cache, rate limits, idempotency — never truth)
                         │                    ├─▶ Temporal (verification, escrow, transfer workflows)
                         │                    ├─▶ S3-compatible storage (evidence, images, documents)
                         │                    ├─▶ ClickHouse (analytics warehouse, pricing, fraud)
                         │                    └─▶ AI gateway ─▶ model services (never source of truth)
                         └─▶ every layer carries organization_id (tenant isolation)
```

| Stage | Capability | What exists today | What we add |
|---|---|---|---|
| **0. Modular monolith** *(now)* | One deployable API, module registry, one DB | Express `vehicles-api`, `modules.ts` registry, `/api/v1`, idempotent MSSQL bootstrap, cron worker, CI | — (this is the baseline) |
| **1. Event bus** | Domain events decouple modules | Direct SP calls; notifications poll the DB; Rynex Data provides the append-only event/audit foundation | **NATS JetStream** with versioned, traceable, idempotent, tenant-aware, schema-validated events (`vehicle.verified`, `payment.confirmed`, `fraud.signal.created`, …) via the **transactional outbox** pattern; notifications and trust scoring become subscribers |
| **2. Search engine** | Marketplace-grade discovery | Filtered SQL indexes on `Cars` (brand, body type) | **OpenSearch** for vehicles/parts/sellers: full-text, facets (price, mileage, location, verification status, trust score), geo; PostgreSQL/SQL Server stays authoritative — the index is rebuildable, never truth |
| **3. Cache & coordination** | Latency + abuse control | None (stateless API, JWT auth) | **Redis** for hot vehicle/passport reads, rate limiting, short-lived locks, idempotency keys; never authoritative financial state |
| **4. Object storage** | Evidence at scale | `pictureUrl` strings; assets served from the web app | **S3-compatible storage** for vehicle/inspection photos, documents, evidence, contracts — metadata + immutable references in the DB, signed URLs, thumbnail/variant pipeline; never large binaries in the RDBMS |
| **5. Workflow engine** | Crash-safe long-running flows | 30-second cron worker with an overlap guard | **Temporal** for verification, inspection, protected purchase/escrow, ownership transfer, disputes, financing — workflows survive crashes, retries, worker restarts and delayed external systems; retires cron-as-orchestrator |
| **6. Analytics warehouse** | Intelligence at scale | Aggregate stats computed on the OLTP DB (Rynex Intelligence heuristics) | **ClickHouse** for price trends, demand, fraud patterns, funnels, dealer performance; analytical load moves off the transactional DB |
| **7. AI services layer** | Explainable intelligence | Deterministic heuristics inside the API | **AI gateway → model services** (LLM, OCR, vision, fraud, pricing, recommendation). Rules: AI is never the source of truth for identity, ownership, payment, legal or transaction state; every output records model/version/input/confidence; outputs are labeled VERIFIED FACT vs DECLARED CLAIM vs AI INFERENCE vs UNKNOWN; anomaly ≠ accusation |
| **8. Multi-tenancy** | Organizations as first-class citizens | Single-tenant deploy; role guards (user/admin) | `organization` entity + tenant context enforced at API, service, repository, DB, search, events, jobs, caches, storage and analytics; explicit cross-tenant leakage tests; dealers/garages/fleet operators never see each other's data |
| **9. Data-layer migration** | PostgreSQL + PostGIS as truth | MSSQL + stored procedures (ADR 1) | **Go core + PostgreSQL 18+/PostGIS** per the brief's controlled migration (gateway fronts Go core + Node legacy); PostGIS adds geo-native dealer/inspector/service coverage; versioned migrations replace the idempotent bootstrap; SP-only data access (ADR 1) keeps the swap bounded |

Staging discipline: each stage ships behind the `/api/v1` gateway with its own module and
extension SQL; no stage requires the marketplace to stop shipping. Stages 1 and 8 (events
and tenancy) land before commerce-critical stages (5, Finance expansion) because both are
retrofit-expensive.

---

## 3. Architecture decision records

| # | Decision | Context & rationale | Trade-offs accepted |
|---|---|---|---|
| 1 | **MSSQL + stored procedures as the first data layer** (brief's target is PostgreSQL) | The monorepo bootstrapped from a working, hardened schema. Parameterized SPs give injection safety by construction, keep business rules (price resolution, upsert merging) server-side next to the data, and the idempotent SQL bootstrap makes any machine reproducible in one command. Controllers use `db.exec('SpName', …)` only — **no ad-hoc SQL in the app layer** — so the eventual Postgres migration (Stage 9) is a bounded, mechanical change rather than an archaeology project | Temporary divergence from the target stack; vendor-specific SQL in procedures |
| 2 | **Vanilla TS/JS web app first** (no framework) | The front door must be fast on low-bandwidth, intermittent mobile connections (Kenya-first). Zero framework tax, no build-chain lock-in, strict TypeScript where TS is used. Shared `api.js`/`ui.js` give the consistency a framework would, without the cost. Modernization (SSR/SEO/PWA) is deferred until demonstrated product need | Manual DOM code; framework decision still open (brief allows modernized-Angular or Next.js) |
| 3 | **Modular monolith, not microservices** | Brief §4: "Do not prematurely create dozens of independently deployed microservices… extract services when scale, ownership or reliability requirements justify it." Domain boundaries are enforced by the module registry instead of by the network | One deployable to reason about; requires registry discipline |
| 4 | **Versioned gateway `/api/v1` from day one** | Every product beyond the marketplace enters through one mounted, versioned router with reserved registration slots — modules merge as single lines without touching shared files, and the public API contract can evolve independently of internals | Gateway file is a shared coordination point (mitigated by the one-line-per-module rule) |
| 5 | **Node/Express now, Go core later** | Brief §4 prescribes a controlled migration (gateway fronts Go core + Node legacy) and forbids simultaneous rewrites. The marketplace core proves the domain model while the Go platform is stood up module-by-module | Two runtimes during the transition; duplicate logic is retired module-by-module |
| 6 | **Uniform `{ success, message, data }` envelope** | One response contract for every route and module: clients handle a single shape, contract tests stay trivial, error semantics are consistent | Slightly verbose payloads |
| 7 | **Idempotent SQL scripts over a migration tool (today)** | `IF OBJECT_ID … IS NULL` guards + ordered `master.sql` + fail-on-error give deterministic, CI-runnable bootstrap with zero extra tooling. Versioned migrations with rollback plans arrive with the Postgres stage (Stage 9) | No downgrade path today; acceptable pre-production |
| 8 | **Cron worker before Temporal** | The only async job today (welcome emails) is a 30-second poll with a claim flag — an overlap-guarded cron is the simplest correct tool. Temporal (Stage 5) is adopted when workflows become multi-step and money-adjacent (escrow, ownership transfer) and must survive crashes | Cron pattern will be retired, not migrated |
| 9 | **Append-only audit/event foundation first (Rynex Data)** | The moat is provable provenance; you cannot retrofit immutability onto a mutated history. Events and audit records are append-only from the first commit; corrections create new events | Storage grows forever (pruned by policy later) |
| 10 | **Monorepo** | Atomic cross-service changes (API contract + web client in one PR), one CI pipeline, one dependency policy, multi-agent contributors coordinate through file ownership instead of repo ownership | Repo grows; extraction of services is still possible later since modules already have hard boundaries |

---

## 4. Related

- [VISION.md](VISION.md) — mission, thesis, product network, operating principles
- [ROADMAP.md](ROADMAP.md) — stage sequencing and milestones
- [FEATURES.md](FEATURES.md) — shipped vs pending feature audit
- [AI_STRATEGY.md](AI_STRATEGY.md) — AI guardrails and service design
- [RESEARCH/](RESEARCH/) — market, competitor and regulatory research
