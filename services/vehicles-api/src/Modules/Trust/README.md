# RYNEX Trust — seller trust profiles, scores, ratings & leaderboard

The Trust module is the reputation backbone of the RYNEX marketplace: it stores
per-seller verification flags, accumulates buyer ratings and disputes, computes
an **explainable trust score** (0–100) and exposes a public leaderboard.
Trust scores are never purchasable and never ad-influenced — they move only
when the underlying facts (verification, ratings, sales, disputes) move.

- **CarTrust spec mapping:** Seller Verification (**#20**), Trust Score
  (**#45**), ratings/leaderboard (**#46**, partial).
- **Module layout:** `trust.controller.ts` (handlers), `trust.router.ts`
  (routes, mounted at `/api/v1/trust` via `src/Router/modules.ts`),
  SQL extension at `database/extensions/trust.sql`.

## Endpoints

Mounted under `/api/v1/trust` (see `src/Router/modules.ts`).

| Method | Path                       | Auth                        | Description |
|--------|----------------------------|-----------------------------|-------------|
| GET    | `/trust/leaderboard`       | Public                      | Top 20 sellers by trust score (with userName, ratingAvg, salesCount). Deterministic tie-breaks: more ratings, then userName. |
| GET    | `/trust/sellers/:userId`   | Public                      | Single seller profile + trust score. `404` when the seller has no profile yet (profiles are created by the admin verify / rating flows — never auto-created on read). |
| POST   | `/trust/sellers/:userId/verify` | `verifyToken` + `requireAdmin` | Admin sets verification flags / business name. Body: `{ idVerified?, phoneVerified?, emailVerified?, businessName? }` (booleans; omitted/null fields are left unchanged). Upserts the profile, recomputes the score, returns the full profile. `404` for unknown users. |
| POST   | `/trust/sellers/:userId/rating` | `verifyToken`          | Buyer rates a seller. Body: `{ rating: 1..5 }`. Self-rating → `400 Cannot rate yourself`. Auto-provisions the profile on the seller's first rating, accumulates the rating and returns the new score. `404` for unknown users, `400` for invalid ratings. |

All responses use the platform envelope: `{ success, message, data? }`.

## Trust-score formula

```
score = 40·idVerified            (identity verified)
      + 20·phoneVerified         (phone verified)
      + 15·emailVerified         (email verified)
      + min(15, ratingAvg·3)     (buyer reputation: a perfect 5.0 avg = 15)
      + min(10, salesCount)      (first 10 completed sales, 1 point each)
      - min(20, disputeCount·5)  (each dispute costs 5, capped at 20)
      → clamped to 0..100
```

The weights total 100: 75 points are verification state, 15 buyer reputation,
10 sales track record. SQL Server (< 2022) has no `LEAST()`, so the caps are
`IIF(x > cap, cap, x)` chains — the arithmetic lives in exactly one place,
`spComputeTrustScore`, and is documented in the SQL file header.

## Stored procedures (`database/extensions/trust.sql`)

| Procedure | Purpose |
|-----------|---------|
| `spGetSellerProfile(@UserId)` | Profile row LEFT JOIN `users` (userName, email) + computed `ratingAvg`. |
| `spComputeTrustScore(@UserId)` | Recomputes, stores and returns the trust score using the formula above. |
| `spUpsertSellerProfile(@UserId, @IdVerified, @PhoneVerified, @EmailVerified, @BusinessName)` | Admin upsert (NULL params = keep existing on update, 0 on insert), then recomputes. Emits `[trustScore]` then the profile row. |
| `spRecordSellerRating(@UserId, @Rating)` | Validates 1..5, auto-provisions the profile if missing, `ratingSum += @Rating`, `ratingCount += 1`, recomputes. Emits `[trustScore]` then the rating summary. |
| `spTrustLeaderboard()` | Top 20 by trust score, INNER JOIN `users`, ORDER BY score DESC. |

Supporting schema: table `dbo.sellerProfiles` (PK/FK `userId → users(userId)`,
verification flags, `businessName`, `ratingSum`/`ratingCount`, `salesCount`,
`disputeCount`, `trustScore DECIMAL(5,2) DEFAULT 50.00`, `updatedAt`) and index
`IX_sellerProfiles_trustScore` backing the leaderboard sort. The extension is
idempotent (`IF OBJECT_ID` guard for the table, `CREATE OR ALTER` for SPs) and
is included from `database/master.sql`.

## Error semantics

- SPs raise controlled signals: `Seller user not found` → HTTP 404,
  `Rating must be an integer between 1 and 5` → HTTP 400.
- Any other SQL/driver failure is logged via `console.error` and answered with
  a generic `500` message — raw errors never reach the client.
- `403` (admin required) and `401` (token missing/invalid) come from the
  shared `verifyToken` / `requireAdmin` middlewares.
