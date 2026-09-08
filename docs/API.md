# RYNEX API — the versioned gateway (`/api/v1`) and the marketplace surface

The single source of truth for the HTTP surface is the **OpenAPI 3.0.3 contract**:

- **Machine contract (canonical):** [`services/vehicles-api/openapi.yaml`](../services/vehicles-api/openapi.yaml)
- **Served live:** `GET /api/v1/openapi.yaml` → `Content-Type: text/yaml; charset=utf-8`
  (the canonical file is read from the service root; the same relative path resolves
  for compiled `dist/server.js` runs and in-place `src/` runs)
- **Gateway version header:** every `/api/v1/*` response carries `X-API-Version: v1`

Every path in the contract is verified against the actual routers — nothing
aspirational is listed. Update the YAML together with the routers; this page is
the human tour.

---

## Base URL & transport

| | |
|---|---|
| Local dev | `http://localhost:4000` (`PORT` env overrides) |
| Body format | JSON (`express.json` limit 1 MB) |
| CORS | `Access-Control-Allow-Origin: $CORS_ORIGIN` (default `*`) |
| Versioning | Marketplace endpoints are unversioned (`/health`, `/auth`, `/users`, `/products`, `/cart`); platform modules are versioned under `/api/v1/<module>` |

## The response envelope

Every JSON response uses the same envelope — `{ success, message, data? }`:

```jsonc
// success (2xx) — `data` present on most reads/writes, absent on message-only ones
{ "success": true,  "message": "Cars fetched", "data": [ /* … */ ] }

// failure — `message` is always safe to show; raw SQL/driver errors never leave the server
{ "success": false, "message": "Booking not found" }
```

The envelope is the integration contract consumed by
`apps/web/src/api/api.js` (envelope handling, toasts, 401 auto-logout).

## Authentication

| Scheme | How | Who |
|---|---|---|
| Public | no `Authorization` header | anyone |
| Bearer | `Authorization: Bearer <JWT>` from `POST /auth/login` (1h expiry) | any authenticated user |
| Admin | Bearer **+** the JWT must carry the `isAdmin: true` claim (`Middlewares/requireAdmin`) | platform admins |

JWT payload: `{ userId, userName, email, fullName, isAdmin }`. Identity is always
taken from the verified token — never from the request body; ids (`carId`,
`txId`, `bookingId`, `partId`, `fleetId`, …) are generated server-side.

## HTTP status vocabulary

| Status | Meaning | Typical source |
|---|---|---|
| `200` | OK (also soft-delete/remove/idempotent deletes) | controllers |
| `201` | Created | `POST` handlers |
| `202` | Accepted, no persistence | `POST /api/v1/finance/webhooks/:provider` (v1 stub) |
| `400` | Validation failure / malformed params (Joi message in `message`) | Joi schemas, `50705`-class THROWs |
| `401` | Missing/malformed/expired token, or bad credentials | `verifyToken`, login |
| `403` | Authenticated but not allowed (non-admin on admin routes; not the owner) | `requireAdmin`, ownership checks |
| `404` | Unknown resource — or unmatched route (`Route not found`) | controllers, `notFound` |
| `409` | Conflict: duplicate key or illegal state transition | duplicate email/username, state machines |
| `500` | Unexpected error — generic message, details only in server logs | `errorHandler` |

## Endpoint tour

