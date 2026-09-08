/* ============================================================================
   RYNEX PLATFORM EXTENSION — Passport (vehicle digital identity & provenance)
   -----------------------------------------------------------------------------
   Issue:   Closes #14 (Rynex Passport — vehicle identity & provenance)
   Module:  services/vehicles-api/src/Modules/Passport/
   Depends: dbo.Cars from schema_tables.sql (run schema + master bootstrap
            first; master.sql includes this file AFTER schema_tables.sql).

   WHAT IT CREATES
     Tables (guarded with IF OBJECT_ID — safe to re-run, never destructive):
       dbo.vehiclePassports  one digital identity per vehicle (carId UNIQUE)
       dbo.passportEvents    append-only provenance timeline per passport

     Procedures (CREATE OR ALTER):
       spCreatePassport(@PassportId, @CarId, @Vin, @FirstRegisteredAt)
         Issues a passport for an existing catalogue car.
         THROW 50401 'Car not found'           -> controller answers 404
         THROW 50402 'Passport already exists' -> controller answers 409
         Returns the inserted row (ownerCount/status/createdAt come from the
         table defaults: 1 / 'ACTIVE' / SYSUTCDATETIME()).

       spGetPassport(@CarId)
         Two recordsets: (1) the passport row, (2) its provenance events
         ordered occurredAt DESC (createdAt DESC as a deterministic
         tie-breaker for events recorded at the same instant).
         Missing passport -> two EMPTY recordsets (no error); the controller
         maps that to 404, mirroring the getOneCar convention.

       spAddPassportEvent(@CarId, @EventType, @Description, @OccurredAt,
                          @RecordedBy)
         Appends one event to the passport of @CarId.
         THROW 50403 'Invalid event type' -> controller answers 400
         THROW 50401 'Passport not found' -> controller answers 404
         eventId is generated inside the procedure (NEWID()) because the
         append contract has no @EventId parameter; the inserted row is
         returned so callers receive the generated id.

   EVENT TAXONOMY (passportEvents.eventType)
     REGISTRATION | INSPECTION | SERVICE | TRANSFER | ACCIDENT | OWNERSHIP
     | OTHER — enforced twice: a CHECK constraint here and a whitelist in
     spAddPassportEvent (THROW 50403) so bad payloads fail fast with a clean,
     mappable error instead of a constraint violation.

   IMMUTABILITY NOTE
     Provenance is append-only ON PURPOSE: corrections are recorded as NEW
     events, never edits. There are deliberately NO UPDATE/DELETE procedures
     in this module. If a correction is needed, append a corrective event
     that references the earlier one — the timeline must keep telling the
     truth about what was recorded, and when.

   IDEMPOTENCY / SAFETY
     * IF OBJECT_ID guards for tables, IF NOT EXISTS (sys.indexes) for the
       index, CREATE OR ALTER for procedures — re-running is a no-op.
     * SET NOCOUNT ON in every procedure.
     * No test EXECUTE statements: safe to run via master.sql at any time.
   ============================================================================ */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET QUOTED_IDENTIFIER ON;
GO

/* ----------------------------------------------------------------------------
   1. vehiclePassports — one digital identity per catalogue vehicle.
      ownerCount defaults to 1 (first owner at issuance); status defaults to
      'ACTIVE'. Columns are NOT NULL with named defaults so every row is
      complete and predictable.
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.vehiclePassports', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.vehiclePassports
    (
        passportId        VARCHAR(50) NOT NULL
            CONSTRAINT PK_vehiclePassports PRIMARY KEY,
        carId             VARCHAR(50) NOT NULL,
        vin               VARCHAR(50) NULL,
        firstRegisteredAt DATETIME2   NULL,
        ownerCount        INT         NOT NULL
            CONSTRAINT DF_vehiclePassports_ownerCount DEFAULT (1),
        status            VARCHAR(20) NOT NULL
            CONSTRAINT DF_vehiclePassports_status DEFAULT ('ACTIVE'),
        createdAt         DATETIME2   NOT NULL
            CONSTRAINT DF_vehiclePassports_createdAt DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT UQ_vehiclePassports_carId UNIQUE (carId),
        CONSTRAINT FK_vehiclePassports_cars FOREIGN KEY (carId)
            REFERENCES dbo.Cars (carId)
    );
END;
GO

/* ----------------------------------------------------------------------------
   2. passportEvents — append-only provenance timeline (no UPDATE/DELETE
      surface is provided on purpose; see the immutability note above).
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.passportEvents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.passportEvents
    (
        eventId     VARCHAR(50)   NOT NULL
            CONSTRAINT PK_passportEvents PRIMARY KEY,
        passportId  VARCHAR(50)   NOT NULL,
        eventType   VARCHAR(30)   NOT NULL
            CONSTRAINT CK_passportEvents_eventType
            CHECK (eventType IN ('REGISTRATION','INSPECTION','SERVICE',
                                 'TRANSFER','ACCIDENT','OWNERSHIP','OTHER')),
        description NVARCHAR(500) NOT NULL,
        occurredAt  DATETIME2     NOT NULL,
        recordedBy  VARCHAR(50)   NULL,
        createdAt   DATETIME2     NOT NULL
            CONSTRAINT DF_passportEvents_createdAt DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT FK_passportEvents_passport FOREIGN KEY (passportId)
            REFERENCES dbo.vehiclePassports (passportId)
            ON DELETE CASCADE
    );
END;
GO

/* Timeline reads filter by passport and sort by occurredAt DESC. */
IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_passportEvents_passport_occurredAt'
      AND object_id = OBJECT_ID(N'dbo.passportEvents')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_passportEvents_passport_occurredAt
        ON dbo.passportEvents (passportId, occurredAt DESC);
