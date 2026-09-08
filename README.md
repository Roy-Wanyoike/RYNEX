# RYNEX

> **The trust and intelligence infrastructure for mobility.**
> RYNEX connects vehicles, people, businesses and transactions — starting with a verified
> vehicle marketplace for Kenya, growing into the trust layer every automotive
> transaction in Africa runs on.

[![RYNEX CI](https://github.com/Roy-Wanyoike/RYNEX/actions/workflows/ci.yml/badge.svg)](https://github.com/Roy-Wanyoike/RYNEX/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-20-green)

**Core principle:** *Don't ask buyers to trust the seller. Give buyers evidence.*

Every vehicle gets a digital identity. Every claim gets evidence. Every seller gets a
reputation. Every transaction gets an audit trail. That is the moat.

---

## The RYNEX product network

| Product | What it does | Status |
|---|---|---|
| **Rynex Vehicles** | Verified vehicle marketplace (the front door) | 🟢 Live in this repo |
| **Rynex Passport** | Digital identity + provenance timeline per vehicle | 🔵 Module shipped |
| **Rynex Trust** | Seller verification, reputation & trust scores | 🔵 Module shipped |
| **Rynex Intelligence** | Market stats, price intelligence, valuation heuristics | 🔵 Module shipped |
| **Rynex Parts** | Parts catalogue with vehicle compatibility | 🔵 Module shipped |
| **Rynex Service** | Service bookings & maintenance records | 🔵 Module shipped |
| **Rynex Fleet** | Multi-vehicle fleet management foundations | 🔵 Module shipped |
| **Rynex Finance** | Protected transactions, escrow state machine, M-Pesa-ready | 🔵 Module shipped |
| **Rynex API** | Versioned public gateway (`/api/v1`) + OpenAPI contract | 🔵 Module shipped |
| **Rynex Data** | Append-only audit trail & event foundation | 🔵 Module shipped |

Beyond automotive: the same trust-and-identity rails extend to any asset class where
provenance matters. See [docs/VISION.md](docs/VISION.md).

## Architecture at a glance

```
                        ┌──────────────────────────────┐
                        │        apps/web (SPA)        │
                        │  Buyer · Seller · Admin flows │
                        └──────────────┬───────────────┘
                                       │ REST (JSON envelopes)
                 ┌─────────────────────▼───────────────────────┐
                 │        services/vehicles-api (:4000)         │
                 │  /auth /products /cart /users   (marketplace)│
                 │  /api/v1/{trust,passport,intelligence,parts, │
                 │          service,fleet,finance,data}         │
                 │  JWT auth · role guards · Joi validation     │
                 │  central error handling · audit-ready        │
                 └─────────────────────┬───────────────────────┘
                                       │ parameterized stored procedures
                 ┌─────────────────────▼───────────────────────┐
                 │     SQL Server (database/, idempotent SQL)   │
                 │     marketplace core + platform extensions   │
                 └──────────────────────────────────────────────┘
                 ┌──────────────────────────────────────────────┐
                 │  services/notifications-service (:4002)      │
                 │  cron worker → welcome emails, alerts (SMTP) │
                 └──────────────────────────────────────────────┘
```

## Monorepo layout

```
RYNEX/
├── apps/web/                     # Vanilla TS/JS web app (buyer, seller, admin)
├── services/vehicles-api/        # Express + MSSQL REST API (marketplace + /api/v1 gateway)
├── services/notifications-service/ # Cron + SMTP email worker
├── database/                     # Idempotent SQL: schema, stored procedures, seed, extensions
├── docs/                         # Vision, architecture, roadmap, research, features audit
└── .github/                      # CI, issue & PR templates
```

## Quick start

**Prerequisites:** Node.js 20+, SQL Server 2019+ (or Docker), sqlcmd.

```bash
# 1. Database — create a database (e.g. carshop), then run the ordered SQL runner
sqlcmd -S localhost -d carshop -U sa -P <password> -v ScriptPath="$(pwd)/database" -i database/master.sql

# 2. Vehicles API
cd services/vehicles-api
cp .env.example .env          # fill DB_*, SECRETKEY
npm install && npm run dev    # → http://localhost:4000/health

# 3. Notifications service (optional)
cd ../notifications-service
cp .env.example .env          # fill SMTP creds
npm install && npm run dev    # → http://localhost:4002/health

# 4. Web app — serve apps/web with any static server (e.g. VS Code Live Server)
#    Login: admin / Admin123$   ·   john / John1234$   (seed users)
```

Full environment reference: [`services/*/. .env.example`](services/vehicles-api/.env.example).

## API tour (all responses are `{ success, message, data }` envelopes)

```http
POST /auth/register          { userName, email, password, fullName, ... }
POST /auth/login             → { token, user }                     # JWT, 1h expiry
GET  /products/getproducts   → available vehicles
POST /cart                   { carId, quantity }                   # price resolved server-side
GET  /api/v1/passport/:carId → vehicle identity + provenance events
GET  /api/v1/trust/sellers/:userId → verification + trust score
GET  /api/v1/intelligence/brands → market stats per brand
GET  /api/v1/parts?category=engine → parts catalogue
POST /api/v1/service/bookings → book a service visit
GET  /api/v1/finance/transactions/mine → protected transactions
```

Admin routes require a JWT whose payload has `isAdmin: true`.

## Security model

- Parameterized stored procedures everywhere (no string-built SQL)
- bcrypt password hashing; hashes never leave the database via API
- JWT (1h) + `verifyToken` / `requireAdmin` middleware chain; auth failures never fall through
- Client-sent prices are never trusted — the server resolves prices from the database
- Central error handler: no stack traces or SQL errors leak to clients
- CI secret-scanning job blocks credential commits
- `.env` is git-ignored; every service ships `.env.example`

## Docs

- [Vision](docs/VISION.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md)
- [Features audit — shipped vs pending](docs/FEATURES.md)
- [Market research](docs/RESEARCH/) · [AI strategy](docs/AI_STRATEGY.md)

## Contributing

1. Pick or open an issue (use the templates).
2. Branch `feat/<module>-<slug>`, implement, run `tsc --noEmit` for touched services.
3. Open a PR that says `Closes #<issue>` — PRs are reviewed and merged by the maintainer team.

## License

[MIT](LICENSE) © 2026 RYNEX
