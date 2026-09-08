# RYNEX Intelligence Module

Read-only market analytics and rules-based (heuristic) price valuation over the
live vehicle catalogue. This module **never writes**: it has no POST/PUT/DELETE
routes and its stored procedures contain no data modifications — which is why
every endpoint below is **public** (no auth middleware).

Part of the RYNEX platform gateway: mounted at **`/api/v1/intelligence`** via
`src/Router/modules.ts`; SQL ships in `database/extensions/intelligence.sql`
(`uspMarketOverview`, `uspBrandStats`, `uspValuation`), included from
`database/master.sql`.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/intelligence/market/overview` | public | Market-wide totals (`totals`) + per-brand breakdown (`brands`) — one SP, two recordsets |
| GET | `/api/v1/intelligence/brands` | public | Per-brand `listingCount`, `avgPrice`, `minPrice`, `maxPrice`, busiest brands first |
| GET | `/api/v1/intelligence/valuation/:carId` | public | Heuristic valuation for one live car vs. its brand+bodyType cohort |

All responses use the platform envelope `{ success, message, data? }`.
Only live (`isDeleted = 0`) listings are ever aggregated — soft-deleted cars
never influence market stats.

### `GET /market/overview`

```json
{
  "success": true,
  "message": "Market overview fetched",
  "data": {
    "totals": { "activeListings": 10, "avgPrice": 1250000.00, "minPrice": 450000.00, "maxPrice": 3200000.00 },
    "brands": [ { "brand": "Toyota", "listingCount": 4, "avgPrice": "...", "minPrice": "...", "maxPrice": "..." } ]
  }
}
```

`uspMarketOverview` returns two recordsets; the controller reads
`result.recordsets[0]` (single totals row) and `result.recordsets[1]` (brand
rows). When the catalogue is empty, `totals` still returns one row with
`activeListings: 0` and `null` aggregates, and `brands` is `[]`.

### `GET /brands`

`data` is the row array from `uspBrandStats` ordered by `listingCount DESC`
(tie-broken by brand name for determinism).

### `GET /valuation/:carId`

Returns the car row plus its cohort stats and the estimate in one flat object:

```json
{
  "carId": "...", "model": "Harrier", "bodyType": "SUV", "brand": "Toyota",
  "prices": 5500000.00, "pictureUrl": "...", "isDeleted": false,
  "cohortCount": 6,
  "cohortAvgPrice": 5100000.00,
  "suggestedPrice": 5100000.00,
  "deltaPct": 7.84,
  "confidence": "medium"
}
```

- **404** — the car does not exist or is soft-deleted (`uspValuation` raises
  SQL error **50501 "Car not found"**, mapped to HTTP 404 by the controller).
- **deltaPct** — `(car.prices - cohortAvg) / cohortAvg * 100`, rounded to 2 dp.
  Positive = the car is listed **above** the cohort average, negative = below.

## Valuation heuristic (v1 — rules-based, not ML)

The suggested price is deliberately simple and explainable:

1. **Cohort** = every live listing with the same `brand` **and** `bodyType`
   (the car itself is part of its own cohort, so a cohort always has at least
   one row and the average is never empty).
2. **suggestedPrice** = cohort average asking price (`cohortAvgPrice`).
3. **deltaPct** = how far the car's own price sits from that baseline (%).
4. **confidence** = how much data stands behind the number:
   - `medium` — cohort has **>= 5** live listings: a usable market baseline.
   - `low` — cohort has **< 5** live listings: thin evidence; treat the number
     as indicative only.

Known limitations (by design for v1): the model uses asking prices only, and
ignores year, mileage, trim, location and import history — those columns do not
exist on `Cars` yet. Estimates are market baselines, **never guaranteed
values** (product-spec safety rule: no guaranteed pricing claims).

## AI roadmap

This heuristic is phase **v0/P0** of the valuation capability. The model
roadmap — gradient boosting (LightGBM-class) on provenance features (year,
mileage, trim, location, import history, inspection condition grades,
closing-price labels from the Finance module, days-on-market) with quantile
Low/Typical/High bands and *Fair / High / Low / Insufficient data* assessments —
is documented in **`docs/AI_STRATEGY.md`**, section 3.2, capability 1
"Vehicle valuation". Every listing aggregated here feeds that future training
set; the audit trail of AI outputs lives in the Data module.

## Spec mapping

| Capability | Spec | Status | Where |
|---|---|---|---|
| Market overview (Market Analytics) | Product spec — Pricing Intelligence | Shipped this module | `uspMarketOverview` + `GET /market/overview` |
| Brand stats (Market Analytics) | Product spec — Pricing Intelligence | Shipped this module | `uspBrandStats` + `GET /brands` |
| Heuristic valuation (Price Intelligence, issues **#27/#29**) | Product spec — Pricing Intelligence | Shipped this module | `uspValuation` + `GET /valuation/:carId` |
| Full factor price intelligence (year/mileage/trim/location/import) | Product spec — Pricing Intelligence | Designed, pending | `docs/AI_STRATEGY.md` §3.2 |
| TCO, EV intelligence, AI buying assistant, recommendations | Product spec | Not started | `docs/FEATURES.md` §6 "Intelligence (pricing & market data)" |

Tracked in `docs/FEATURES.md` §6; overall AI strategy in `docs/AI_STRATEGY.md`.
