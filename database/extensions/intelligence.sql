/* =====================================================================
   extensions/intelligence.sql — RYNEX Intelligence module
   ---------------------------------------------------------------------
   Purpose:
     Read-only analytics stored procedures for the RYNEX Intelligence
     module (src/Modules/Intelligence/). They answer three questions
     over the live (isDeleted = 0) Cars catalogue:

       uspMarketOverview  -> market-wide totals + per-brand breakdown
                             (ONE procedure, TWO recordsets:
                              recordsets[0] = single totals row,
                              recordsets[1] = one row per brand)
       uspBrandStats      -> per-brand listing counts and price stats
       uspValuation       -> rules-based (heuristic) price estimate for
                             one car vs. its brand+bodyType cohort

   Target table:
     Cars (carId VARCHAR(50) PK,
           model VARCHAR(100),
           bodyType VARCHAR(50),
           brand VARCHAR(50),
           prices DECIMAL(10,2),
           pictureUrl VARCHAR(255),
           isDeleted BIT DEFAULT 0)
     -- defined in database/schema_tables.sql (run it FIRST).

   Idempotency:
     CREATE OR ALTER only -- safe to re-run at any time. No EXECUTE
     statements (no test calls) are included on purpose.

   Execution:
     Included from master.sql via
       :r $(ScriptPath)\extensions\intelligence.sql
     after procedures_cars.sql. Or standalone:
       sqlcmd -S localhost -d carshop -U sa -P <pwd> -i extensions/intelligence.sql

   VALUATION HEURISTIC (v1, rules-based):
     The suggested price is the average live asking price of the car's
     cohort: every non-deleted listing sharing the car's brand AND
     bodyType (the car itself is included in its own cohort, so a cohort
     always has >= 1 row and the average can never be empty/NULL).
     deltaPct = (car.prices - cohortAvg) / cohortAvg * 100 -- positive
     means the car is listed above the cohort average, negative below.
     confidence communicates how much data stands behind the number:
       >= 5 cohort listings -> 'medium'   (usable baseline)
       <  5 cohort listings -> 'low'      (thin evidence, treat as indicative)
     This is deliberately transparent and explainable -- NOT an ML model.
     The model roadmap (gradient boosting on provenance features: year,
     mileage, trim, location, import history, inspection grades, closing
     prices from Finance) is documented in docs/AI_STRATEGY.md,
     section 3.2 capability 1 "Vehicle valuation". Estimates are market
     baselines, never guaranteed values (spec: no guaranteed pricing).
   ===================================================================== */

/* =====================================================================
   uspMarketOverview
   Called by: GET /api/v1/intelligence/market/overview (getMarketOverview)
   Parameters: none.
   Returns TWO recordsets (consumed via result.recordsets[0]/[1]):
     [0] totals -- one row: activeListings, avgPrice, minPrice, maxPrice
         (aggregates are NULL when the catalogue is empty)
     [1] brands -- one row per brand: brand, listingCount,
         avgPrice, minPrice, maxPrice
   ===================================================================== */
CREATE OR ALTER PROCEDURE uspMarketOverview
AS
BEGIN
    SET NOCOUNT ON;

    -- Recordset 1: market-wide totals over live listings.
    SELECT
        COUNT(*)                           AS activeListings,
        CAST(AVG(prices) AS DECIMAL(10,2)) AS avgPrice,
        CAST(MIN(prices) AS DECIMAL(10,2)) AS minPrice,
        CAST(MAX(prices) AS DECIMAL(10,2)) AS maxPrice
    FROM Cars
    WHERE isDeleted = 0;

    -- Recordset 2: the same stats broken down per brand.
    SELECT
        brand,
        COUNT(*)                           AS listingCount,
        CAST(AVG(prices) AS DECIMAL(10,2)) AS avgPrice,
        CAST(MIN(prices) AS DECIMAL(10,2)) AS minPrice,
        CAST(MAX(prices) AS DECIMAL(10,2)) AS maxPrice
    FROM Cars
    WHERE isDeleted = 0
    GROUP BY brand
    ORDER BY brand;
