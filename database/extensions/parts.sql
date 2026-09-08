/* =====================================================================
   extensions/parts.sql — RYNEX Platform Module Extension: PARTS (#16)
   ---------------------------------------------------------------------
   Purpose:
     Idempotent database extension for the Parts module
     (src/Modules/Parts/). Creates the parts catalogue table and the
     stored procedures the parts controller calls via DatabaseHelper.

   Schema created here:

     parts (partId       VARCHAR(50)   PK,
            name         VARCHAR(100)  NOT NULL,
            category     VARCHAR(50)   NOT NULL,
            brand        VARCHAR(50)   NULL,
            fitsMake     VARCHAR(50)   NULL,
            fitsModel    VARCHAR(50)   NULL,
            fitsYearFrom INT           NULL,
            fitsYearTo   INT           NULL,
            price        DECIMAL(10,2) NOT NULL,
            stockQty     INT           NOT NULL DEFAULT 0,
            isDeleted    BIT           NOT NULL DEFAULT 0,
            createdAt    DATETIME2     DEFAULT SYSUTCDATETIME())

     IX_parts_category — nonclustered index on (category), filtered to
     live rows only (isDeleted = 0), mirroring the IX_Cars_* pattern.

   Procedures created here (all CREATE OR ALTER, all SET NOCOUNT ON,
   none contain EXECUTE/dynamic SQL — safe to re-run at any time):

     spAddPart        (@PartId, @Name, @Category, @Brand, @FitsMake,
                       @FitsModel, @FitsYearFrom, @FitsYearTo, @Price)
                      -> INSERT + returns the inserted row
                      (stockQty/isDeleted/createdAt take table defaults).
     SpGetParts       (@Category, @Brand, @FitsMake, @FitsModel)
                      -> live rows filtered by whichever parameters are
                      non-NULL, ORDER BY name.
     spGetOnePart     (@PartId)
                      -> one live row or an empty recordset (the
                      controller maps empty to 404).
     spAdjustStock    (@PartId, @Delta)
                      -> atomically adds @Delta to stockQty.
                      THROW 50601 when the new quantity would be
                      negative; THROW 50602 when the part does not
                      exist as a live (isDeleted = 0) row.
                      Returns the updated row.
     spSoftDeletePart (@PartId)
                      -> flags isDeleted = 1; THROW 50602 when there is
                      no live row to remove. Returns no recordset.

   Error contract (consumed by parts.controller.ts via err.number):
     50601 -> HTTP 409 (stock adjustment would go negative)
     50602 -> HTTP 404 (part not found / already removed)

   Dependency:
     Self-contained: creates its own table. Run through master.sql
     (:r $(ScriptPath)\extensions\parts.sql) or directly with sqlcmd.
   ===================================================================== */

GO

/* =====================================================================
   1. Table — dbo.parts (created only when absent, so re-runs keep data)
   ===================================================================== */
