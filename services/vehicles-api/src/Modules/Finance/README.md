# RYNEX Finance — Protected Transactions & Escrow

Closes **#19**. Implements the protected-payments ledger and escrow state
machine for the RYNEX platform.

- API: `src/Modules/Finance/finance.controller.ts` + `finance.router.ts`,
  mounted at **`/api/v1/finance`** via `src/Router/modules.ts`.
- SQL: `database/extensions/finance.sql` (idempotent; included by
  `database/master.sql`), table `transactions` + 4 stored procedures.

All responses use the platform envelope `{ success, message, data? }`.
Auth follows the platform contract: `verifyToken` attaches the decoded JWT
to `(req as any).user = { userId, isAdmin }`; `requireAdmin` gates
admin-only moves.

---

## Escrow state machine

A transaction is created in `INITIATED` and can only move along the edges
below. Transitions are enforced **in the database**
(`spUpdateTransactionStatus`), not just in the API, and the admin PATCH is
the only endpoint that can trigger a move.

```text
                        initiate
                           |
                      [INITIATED]
                      /        \
              PENDING           FAILED (terminal)
              /     \               |
         [PENDING]   \              |
         /        \   \             |
    [HELD]      FAILED (terminal)  |
    /     \                       |
[RELEASED] [REFUNDED]  <- both terminal
```

| From        | Allowed to                  | Meaning                              |
| ----------- | --------------------------- | ------------------------------------ |
| `INITIATED` | `PENDING`, `FAILED`         | payment submitted / initiation died  |
| `PENDING`   | `HELD`, `FAILED`            | funds captured, now in escrow / fail |
| `HELD`      | `RELEASED`, `REFUNDED`      | deal closed / deal reversed          |
| `RELEASED`  | — (terminal)                | funds paid out to seller             |
| `REFUNDED`  | — (terminal)                | funds returned to buyer              |
| `FAILED`    | — (terminal)                | terminal failure                     |

Any other move — including from terminal states and unknown target
statuses — raises SQL error **50902** `Invalid transaction transition`,
which the API maps to **HTTP 409**.

---

## Endpoints

Base path: `/api/v1/finance`

| Method | Path                        | Auth                    | Body                        | Success | Errors |
| ------ | --------------------------- | ----------------------- | --------------------------- | ------- | ------ |
| POST   | `/transactions`             | `verifyToken`           | `{ carId?, amount, provider }` | 201 + row | 400 validation, 404 car/user, 500 |
| GET    | `/transactions/mine`        | `verifyToken`           | —                           | 200 + list (newest first) | 401, 500 |
| GET    | `/transactions/:txId`       | `verifyToken`           | —                           | 200 + row | 400 bad uuid, 401, 403 not owner/admin, 404 |
| PATCH  | `/transactions/:txId/status`| `verifyToken` + `requireAdmin` | `{ status }`         | 200 + updated row | 400 validation/uuid, 401, 403 non-admin, 404, 409 invalid transition |
| POST   | `/webhooks/:provider`       | **public** (stub)       | provider payload (ignored)  | 202 `{ success: true, message: 'Webhook received' }` | — |

Notes:

- `txId` is always generated **server-side** (uuid v4); the request body
  can never set it. `:txId` path params must be uuids (router-level
  validation → 400 otherwise).
- `status` is never accepted at initiation; rows start at `INITIATED`.
- `reference` is reserved for the payment provider reference and is never
  client-supplied.
- Route order matters: `/transactions/mine` is declared before
  `/transactions/:txId`.

### SQL error → HTTP mapping

| THROW code | Meaning                          | HTTP |
| ---------- | -------------------------------- | ---- |
| 50901      | Invalid payment provider         | 400  |
| 50902      | Invalid transaction transition   | 409  |
| 50903      | Transaction not found            | 404  |
| 50904      | Car not found or unavailable     | 404  |
| 50905      | User not found                   | 404  |
| 50906      | Missing TxId/UserId, bad amount  | 400  |

---

## ⚠️ Webhooks — v1 stub, MUST verify signatures in production

`POST /api/v1/finance/webhooks/:provider` is a **stub**: it returns
`202 { success: true, message: 'Webhook received' }` and persists
**nothing**.