END;
GO

/* =====================================================================
   uspBrandStats
   Called by: GET /api/v1/intelligence/brands (getBrandStats)
   Parameters: none.
   Returns ONE recordset: brand, listingCount, avgPrice, minPrice,
   maxPrice -- live rows only, busiest brands first.
   ===================================================================== */
CREATE OR ALTER PROCEDURE uspBrandStats
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        brand,
        COUNT(*)                           AS listingCount,
        CAST(AVG(prices) AS DECIMAL(10,2)) AS avgPrice,
        CAST(MIN(prices) AS DECIMAL(10,2)) AS minPrice,
        CAST(MAX(prices) AS DECIMAL(10,2)) AS maxPrice
    FROM Cars
    WHERE isDeleted = 0
    GROUP BY brand
    ORDER BY
        listingCount DESC,
        brand ASC;  -- deterministic tie-break
END;
GO

/* =====================================================================
   uspValuation
   Called by: GET /api/v1/intelligence/valuation/:carId (getValuation)
   Parameter: @CarId VARCHAR(50)
   Returns ONE recordset (single flat row):
     the car row (carId, model, bodyType, brand, prices, pictureUrl,
     isDeleted) joined inline with the cohort stats and the estimate:
       cohortCount     -- live listings with same brand + bodyType
       cohortAvgPrice  -- average asking price of that cohort
       suggestedPrice  -- the heuristic estimate = cohortAvgPrice
       deltaPct        -- (car.prices - cohortAvg) / cohortAvg * 100,
                         rounded to 2 dp (positive = listed above cohort)
       confidence      -- 'medium' when cohortCount >= 5, else 'low'
   Errors:
     THROW 50501 'Car not found' when the id does not match a live
     (isDeleted = 0) row -- the controller maps that to HTTP 404.
   ===================================================================== */
CREATE OR ALTER PROCEDURE uspValuation
    @CarId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Brand     VARCHAR(50),
            @BodyType  VARCHAR(50);

    -- Locate the live car first; a miss raises 50501 for the controller.
    SELECT
        @Brand    = brand,
        @BodyType = bodyType
    FROM Cars
    WHERE carId = @CarId
      AND isDeleted = 0;

    IF @Brand IS NULL
        THROW 50501, 'Car not found', 1;

    -- Cohort stats: live listings with the same brand AND bodyType.
    -- The car itself belongs to its own cohort, so count >= 1 and the
    -- average below is never NULL for a car that passed the check above.
    DECLARE @CohortCount    INT,
            @CohortAvgPrice DECIMAL(10,2);

    SELECT
        @CohortCount    = COUNT(*),
        @CohortAvgPrice = CAST(AVG(prices) AS DECIMAL(10,2))
    FROM Cars
    WHERE isDeleted = 0
      AND brand    = @Brand
      AND bodyType = @BodyType;

    -- Car row + cohort stats + heuristic estimate in one flat row.
    SELECT
        c.carId,
        c.model,
        c.bodyType,
        c.brand,
        c.prices,
        c.pictureUrl,
        c.isDeleted,
        @CohortCount    AS cohortCount,
        @CohortAvgPrice AS cohortAvgPrice,
        @CohortAvgPrice AS suggestedPrice,
        -- NULLIF guards the degenerate all-zero-price cohort (unreachable via
        -- the API: Joi requires prices > 0) so it degrades to NULL, not an error.
        CAST(ROUND((c.prices - @CohortAvgPrice) / NULLIF(@CohortAvgPrice, 0) * 100.0, 2) AS DECIMAL(10,2)) AS deltaPct,
        IIF(@CohortCount >= 5, 'medium', 'low') AS confidence
    FROM Cars c
    WHERE c.carId = @CarId
      AND c.isDeleted = 0;
END;
GO