IF OBJECT_ID(N'dbo.parts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.parts
    (
        partId       VARCHAR(50)   NOT NULL
            CONSTRAINT PK_parts PRIMARY KEY,
        name         VARCHAR(100)  NOT NULL,
        category     VARCHAR(50)   NOT NULL,
        brand        VARCHAR(50)   NULL,
        fitsMake     VARCHAR(50)   NULL,
        fitsModel    VARCHAR(50)   NULL,
        fitsYearFrom INT           NULL,
        fitsYearTo   INT           NULL,
        price        DECIMAL(10,2) NOT NULL
            CONSTRAINT DF_parts_price DEFAULT (0),
        stockQty     INT           NOT NULL
            CONSTRAINT DF_parts_stockQty DEFAULT (0),
        isDeleted    BIT           NOT NULL
            CONSTRAINT DF_parts_isDeleted DEFAULT (0),
        createdAt    DATETIME2     NOT NULL
            CONSTRAINT DF_parts_createdAt DEFAULT (SYSUTCDATETIME())
    );
END;
GO

/* =====================================================================
   2. Index — category lookups, filtered to live (non-deleted) rows only
   ===================================================================== */
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_parts_category' AND object_id = OBJECT_ID(N'dbo.parts'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_parts_category
        ON dbo.parts (category)
        WHERE isDeleted = 0;
END;
GO

/* =====================================================================
   spAddPart
   Called by: POST /parts (addPart, admin)
   Payload from controller:
     { PartId, Name, Category, Brand, FitsMake, FitsModel,
       FitsYearFrom, FitsYearTo, Price }  (9 params)
   @StockQty, @IsDeleted and @CreatedAt are intentionally NOT
   parameters — omitted from the INSERT column list so the table
   defaults (0 / 0 / SYSUTCDATETIME()) apply.
   Returns the inserted row (controller responds with recordset[0]).
   ===================================================================== */
CREATE OR ALTER PROCEDURE spAddPart
    @PartId       VARCHAR(50),
    @Name         VARCHAR(100),
    @Category     VARCHAR(50),
    @Brand        VARCHAR(50)  = NULL,
    @FitsMake     VARCHAR(50)  = NULL,
    @FitsModel    VARCHAR(50)  = NULL,
    @FitsYearFrom INT          = NULL,
    @FitsYearTo   INT          = NULL,
    @Price        DECIMAL(10,2)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.parts
    (
        partId,
        name,
        category,
        brand,
        fitsMake,
        fitsModel,
        fitsYearFrom,
        fitsYearTo,
        price
        -- stockQty, isDeleted, createdAt intentionally omitted -> table defaults
    )
    VALUES
    (
        @PartId,
        @Name,
        @Category,
        @Brand,
        @FitsMake,
        @FitsModel,
        @FitsYearFrom,
        @FitsYearTo,
        @Price
    );

    -- Return the inserted row so the controller can read recordset[0]
    SELECT *
    FROM dbo.parts
    WHERE partId = @PartId;
END;
GO

/* =====================================================================
   SpGetParts
   Called by: GET /parts (getParts) — public catalogue.
   Optional filters; the controller passes NULL for every filter the
   client omitted (empty query strings are normalized to NULL), so the
   (@X IS NULL OR column = @X) pattern short-circuits that predicate.
   Only live rows (isDeleted = 0), ordered by name.
   ===================================================================== */
CREATE OR ALTER PROCEDURE SpGetParts
    @Category  VARCHAR(50) = NULL,
    @Brand     VARCHAR(50) = NULL,
    @FitsMake  VARCHAR(50) = NULL,
    @FitsModel VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM dbo.parts
    WHERE isDeleted = 0
      AND (@Category  IS NULL OR category  = @Category)
      AND (@Brand     IS NULL OR brand     = @Brand)
      AND (@FitsMake  IS NULL OR fitsMake  = @FitsMake)
      AND (@FitsModel IS NULL OR fitsModel = @FitsModel)
    ORDER BY name;
END;
GO

/* =====================================================================
   spGetOnePart
   Called by: GET /parts/:partId (getOnePart) — public.
   Parameter: @PartId VARCHAR(50)
   Returns an empty recordset (not an error) when the part does not
   exist or is soft-deleted — the controller maps that to 404.
   ===================================================================== */
CREATE OR ALTER PROCEDURE spGetOnePart
    @PartId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM dbo.parts
    WHERE isDeleted = 0
      AND partId = @PartId;
END;
GO

/* =====================================================================
   spAdjustStock
   Called by: PATCH /parts/:partId/stock (adjustStock, admin).
   Parameters: @PartId VARCHAR(50), @Delta INT (-999..999, validated
   by the controller; the SP re-checks independently).

   Guards (THROW numbers are part of the module's HTTP error contract):
     50602 — the part does not exist as a live (isDeleted = 0) row
             -> controller responds 404.
     50601 — stockQty + @Delta would be negative
             -> controller responds 409.

   Concurrency: the guarded UPDATE re-evaluates the predicate under the
   row's exclusive lock, so two concurrent adjustments can never drive
   stockQty below zero. @@ROWCOUNT = 0 after the existence check proves
   the negative-stock guard tripped (nothing was modified in that case,
   so THROW leaves no partial state).
   Returns the updated row.
   ===================================================================== */
CREATE OR ALTER PROCEDURE spAdjustStock
    @PartId VARCHAR(50),
    @Delta  INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.parts WHERE partId = @PartId AND isDeleted = 0)
    BEGIN
        ;THROW 50602, 'Part not found', 1;
    END;

    UPDATE dbo.parts
    SET stockQty = stockQty + @Delta
    WHERE partId = @PartId
      AND isDeleted = 0
      AND stockQty + @Delta >= 0;

    IF @@ROWCOUNT = 0
    BEGIN
        ;THROW 50601, 'Stock adjustment rejected: quantity would go negative', 1;
    END;

    SELECT *
    FROM dbo.parts
    WHERE partId = @PartId;
END;
GO

/* =====================================================================
   spSoftDeletePart
   Called by: DELETE /parts/:partId (removePart, admin).
   Parameter: @PartId VARCHAR(50)
   Soft-deletes by flagging isDeleted = 1. THROW 50602 when there is
   no live row to remove (unknown or already-deleted part) — the
   controller maps that to 404. Deliberately returns NO recordset:
   SET NOCOUNT ON + no trailing SELECT, so the driver's result has no
   recordset for the UPDATE.
   ===================================================================== */
CREATE OR ALTER PROCEDURE spSoftDeletePart
    @PartId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.parts
    SET isDeleted = 1
    WHERE partId = @PartId
      AND isDeleted = 0;

    IF @@ROWCOUNT = 0
    BEGIN
        ;THROW 50602, 'Part not found', 1;
    END;
END;
GO