> **PRODUCTION MUST verify the provider signature before trusting any
> payload.** Until then this endpoint must not read amounts, ids or
> statuses from webhook bodies, and must not mutate transactions. An
> unauthenticated webhook that could move escrow state would let anyone
> mark their own deal `RELEASED` — this is exactly what the signature
> check prevents.

Planned hardening: verify the HMAC/signature header against the **raw**
request body using the provider webhook secret, reject replays
(timestamp/nonce), and only then transition state
(`PENDING → HELD` on capture callbacks, `HELD → REFUNDED` on refund
callbacks).

---

## Next step: M-Pesa Daraja integration

The provider column already supports `MPESA`. Planned integration order
(all server-side, amounts resolved by the API, never the client):

1. **Credentials & environment**
   - Daraja app → consumer key/secret, business shortcode, Lipa-na-M-Pesa
     passkey; sandbox first, then production.
   - New env vars (never committed): `MPESA_CONSUMER_KEY`,
     `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`,
     `MPESA_PASSKEY`, `MPESA_ENV=sandbox|production`,
     `MPESA_CALLBACK_URL`.
   - Secrets live only in the deployment environment / secret store.

2. **OAuth token**
   - `GET /oauth/v1/generate?grant_type=client_credentials` with basic auth
     (consumer key:secret); cache the token for its ~1h lifetime.

3. **STK push (initiation)**
   - `POST /mpesa/stkpush/v1/processrequest` with timestamped password
     (`base64(shortcode + passkey + timestamp)`), amount, phone,
     callback URL and `AccountReference = txId`.
   - On success, move the transaction `INITIATED → PENDING`
     (admin endpoint or a dedicated internal service path).

4. **Callback validation (closes the webhook TODO)**
   - Daraja posts the result to `/webhooks/mpesa`; verify the callback
     (origin/credentials per Daraja requirements) and **re-verify** the
     transaction with a server-side STK query before trusting it.
   - Only after validation: persist the provider `reference`, and move
     `PENDING → HELD` (escrow funded) or `PENDING → FAILED` (cancelled/
     timed out). Release/refund of `HELD` stays an explicit admin/
     dispute-flow action.

5. **Reconciliation**
   - Idempotent webhook handling (Daraja retries deliveries); a
     reconciliation job to catch missed callbacks.

---

## Security notes

- **Client amounts — car purchases (v1 limitation).** For v1 the API
  accepts explicit `amount` values so *non-car services* can be priced
  without a `Cars` row. When `carId` **is** provided, the API
  cross-checks `amount > 0` and the SP verifies the car is live, but the
  price itself is still client-supplied.
  **TODO(PRODUCTION): resolve the price server-side from `Cars.prices`**
  for car purchases (the cart module already does this in `spAddToCart`)
  and ignore/reject client-sent amounts. Mirrored in
  `finance.controller.ts` (`initiateTransaction`) and
  `database/extensions/finance.sql` (`spInitiateTransaction`).
- **Escrow transitions are admin-only** (`verifyToken` + `requireAdmin`)
  and enforced twice: Joi whitelist in the API and the transition table
  in `spUpdateTransactionStatus`, serialized with `UPDLOCK, HOLDLOCK` so
  concurrent PATCHes cannot race past the guard.
- **Ownership checks**: reading a single transaction returns 403 unless
  the caller owns it or is admin.
- **Webhooks are untrusted by construction** in v1 (see warning above).
- No raw driver error text leaks to clients; unknown SQL errors map to a
  generic 500.

## Spec mapping

| Spec domain              | Issue | Where implemented |
| ------------------------ | ----- | ----------------- |
| Protected Transactions   | #33   | `transactions` table, `spInitiateTransaction`, POST/GET endpoints |
| Transaction State Machine| #34   | `spUpdateTransactionStatus` (escrow transition table), PATCH endpoint |
| Payment Integrations     | #35   | `provider` column, webhook stub, M-Pesa Daraja plan above |
| Digital Deal Room        | #43   | escrow `HELD`/`RELEASED`/`REFUNDED` states a deal room will drive |
