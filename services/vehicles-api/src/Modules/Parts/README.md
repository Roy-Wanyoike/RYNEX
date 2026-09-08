# RYNEX Parts Module

Catalogue of vehicle parts with vehicle-fit compatibility metadata and
admin-managed stock. Mounted under the versioned gateway:

```
/api/v1/parts
```

Files: `parts.router.ts` (routes) · `parts.controller.ts` (handlers) ·
`parts.schemas.ts` (Joi validation, module-local by design) ·
`database/extensions/parts.sql` (table + stored procedures).

All responses use the platform envelope `{ success, message, data? }`.
Errors are `400` (validation), `401` (missing/invalid token), `403`
(non-admin on admin routes), `404` (unknown/removed part), `409` (stock
conflict) and `500` (generic — raw SQL errors are never leaked).

## Endpoints

| Method | Path                      | Auth             | Description |
|--------|---------------------------|------------------|-------------|
| POST   | `/parts`                  | verifyToken + requireAdmin | Create a part. Body: `{ name, category, brand?, fitsMake?, fitsModel?, fitsYearFrom?, fitsYearTo?, price }`. `partId` is a server-generated uuid; `stockQty` starts at `0`. → `201` created row. |
| GET    | `/parts`                  | public           | Catalogue. Optional query: `?category&brand&fitsMake&fitsModel`. → `200` rows ordered by `name`. |
| GET    | `/parts/:partId`          | public           | Single live part. → `200` row / `404`. |
| PATCH  | `/parts/:partId/stock`    | verifyToken + requireAdmin | Adjust stock. Body: `{ delta }` (integer `-999..999`, positive = restock, negative = consume). → `200` updated row. |
| DELETE | `/parts/:partId`          | verifyToken + requireAdmin | Soft delete (`isDeleted = 1`, row is kept). → `200 { message: 'Part removed' }`. |

### Example

```bash
# Admin creates a part compatible with Toyota Hilux 2015-2020
curl -X POST /api/v1/parts \
  -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" \
  -d '{"name":"Brake pad set (front)","category":"brakes","brand":"Brembo",
       "fitsMake":"Toyota","fitsModel":"Hilux","fitsYearFrom":2015,
       "fitsYearTo":2020,"price":89.99}'

# Public: everything that fits a Toyota Hilux
curl "/api/v1/parts?fitsMake=Toyota&fitsModel=Hilux"

# Admin restocks by 25 units
curl -X PATCH /api/v1/parts/<partId>/stock \
  -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" \
  -d '{"delta":25}'
```

## Compatibility model

Each part row carries an optional vehicle-fit window:

- `fitsMake` / `fitsModel` — the vehicle make/model the part fits
  (`NULL` = not make/model-specific).
- `fitsYearFrom` / `fitsYearTo` — inclusive model-year range
  (`NULL` bounds = open-ended). The API rejects a window whose end
  precedes its start.

Semantics chosen deliberately:

- **NULL filters mean "any"** — the controller normalizes absent/empty
  query values to SQL `NULL` so `SpGetParts` uses the
  `(@X IS NULL OR column = @X)` pattern; empty strings never match as
  literals.
- **A part with all four fit columns `NULL` is universal** and matches
  every vehicle browse; filters narrow, never widen.
- Compatibility is currently *static metadata* on the part (one window
  per row). A part fitting multiple vehicles is represented as multiple
  rows or will move to a fitment table when the Compatibility Engine
  lands — see below.

## Spec mapping

| Capability | Spec | Status here |
|------------|------|-------------|
| Parts catalogue + stock management | **#36 Parts Marketplace** (FEATURES.md §8 "Parts catalogue", "Stock management") | Shipped: CRUD-lite catalogue, soft delete, atomic stock adjust with negative-stock guard. Marketplace listing/seller tiers are later specs. |
| Vehicle → parts compatibility | **#37 Compatibility Engine** (FEATURES.md §8 "Compatibility engine") | Foundation shipped: `fitsMake/fitsModel/fitsYearFrom/fitsYearTo` columns + filtered queries. OEM/aftermarket cross-reference and "never claim compatibility without sufficient data" rules are the Engine's next layer. |
| Parts trust / warranty network | **#39 Parts Trust** (FEATURES.md §8 "Parts trust score / warranty network / parts passport") | Not started — this module only guarantees data hygiene (soft delete, server-owned ids, no client-controlled stock). |

## Database

`database/extensions/parts.sql` (included by `database/master.sql`) is
idempotent — table is created only when absent, procedures are
`CREATE OR ALTER`, no test `EXECUTE`s. Stored procedures:

| Procedure | Purpose | Errors |
|-----------|---------|--------|
| `spAddPart` | Insert + return the row (defaults: `stockQty 0`, `isDeleted 0`, `createdAt SYSUTCDATETIME()`) | — |
| `SpGetParts` | Filtered live-catalogue query, `ORDER BY name` | — |
| `spGetOnePart` | One live row or empty recordset (→ 404) | — |
| `spAdjustStock` | Atomic `stockQty + @Delta` with row-lock guard so the quantity can never go negative | `50601` → 409, `50602` → 404 |
| `spSoftDeletePart` | `isDeleted = 1` | `50602` → 404 |

Index: `IX_parts_category` on `(category)` filtered to `isDeleted = 0`
(mirrors the `IX_Cars_*` pattern).

## Notes for consumers

- Only admin JWTs (`isAdmin`) can create, restock or remove parts;
  browsing is public.
- Soft-deleted parts disappear from every read path — the row stays in
  the table for audit/order history.
- Stock can never go negative server-side; concurrent adjustments are
  serialized by the row's exclusive lock inside `spAdjustStock`.