### Gateway & health

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/v1/openapi.yaml` | public | This contract, as YAML |
| `GET /health` | public | Liveness probe |

### Auth & users (marketplace)

| Method & path | Auth | Notes |
|---|---|---|
| `POST /auth/register` | public | `isAdmin` dropped server-side; strong password required; duplicate → `409` |
| `POST /auth/login` | public | → `{ token, user }`; no account enumeration (`401` generic) |
| `GET /users` | admin | All accounts, password hashes stripped |

### Products (marketplace catalogue)

| Method & path | Auth | Notes |
|---|---|---|
| `POST /products` | admin | `carId`/`isDeleted` are server-owned |
| `GET /products/getproducts` | public | Live (`isDeleted = 0`) cars only |
| `GET /products/getcarbodyshape/{bodyType}` | public | |
| `GET /products/getcarbrand/{brand}` | public | |
| `GET /products/getonecar/{carId}` | public | |
| `POST /products/softdeletecar/{carId}` | admin | Soft delete — the row is kept |

### Cart (server-side pricing)

| Method & path | Auth | Notes |
|---|---|---|
| `POST /cart` | bearer | Only `{ carId, quantity }` trusted; brand/price resolved in `spAddToCart`; upserts on `(userId, carId)` |
| `GET /cart` | bearer | Current user's rows |
| `POST /cart/add/{cardID}` | bearer | Quantity +1 |
| `POST /cart/subtract/{cardID}` | bearer | Quantity −1; row deleted at 0 |
| `GET /cart/all` | admin | Every user's cart, joined with `userName` |

### Trust (`/api/v1/trust`) — reputation

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/v1/trust/leaderboard` | public | Top 20 by trust score, deterministic tie-breaks |
| `GET /api/v1/trust/sellers/{userId}` | public | Profile + score; `404` until a profile exists (never auto-created on read) |
| `POST /api/v1/trust/sellers/{userId}/rating` | bearer | `{ rating: 1..5 }`; self-rating → `400`; auto-provisions the profile |
| `POST /api/v1/trust/sellers/{userId}/verify` | admin | Partial upsert of verification flags / business name; recomputes the score |

### Passport (`/api/v1/passport`) — vehicle identity & provenance

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/v1/passport` | admin | `{ carId, vin?, firstRegisteredAt? }`; one passport per car (`409` on re-issue) |
| `GET /api/v1/passport/{carId}` | public | `{ passport, events }`, events newest-first; append-only by design |
| `POST /api/v1/passport/{carId}/events` | admin | `eventType` whitelist (REGISTRATION, INSPECTION, SERVICE, TRANSFER, ACCIDENT, OWNERSHIP, OTHER); events are immutable |

### Intelligence (`/api/v1/intelligence`) — read-only analytics

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/v1/intelligence/market/overview` | public | `{ totals, brands }`; live listings only |
| `GET /api/v1/intelligence/brands` | public | Per-brand counts + price stats |
| `GET /api/v1/intelligence/valuation/{carId}` | public | Cohort-average heuristic; `confidence: low \| medium`; never a guaranteed value |

### Parts (`/api/v1/parts`) — catalogue & stock

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/v1/parts` | admin | `partId` server-generated; `stockQty` starts at 0 |
| `GET /api/v1/parts` | public | Filters: `?category&brand&fitsMake&fitsModel` (empty = any) |
| `GET /api/v1/parts/{partId}` | public | |
| `PATCH /api/v1/parts/{partId}/stock` | admin | `{ delta: -999..999 }`; stock can never go negative (`409`) |
| `DELETE /api/v1/parts/{partId}` | admin | Soft delete (`404` when absent) |

### Service (`/api/v1/service`) — bookings

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/v1/service/bookings` | bearer | `{ carId, serviceType, preferredDate, notes? }`; strict `YYYY-MM-DD`, today or later |
| `GET /api/v1/service/bookings` | bearer | Current user's bookings, newest first |
| `GET /api/v1/service/bookings/all` | admin | Every booking, joined with `userName` |
| `PATCH /api/v1/service/bookings/{bookingId}/status` | admin | DB-enforced state machine: `PENDING → CONFIRMED → IN_PROGRESS → COMPLETED`, `CANCELLED` from any active state; illegal/no-op moves → `409` |

