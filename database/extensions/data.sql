/* =====================================================================
   extensions/data.sql — RYNEX Data module (append-only audit trail)
   ---------------------------------------------------------------------
   Closes #20. Creates the platform-wide audit trail used by every RYNEX
   module (Trust, Passport, Finance, Fleet, ...) and the Data module API
   (src/Modules/Data):

     auditLog            one immutable row per recorded action
     spWriteAudit        the ONLY supported write path (INSERT-only)
     SpGetAuditByEntity  audit rows for one entity, newest first
     spGetRecentAudit    the newest N audit rows, newest first (N <= 200)

   APPEND-ONLY MODEL (important):
     * The table records what happened and must never be rewritten.
       There is deliberately NO UPDATE or DELETE procedure, and neither
       the API nor any module SP path exposes one ("no public write
       endpoint by design" — rows are written by server code only,
       through recordAudit -> spWriteAudit).
     * spWriteAudit performs INSERTs only. Nothing in this script ever
       modifies or removes existing audit rows.
     * Recommended (optional) per-environment hardening once the app
       login is known — run manually, NOT from bootstrap:
         DENY UPDATE, DELETE ON dbo.auditLog TO <app_login>;

   Idempotency:
     Table and indexes are created only if missing (IF OBJECT_ID /
     IF NOT EXISTS sys.indexes guards); procedures are CREATE OR ALTER.
     Safe to re-run at any time.

   Error contract (THROW numbers surface as node-mssql err.number):
       51001  Metadata is not valid JSON (non-null metadata must pass ISJSON)
       51002  Action and EntityType are required (write path)

   NOTE: No test EXECUTE statements are included on purpose — the script
         is safe to re-run at any time.
   ===================================================================== */

/* ----------------------------------------------------------------------------
   auditLog — immutable audit trail rows.

   Column limits (enforced here, mirrored by src/Modules/Data/recordAudit.ts):
     logId       VARCHAR(50)    GUID (36 chars)
     actorUserId VARCHAR(50)    NULL = action performed by the system itself
     action      VARCHAR(50)    standard vocabulary, e.g. 'CAR_ADDED'
     entityType  VARCHAR(30)    entity kind, e.g. 'CAR', 'PASSPORT', 'TX'
     entityId    VARCHAR(50)    NULL = action not tied to a single entity
     metadata    NVARCHAR(MAX)  optional JSON document, ISJSON-validated
     createdAt   DATETIME2      UTC, set by DEFAULT (never client-supplied)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.auditLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.auditLog
    (
        logId       VARCHAR(50)    NOT NULL
            CONSTRAINT PK_auditLog PRIMARY KEY,
        actorUserId VARCHAR(50)    NULL,
        action      VARCHAR(50)    NOT NULL,
        entityType  VARCHAR(30)    NOT NULL,
        entityId    VARCHAR(50)    NULL,
        metadata    NVARCHAR(MAX)  NULL,
        createdAt   DATETIME2      NOT NULL
            CONSTRAINT DF_auditLog_createdAt DEFAULT (SYSUTCDATETIME())
    );
END;
GO

/* Index for SpGetAuditByEntity: all audit rows of one entity. */
IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_auditLog_EntityType_EntityId'
      AND object_id = OBJECT_ID(N'dbo.auditLog')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_auditLog_EntityType_EntityId
        ON dbo.auditLog (entityType, entityId);
END;
GO

/* Index for spGetRecentAudit: newest-first scans of the whole trail. */
IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_auditLog_CreatedAt'
      AND object_id = OBJECT_ID(N'dbo.auditLog')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_auditLog_CreatedAt
        ON dbo.auditLog (createdAt);
END;
GO

