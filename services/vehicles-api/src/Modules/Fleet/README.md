# RYNEX Fleet (`src/Modules/Fleet/`)

Multi-vehicle management foundations for fleet operators, rentals and corporate
fleets. Maps to **Fleet Platform §51 (f2)** — capability *“Fleets + vehicle
assignment”* (`docs/FEATURES.md` §10, GitHub issue **#18**). Drivers,
maintenance, fuel, insurance, utilization, depreciation and AI fleet insights
are future work (not in this slice).

The module self-registers in `src/Router/modules.ts` and is mounted on the
versioned gateway at **`/api/v1/fleet`** (all paths below are relative to that
mount, so `POST /fleets` = `POST /api/v1/fleet/fleets`).

## Files

| File | Purpose |
|---|---|
| `fleet.controller.ts` | Request handlers + in-module Joi schemas (`createFleetSchema`, `assignVehicleSchema`) |
| `fleet.router.ts` | Routes, auth guards, uuid param validation (`:fleetId`, `:carId`) |
| `database/extensions/fleet.sql` | Tables `fleets` / `fleetVehicles` + 7 stored procedures (idempotent, included by `database/master.sql`) |

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/fleets` | `verifyToken` | Create a fleet `{ name }` → **201** with the created fleet row. Owner = JWT `userId` (never client-supplied); `fleetId` is a server-generated uuid. |
| `GET` | `/fleets` | `verifyToken` | The caller's fleets, each with `vehicleCount` → **200**. |
| `GET` | `/fleets/all` | `verifyToken` + `requireAdmin` | Every fleet joined with the owner's `userName` + counts → **200**. |
| `GET` | `/fleets/:fleetId/vehicles` | `verifyToken` | Fleet vehicles joined with `Cars` (`carId`, `model`, `brand`, `prices`, `pictureUrl`) → **200**. **404** unknown fleet, **403** not owner/admin. |
| `POST` | `/fleets/:fleetId/vehicles` | `verifyToken` | Assign a catalogue car `{ carId }` → **201** with the assignment row. **404** unknown fleet or car, **403** not owner/admin, **409** car already in fleet. |
| `DELETE` | `/fleets/:fleetId/vehicles/:carId` | `verifyToken` | Remove the assignment → **200** `{ message: 'Vehicle removed' }`. Idempotent (removing an absent car still 200s). **404** unknown fleet, **403** not owner/admin. |

Non-uuid `:fleetId` / `:carId` params are rejected with **400** before any
database call. All responses use the platform envelope
`{ success, message, data? }`.

## Ownership model

- A fleet has exactly one owner: `fleets.ownerUserId` = the creating user's
  JWT `userId`, set server-side — the client can never create or re-parent a
  fleet for someone else.
- Every per-fleet route calls `spGetFleet` first; the controller compares the
  row's `ownerUserId` with the token subject (`authorizeFleetAccess`):
  - missing fleet → **404**,
  - fleet exists but the caller is neither its owner nor an admin → **403**,
  - owner **or** `isAdmin` → proceed; anyone else → **403**.
- Admins (`requireAdmin` / `isAdmin === true`) bypass ownership for reads and
  mutations but there is deliberately **no admin fleet-creation-for-others**
  path — a fleet always belongs to its creator.
- The SQL layer takes no user parameter: authorization lives in the
  controller so the same procedures serve both owner and admin paths, while
  `spGetFleet` returns `ownerUserId` purely for that check.

## Data model

```
fleets                                fleetVehicles
  fleetId     VARCHAR(50) PK (uuid)     id          VARCHAR(50) PK (NEWID())
  ownerUserId VARCHAR(50) FK → users    fleetId     VARCHAR(50) FK → fleets (CASCADE)
  name        VARCHAR(100) NOT NULL     carId       VARCHAR(50) FK → Cars (CASCADE)
  createdAt   DATETIME2 DEFAULT         assignedAt  DATETIME2 DEFAULT
              SYSUTCDATETIME()                      SYSUTCDATETIME()
                                        UNIQUE (fleetId, carId)
```

`fleetVehicles` is the assignment join between a fleet and the existing
`Cars` catalogue — the module owns no car data itself. The UNIQUE
`(fleetId, carId)` constraint makes duplicate assignment impossible.

### Stored procedures

| Procedure | Used by | Notes |
|---|---|---|
| `spCreateFleet` | `POST /fleets` | Validates params (`THROW 50800`); inserts + returns the row. |
| `SpGetFleetsByUser` | `GET /fleets` | Owner's fleets + `vehicleCount` subquery. |
| `spGetFleet` | ownership pre-check | Row **including `ownerUserId`** (+ count). |
| `spGetFleetVehicles` | `GET /fleets/:fleetId/vehicles` | `JOIN Cars` (model, brand, prices, pictureUrl). |
| `spAssignVehicleToFleet` | `POST /fleets/:fleetId/vehicles` | Car must exist (`50801`), fleet must exist (`50803`); duplicate-key (2627/2601) from the UNIQUE constraint is converted to `50802`. |
| `spRemoveVehicleFromFleet` | `DELETE /fleets/:fleetId/vehicles/:carId` | Idempotent; `OUTPUT`s the removed row. |
| `spGetAllFleets` | `GET /fleets/all` (admin) | `JOIN users` (`userName`) + counts. |

### Error contract (`THROW` numbers → HTTP)

| Code | Meaning | HTTP |
|---|---|---|
| `50800` | FleetId/OwnerUserId/Name/CarId missing | 400 (defensive; controller pre-validates) |
| `50801` | Car not found or unavailable (soft-deleted cars are not assignable) | **404** |
| `50802` | Vehicle already in fleet | **409** |
| `50803` | Fleet not found | **404** |

Anything else falls through to the generic **500** `Fleet operation failed`.

## Spec mapping

- **Fleet Platform §51 (f2)** — “Fleets + vehicle assignment”: ✅ this module.
- §51 (f2) remainder — drivers, maintenance, fuel, insurance, utilization,
  depreciation, AI fleet insights: ⚪ future (see `docs/FEATURES.md` §10).
- Registry: `src/Router/modules.ts` → `router.use('/fleet', fleetRouter)`;
  bootstrap: `database/master.sql` → `:r $(ScriptPath)\extensions\fleet.sql`.