### Fleet (`/api/v1/fleet`) — fleets & assignment

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/v1/fleet/fleets` | bearer | `{ name }`; owner = JWT `userId` |
| `GET /api/v1/fleet/fleets` | bearer | Caller's fleets + `vehicleCount` |
| `GET /api/v1/fleet/fleets/all` | admin | Every fleet, joined with `userName` |
| `GET /api/v1/fleet/fleets/{fleetId}/vehicles` | owner/admin | Fleet vehicles joined with `Cars` |
| `POST /api/v1/fleet/fleets/{fleetId}/vehicles` | owner/admin | `{ carId }`; duplicate assignment → `409` |
| `DELETE /api/v1/fleet/fleets/{fleetId}/vehicles/{carId}` | owner/admin | Idempotent (absent car still `200`) |

### Finance (`/api/v1/finance`) — protected transactions & escrow

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/v1/finance/transactions` | bearer | `{ carId?, amount, provider }` (`MPESA \| CARD \| ESCROW`); `txId` server-generated; starts `INITIATED` |
| `GET /api/v1/finance/transactions/mine` | bearer | Newest first |
| `GET /api/v1/finance/transactions/{txId}` | bearer | `403` unless owner or admin |
| `PATCH /api/v1/finance/transactions/{txId}/status` | admin | Escrow edges: `INITIATED → PENDING\|FAILED`, `PENDING → HELD\|FAILED`, `HELD → RELEASED\|REFUNDED`; illegal → `409` |
| `POST /api/v1/finance/webhooks/{provider}` | **public** | v1 stub — `202`, persists nothing; signatures MUST be verified before production (see Finance README) |

### Data (`/api/v1/data`) — audit trail

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/v1/data/audit?entityType=&entityId=` | admin | One entity's trail, newest first; `400` without `entityType` |
| `GET /api/v1/data/audit/recent?top=50` | admin | `top` clamped 1..200 (default 50) |

No public write endpoint exists by design — rows are appended by server code
via `recordAudit` → `spWriteAudit` (INSERT-only).

## SP THROW-code → HTTP mapping (per module)

Controlled SQL `THROW` numbers surface as `err.number` in the drivers and are
mapped by the controllers. Unknown SQL errors always fall through to a generic
`500` (message logged server-side only).

| Code | Module | Meaning | HTTP |
|---|---|---|---|
| `50401` | Passport | Car not found / passport not found | `404` |
| `50402` | Passport | Passport already exists (one per car) | `409` |
| `50403` | Passport | Invalid event type (whitelist) | `400` |
| `50501` | Intelligence | Car not found / soft-deleted (valuation) | `404` |
| `50601` | Parts | Stock adjustment would go negative | `409` |
| `50602` | Parts | Part not found / already removed | `404` |
| `50701` | Service | Invalid service type | `400` |
| `50702` | Service | Car not found / unavailable | `400` |
| `50703` | Service | Illegal booking status transition | `409` |
| `50704` | Service | Booking not found | `404` |
| `50705` | Service | Missing required booking parameters | `400` |
| `50800` | Fleet | Missing FleetId/OwnerUserId/Name/CarId (defensive) | `400` |
| `50801` | Fleet | Car not found or unavailable | `404` |
| `50802` | Fleet | Vehicle already in fleet | `409` |
| `50803` | Fleet | Fleet not found | `404` |
| `50901` | Finance | Invalid payment provider | `400` |
| `50902` | Finance | Invalid transaction (escrow) transition | `409` |
| `50903` | Finance | Transaction not found | `404` |
| `50904` | Finance | Car not found or unavailable | `404` |
| `50905` | Finance | User not found | `404` |
| `50906` | Finance | Missing TxId/UserId, bad amount | `400` |
| `51001` | Data | `metadata` is not valid JSON (write path) | — (server-side only) |
| `51002` | Data | Missing required audit fields (write path) | — (server-side only) |

Trust does not use numbered THROWs: its procedures raise controlled
`RAISERROR` messages (`Seller user not found` → `404`,
`Rating must be an integer between 1 and 5` → `400`) that the controller
matches on message text.

## Where things live

| What | Where |
|---|---|
| OpenAPI contract (canonical) | `services/vehicles-api/openapi.yaml` |
| Contract served over HTTP | `src/server.ts` (`GET /api/v1/openapi.yaml`, `X-API-Version` banner) |
| Module registry | `services/vehicles-api/src/Router/modules.ts` |
| Module docs | `services/vehicles-api/src/Modules/<Name>/README.md` |
| Shipped-vs-pending audit | [`FEATURES.md`](FEATURES.md) · aspiration: [`ROADMAP.md`](ROADMAP.md) |