/* =====================================================================
   spWriteAudit — append one audit row (INSERT only; no UPDATE/DELETE).
   Called by: src/Modules/Data/recordAudit.ts (server-side helper).
   Payload:   { LogId, ActorUserId, Action, EntityType, EntityId, Metadata }

   Behaviour:
     1. Validates required fields (Action, EntityType).
     2. Rejects (THROW 51001) non-null @Metadata that is not valid JSON
        — the audit trail must stay machine-queryable.
     3. INSERTs exactly one row. @LogId may be left empty, in which case
        a server-side NEWID() GUID is used. @CreatedAt is set by the
        table DEFAULT (SYSUTCDATETIME) — never client-supplied.

   Callers treat failures as non-fatal (fire-and-forget in recordAudit),
   but the procedure itself FAILS LOUDLY rather than writing a malformed
   row — an audit entry that cannot be written is reported, never faked.
   ===================================================================== */
CREATE OR ALTER PROCEDURE spWriteAudit
    @LogId       VARCHAR(50),
    @ActorUserId VARCHAR(50)   = NULL,
    @Action      VARCHAR(50),
    @EntityType  VARCHAR(30),
    @EntityId    VARCHAR(50)   = NULL,
    @Metadata    NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- 1. Defensive validation (the helper pre-validates, but the audit
    --    trail must not rely on that).
    IF @Action IS NULL OR LTRIM(RTRIM(@Action)) = ''
       OR @EntityType IS NULL OR LTRIM(RTRIM(@EntityType)) = ''
    BEGIN
        THROW 51002, 'Action and EntityType are required', 1;
    END;

    -- 2. Non-null metadata must be a valid JSON document.
    IF @Metadata IS NOT NULL AND ISJSON(@Metadata) = 0
    BEGIN
        THROW 51001, 'Metadata must be a valid JSON document', 1;
    END;

    -- 3. Append the row. INSERT is the only DML this procedure contains.
    INSERT INTO dbo.auditLog
    (
        logId,
        actorUserId,
        action,
        entityType,
        entityId,
        metadata
    )
    VALUES
    (
        ISNULL(NULLIF(LTRIM(RTRIM(@LogId)), ''), CONVERT(VARCHAR(50), NEWID())),
        NULLIF(LTRIM(RTRIM(@ActorUserId)), ''),
        LTRIM(RTRIM(@Action)),
        LTRIM(RTRIM(@EntityType)),
        NULLIF(LTRIM(RTRIM(@EntityId)), ''),
        @Metadata
    );
END;
GO

/* =====================================================================
   SpGetAuditByEntity
   Called by: GET /api/v1/data/audit?entityType=&entityId=  (admin only)
   Payload:   { EntityType, EntityId }
   Returns every audit row for the entity (entityType + optional
   entityId), newest first. When @EntityId is NULL/empty, ALL rows of
   that entityType are returned. Unknown entity -> empty recordset.
   ===================================================================== */
CREATE OR ALTER PROCEDURE SpGetAuditByEntity
    @EntityType VARCHAR(30),
    @EntityId   VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        logId       AS logId,
        actorUserId AS actorUserId,
        action      AS action,
        entityType  AS entityType,
        entityId    AS entityId,
        metadata    AS metadata,
        createdAt   AS createdAt
    FROM dbo.auditLog
    WHERE entityType = LTRIM(RTRIM(@EntityType))
      AND (@EntityId IS NULL OR entityId = @EntityId)
    ORDER BY createdAt DESC;
END;
GO

/* =====================================================================
   spGetRecentAudit
   Called by: GET /api/v1/data/audit/recent?top=50  (admin only)
   Payload:   { Top }
   Returns the newest @Top audit rows, newest first. @Top is clamped
   to 1..200 server-side (the controller clamps too — belt and braces);
   NULL/missing @Top defaults to 50.
   ===================================================================== */
CREATE OR ALTER PROCEDURE spGetRecentAudit
    @Top INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    IF @Top IS NULL SET @Top = 50;
    IF @Top < 1   SET @Top = 1;
    IF @Top > 200 SET @Top = 200;

    SELECT TOP (@Top)
        logId       AS logId,
        actorUserId AS actorUserId,
        action      AS action,
        entityType  AS entityType,
        entityId    AS entityId,
        metadata    AS metadata,
        createdAt   AS createdAt
    FROM dbo.auditLog
    ORDER BY createdAt DESC;
END;
GO
