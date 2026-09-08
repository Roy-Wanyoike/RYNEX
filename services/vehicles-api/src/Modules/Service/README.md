# RYNEX Service Module

Service bookings for the RYNEX Service Centre Platform: authenticated users book a
service (INSPECTION / MAINTENANCE / REPAIR / DIAGNOSTICS) against a catalogue car,
and administrators move each booking through a strict status state machine.

- Database: `database/extensions/service.sql` (table `serviceBookings` + 4 procedures,
  idempotent, included by `database/master.sql`)
- Mounted by the platform gateway: `src/Router/modules.ts` -> `/api/v1/service`
- Auth: `verifyToken` (JWT in `Authorization: Bearer <token>`) / `requireAdmin`
  (admin only). Identity comes from the verified token — never from the body.

## Endpoints

| Method | Path                                            | Auth                  | Body                                             | Success | Errors                     |
| ------ | ----------------------------------------------- | --------------------- | ------------------------------------------------ | ------- | -------------------------- |
| POST   | `/api/v1/service/bookings`                      | `verifyToken`         | `{ carId, serviceType, preferredDate, notes? }`  | `201` created booking | `400` invalid input / unknown car (`50701`,`50702`,`50705`), `401`, `500` |
| GET    | `/api/v1/service/bookings`                      | `verifyToken`         | —                                                | `200` current user's bookings (newest first) | `401`, `500` |
| GET    | `/api/v1/service/bookings/all`                  | `verifyToken`+`requireAdmin` | —                                         | `200` all bookings with `userName` | `401`, `403`, `500` |
| PATCH  | `/api/v1/service/bookings/:bookingId/status`    | `verifyToken`+`requireAdmin` | `{ status }`                              | `200` updated booking | `400` bad uuid/status, `401`, `403`, `404` unknown booking (`50704`), `409` illegal transition (`50703`), `500` |

All responses use the global envelope `{ success, message, data? }`.

### Field rules

- `carId` — UUID of an existing, non-soft-deleted catalogue car (`Cars`); server-side
  validation throws `50702` (mapped to `400`).
- `serviceType` — one of `INSPECTION | MAINTENANCE | REPAIR | DIAGNOSTICS`.
- `preferredDate` — client-supplied, therefore **not trusted blindly**: must be a strict
  `YYYY-MM-DD` string and a real calendar date (`2025-02-30` is rejected), and must not
  be in the past (today is allowed). Anything else -> `400`.
- `notes` — optional, max 500 chars, stored as `NVARCHAR(500)`.
- `status` — one of `PENDING | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED`;
  whether the move is *legal* is decided by the database state machine (below).
- `:bookingId` — must be a UUID; malformed ids are rejected by the router (`400`)
  before reaching the database.

## Booking status state machine

```
   confirm             start                complete
 PENDING ───▶ CONFIRMED ───▶ IN_PROGRESS ───▶ COMPLETED (terminal)
    │             │              │
    │             │              │
    └─────────────┴──────────────┘
                  │
        cancel (from any active state)
                  ▼
            CANCELLED (terminal)
```

Simplified transition table (enforced by `spUpdateBookingStatus`, THROW `50703` when violated):

| Current state  | Allowed next states              |
| -------------- | -------------------------------- |
| `PENDING`      | `CONFIRMED`, `CANCELLED`         |
| `CONFIRMED`    | `IN_PROGRESS`, `CANCELLED`       |
| `IN_PROGRESS`  | `COMPLETED`, `CANCELLED`         |
| `COMPLETED`    | — (terminal)                     |
| `CANCELLED`    | — (terminal)                     |

Notes:

- No-op "transitions" (e.g. `PENDING -> PENDING`) and moves out of terminal states are
  rejected as `409 Conflict` with a message listing `current -> new`.
- The current status is read under `UPDLOCK, HOLDLOCK`, so two concurrent admin PATCHes
  can never both win the same transition.
- `updatedAt` is bumped by the procedure (`SYSUTCDATETIME()`) on every successful move.

## Database objects (`database/extensions/service.sql`)

| Object                    | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `dbo.serviceBookings`     | Bookings table; FKs to `users` (cascade) and `Cars` (restrict) |
| `dbo.spCreateBooking`     | Creates a booking (status defaults to `PENDING`); validates service type (`50701`) and car existence (`50702`) |
| `dbo.SpGetBookingsByUser` | A user's bookings joined with `Cars` (model, brand), newest first |
| `dbo.spGetAllBookings`    | Every booking, additionally joined with `users` (`userName`)   |
| `dbo.spUpdateBookingStatus` | State-machine transition + `updatedAt` bump; `50703`/`50704` |

SQL error numbers -> HTTP mapping lives in `service.controller.ts`:
`50701 -> 400`, `50702 -> 400`, `50703 -> 409`, `50704 -> 404`, `50705 -> 400`.

## Spec mapping

| RYNEX spec section           | Where it lands here                                                             |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Service Centre Platform (#43) | `POST /bookings` + admin lifecycle endpoints; booking state machine enforced in `spUpdateBookingStatus` |
| Service History (#42)        | `GET /bookings` / `GET /bookings/all` return the durable booking log (newest first, with car model/brand); the `Cars` FK is `ON DELETE NO ACTION` so hard-deleting a car cannot orphan service history |

## Example

```bash
# Book a service (authenticated user) — preferredDate must be today or later
curl -X POST http://localhost:4000/api/v1/service/bookings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"carId":"a90b580a-da97-46d5-b351-10633295adc9","serviceType":"MAINTENANCE","preferredDate":"2099-01-31","notes":"60k km service"}'
# -> 201 { success: true, message: "Service booking created", data: { status: "PENDING", ... } }

# Admin confirms, then starts the job
curl -X PATCH http://localhost:4000/api/v1/service/bookings/<bookingId>/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"CONFIRMED"}'
# PENDING -> IN_PROGRESS directly would be 409 { message: "Invalid status transition: PENDING -> IN_PROGRESS" }
```
