# Rynex Passport — vehicle digital identity & provenance

Closes #14. Every vehicle traded on RYNEX rails carries a **digital identity**:
a single passport row that anchors *who the vehicle is* (catalogue car, VIN,
first registration), plus an **append-only provenance timeline** that records
*what happened to it and when*. The Rynex promise — "claims have evidence" —
starts here: inspections, services, transfers, accidents and ownership changes
all land on this timeline as immutable events that later modules (Trust,
Finance, Intelligence) can read and cite.

- Issue: [#14 — Rynex Passport (vehicle identity & provenance)](https://github.com/Roy-Wanyoike/rynex/issues/14)
- SQL: [`database/extensions/passport.sql`](../../../database/extensions/passport.sql)
  (wired into `database/master.sql`)
- Mounted by: `src/Router/modules.ts` → `/api/v1/passport`

## Endpoints

Base path: `/api/v1/passport` (versioned gateway in `src/server.ts`).
Envelope everywhere: `{ success, message, data? }`.

| Method | Path                        | Auth                       | Description |
| ------ | --------------------------- | -------------------------- | ----------- |
| POST   | `/passport`                 | `verifyToken` + `requireAdmin` | Issue a passport for a catalogue car. Body: `{ carId, vin?, firstRegisteredAt? }` → `201 { data: passportRow }`. `404` when the car does not exist (THROW 50401), `409` when the car already has a passport (THROW 50402), `400` on validation errors. |
| GET    | `/passport/:carId`          | public                     | Fetch a vehicle's passport **and** its full provenance timeline → `200 { data: { passport, events } }` with `events` ordered `occurredAt DESC`. `404` when the car has no passport. |
| POST   | `/passport/:carId/events`   | `verifyToken` + `requireAdmin` | Append one provenance event. Body: `{ eventType, description, occurredAt? }` → `201 { data: eventRow }`. `occurredAt` defaults to *now*; `recordedBy` is stamped server-side from the admin's JWT `userId`. `400` on an invalid event type (THROW 50403), `404` when no passport exists for the car (THROW 50401). |

Example — issue a passport:

```http
POST /api/v1/passport
Authorization: Bearer <admin-token>
{ "carId": "9f1c...", "vin": "JH4KA7561PC008269", "firstRegisteredAt": "2018-03-14T00:00:00Z" }
```

Example — append an inspection event:

```http
POST /api/v1/passport/9f1c.../events
Authorization: Bearer <admin-token>
{ "eventType": "INSPECTION", "description": "Pre-sale inspection passed, odometer 84,120 km" }
```

Example — public read:

```http
GET /api/v1/passport/9f1c...
→ { "success": true, "data": { "passport": { ... }, "events": [ ... ] } }
```

## Event taxonomy

`eventType` is a closed whitelist, enforced twice (CHECK constraint in
`passportEvents` and a `THROW 50403` whitelist in `spAddPassportEvent`):

| Type           | Meaning |
| -------------- | ------- |
| `REGISTRATION` | First registration / import record (e.g. first-registered date captured) |
| `INSPECTION`   | Inspection outcomes and verification results |
| `SERVICE`      | Maintenance and repair history |
| `TRANSFER`     | Handover of the vehicle between parties (sales, resales) |
| `ACCIDENT`     | Accidents and damage reports |
| `OWNERSHIP`    | Ownership-chain details (owner count changes, liens, lease ends) |
| `OTHER`        | Anything else worth proving; use sparingly, describe precisely |

Free-form `description` (NVARCHAR(500)) carries the evidence narrative;
`occurredAt` is *when it happened in the real world* (may differ from
`createdAt`, which is when RYNEX recorded it).

## Immutability — append-only on purpose

Provenance is only trustworthy if it cannot be quietly rewritten, so this
module is **append-only by design**: `passportEvents` has no UPDATE/DELETE
stored procedures and the API exposes no edit or delete endpoints.
Corrections are new events that supersede earlier ones — the timeline keeps
telling the truth about what was recorded, and when. The same rule applies to
identity fields: the passport itself is issued once per vehicle
(`carId` UNIQUE, THROW 50402 on duplicates) and is never mutated through this
module.

## Spec mapping

| Spec section | Feature | Status here |
| ------------ | ------- | ----------- |
| §14 Vehicle Identity | VIN / first-registration captured with the vehicle record | ✅ `vehiclePassports.vin`, `firstRegisteredAt` |
| §15 Vehicle Passport | Assembled identity + ownership + inspection + service view | ✅ passport + timeline via `GET /passport/:carId`; evidence-grade labelling (VERIFIED / SELLER_DECLARED) lands with the Trust module |
| §16 Provenance Graph | Append-only event timeline; corrections create new events | ✅ `passportEvents` (append-only); event writers from marketplace/finance/service actions are follow-up work |

## Files

```
src/Modules/Passport/
├── passport.controller.ts   handlers (envelope responses, THROW-code mapping)
├── passport.router.ts       routes + auth guards
└── README.md                this file

database/extensions/passport.sql   tables, index, spCreatePassport /
                                   spGetPassport / spAddPassportEvent
                                   (idempotent, included by master.sql)
```