END;
GO

/* ============================================================================
   spCreatePassport
   Called by: POST /passport (createPassport)
   Payload from controller: { PassportId, CarId, Vin, FirstRegisteredAt }
   Issues a passport for an existing catalogue car. THROW codes are mapped
   by the controller: 50401 -> 404, 50402 -> 409.
   ============================================================================ */
CREATE OR ALTER PROCEDURE spCreatePassport
    @PassportId        VARCHAR(50),
    @CarId             VARCHAR(50),
    @Vin               VARCHAR(50) = NULL,
    @FirstRegisteredAt DATETIME2   = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- The passport must anchor to a real catalogue car.
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @CarId)
    BEGIN
        THROW 50401, 'Car not found', 1;
    END;

    -- One passport per vehicle (carId UNIQUE) and no id reuse (PK).
    IF EXISTS
    (
        SELECT 1 FROM dbo.vehiclePassports
        WHERE carId = @CarId OR passportId = @PassportId
    )
    BEGIN
        THROW 50402, 'Passport already exists', 1;
    END;

    INSERT INTO dbo.vehiclePassports
    (
        passportId,
        carId,
        vin,
        firstRegisteredAt
        -- ownerCount (1), status ('ACTIVE') and createdAt (SYSUTCDATETIME())
        -- intentionally omitted -> table defaults apply
    )
    VALUES
    (
        @PassportId,
        @CarId,
        @Vin,
        @FirstRegisteredAt
    );

    -- Return the inserted row so the controller can respond with it.
    SELECT *
    FROM dbo.vehiclePassports
    WHERE passportId = @PassportId;
END;
GO

/* ============================================================================
   spGetPassport
   Called by: GET /passport/:carId (getPassport)
   Parameter: @CarId VARCHAR(50)
   Recordset 1: the passport row (empty when the car has no passport).
   Recordset 2: the provenance events, occurredAt DESC (createdAt DESC as
                a deterministic tie-breaker for events recorded at the same
                instant).
   ============================================================================ */
CREATE OR ALTER PROCEDURE spGetPassport
    @CarId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM dbo.vehiclePassports
    WHERE carId = @CarId;

    SELECT pe.*
    FROM dbo.passportEvents AS pe
    INNER JOIN dbo.vehiclePassports AS vp
        ON vp.passportId = pe.passportId
    WHERE vp.carId = @CarId
    ORDER BY pe.occurredAt DESC, pe.createdAt DESC;
END;
GO

/* ============================================================================
   spAddPassportEvent
   Called by: POST /passport/:carId/events (addPassportEvent)
   Payload from controller:
     { CarId, EventType, Description, OccurredAt, RecordedBy }
   Validates the event type against the whitelist (THROW 50403 -> 400) and
   requires the passport to exist (THROW 50401 -> 404). The event is appended
   only — there is no update or delete path by design.
   ============================================================================ */
CREATE OR ALTER PROCEDURE spAddPassportEvent
    @CarId       VARCHAR(50),
    @EventType   VARCHAR(30),
    @Description NVARCHAR(500),
    @OccurredAt  DATETIME2,
    @RecordedBy  VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @PassportId VARCHAR(50);

    -- Whitelist the event type first so bad payloads fail fast (50403).
    IF @EventType IS NULL
       OR @EventType NOT IN ('REGISTRATION','INSPECTION','SERVICE',
                             'TRANSFER','ACCIDENT','OWNERSHIP','OTHER')
    BEGIN
        THROW 50403, 'Invalid event type', 1;
    END;

    SELECT @PassportId = passportId
    FROM dbo.vehiclePassports
    WHERE carId = @CarId;

    IF @PassportId IS NULL
    BEGIN
        THROW 50401, 'Passport not found', 1;
    END;

    DECLARE @EventId VARCHAR(50) = CONVERT(VARCHAR(50), NEWID());

    INSERT INTO dbo.passportEvents
    (
        eventId,
        passportId,
        eventType,
        description,
        occurredAt,
        recordedBy
        -- createdAt intentionally omitted -> table default (SYSUTCDATETIME())
    )
    VALUES
    (
        @EventId,
        @PassportId,
        @EventType,
        @Description,
        @OccurredAt,
        @RecordedBy
    );

    -- Return the inserted row (including the generated eventId).
    SELECT *
    FROM dbo.passportEvents
    WHERE eventId = @EventId;
END;
GO
