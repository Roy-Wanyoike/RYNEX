/* =============================================================================
   RYNEX PLATFORM EXTENSION — Service module
   database/extensions/service.sql
   -----------------------------------------------------------------------------
   Purpose:
     Service bookings for the RYNEX Service Centre Platform:
     users book a service (INSPECTION / MAINTENANCE / REPAIR / DIAGNOSTICS)
     against a catalogue car, and administrators move each booking through a
     strict status state machine (PENDING -> CONFIRMED -> IN_PROGRESS ->
     COMPLETED, with CANCELLED reachable from every active state).

   Contents:
     dbo.serviceBookings        table + supporting index (created only if absent)
     dbo.spCreateBooking        create a booking (validates type + car)
     dbo.SpGetBookingsByUser    a user's bookings, newest first
     dbo.spGetAllBookings       every booking with userName (admin view)
     dbo.spUpdateBookingStatus  state-machine transition + updatedAt bump

   State machine (enforced by spUpdateBookingStatus):
     PENDING      -> CONFIRMED | CANCELLED
     CONFIRMED    -> IN_PROGRESS | CANCELLED
     IN_PROGRESS  -> COMPLETED | CANCELLED
     COMPLETED    -> (terminal)
     CANCELLED    -> (terminal)

   Error contract (THROW numbers surface as node-mssql err.number; the
   Service controller maps them to HTTP responses):
     50701  Invalid service type (not in the CHECK list)            -> 400
     50702  Car not found or unavailable (soft-deleted)             -> 400
     50703  Invalid status transition (message lists current->new)  -> 409
     50704  Booking not found (spUpdateBookingStatus)               -> 404
     50705  Required parameters missing/null (defensive; the API
            layer pre-validates, the database must not rely on it)  -> 400

   Idempotency:
     The table is created only if it does not already exist (no destructive
     ALTERs); every procedure uses CREATE OR ALTER. Safe to re-run any number
     of times.

   Concurrency:
     spUpdateBookingStatus reads the current status under UPDLOCK + HOLDLOCK
     so two concurrent PATCHes can never both pass the transition check for
     the same booking (read-modify-write is serialized per row).

   Dependencies:
     REQUIRES dbo.users and dbo.Cars from database/schema_tables.sql (the
     master.sql bootstrap runs those long before this extension).

   NOTE: No test EXECUTE statements are included on purpose — re-running this
         script only (re)creates schema objects and touches no data.
   ============================================================================= */

/* ----------------------------------------------------------------------------
   1. serviceBookings — service centre bookings (state-machine tracked)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.serviceBookings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.serviceBookings
    (
        bookingId     VARCHAR(50)   NOT NULL
            CONSTRAINT PK_serviceBookings PRIMARY KEY,
        userId        VARCHAR(50)   NOT NULL
            CONSTRAINT FK_serviceBookings_users
                FOREIGN KEY (userId) REFERENCES dbo.users (userId)
                ON DELETE CASCADE,
        carId         VARCHAR(50)   NOT NULL
            CONSTRAINT FK_serviceBookings_cars
                FOREIGN KEY (carId) REFERENCES dbo.Cars (carId)
                ON DELETE NO ACTION,  -- cars are soft-deleted; a hard delete must not orphan service history
        serviceType   VARCHAR(30)   NOT NULL
            CONSTRAINT CK_serviceBookings_serviceType
                CHECK (serviceType IN ('INSPECTION', 'MAINTENANCE', 'REPAIR', 'DIAGNOSTICS')),
        preferredDate DATE          NOT NULL,
        status        VARCHAR(20)   NOT NULL
            CONSTRAINT DF_serviceBookings_status DEFAULT ('PENDING')
            CONSTRAINT CK_serviceBookings_status
                CHECK (status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
        notes         NVARCHAR(500) NULL,
        createdAt     DATETIME2     NOT NULL
            CONSTRAINT DF_serviceBookings_createdAt DEFAULT (SYSUTCDATETIME()),
        updatedAt     DATETIME2     NOT NULL
            CONSTRAINT DF_serviceBookings_updatedAt DEFAULT (SYSUTCDATETIME())
    );
END;
GO

/* Nonclustered index: SpGetBookingsByUser filters on userId. */
IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_serviceBookings_userId'
      AND object_id = OBJECT_ID(N'dbo.serviceBookings')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_serviceBookings_userId
        ON dbo.serviceBookings (userId);
END;
GO

/* =============================================================================
   2. spCreateBooking
   Called by: POST /api/v1/service/bookings (createBooking)
   Payload from controller: { BookingId, UserId, CarId, ServiceType,
                              PreferredDate, Notes }
   Behaviour:
     1. Defensive parameter validation (THROW 50705 when required values are
        missing — the controller pre-validates, but the database must not
        rely on that).
     2. Validates @ServiceType against the supported list (THROW 50701).
     3. Validates that the car exists and is not soft-deleted (THROW 50702);
        car identity is resolved against Cars, never trusted from the client.
     4. INSERTs the booking with status = DEFAULT 'PENDING' and returns the
        created row joined with Cars (model, brand) + users (userName), so
        the API answer has the same shape as the read procedures.
     Notes on @UserId: referential integrity is enforced by the
     FK_serviceBookings_users constraint — a stale/unknown JWT subject fails
     the INSERT (server-side integrity, not client input validation).
   ============================================================================= */
CREATE OR ALTER PROCEDURE dbo.spCreateBooking
    @BookingId     VARCHAR(50),
    @UserId        VARCHAR(50),
    @CarId         VARCHAR(50),
    @ServiceType   VARCHAR(30),
    @PreferredDate DATE,
    @Notes         NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        -- 1. Required parameters.
        IF @BookingId IS NULL OR LTRIM(RTRIM(@BookingId)) = ''
           OR @UserId IS NULL OR LTRIM(RTRIM(@UserId)) = ''
           OR @CarId IS NULL OR LTRIM(RTRIM(@CarId)) = ''
           OR @ServiceType IS NULL OR LTRIM(RTRIM(@ServiceType)) = ''
           OR @PreferredDate IS NULL
        BEGIN
            THROW 50705, 'BookingId, UserId, CarId, ServiceType and PreferredDate are required', 1;
        END;

        -- 2. Service type must be one of the supported values.
        IF @ServiceType NOT IN ('INSPECTION', 'MAINTENANCE', 'REPAIR', 'DIAGNOSTICS')
        BEGIN
            THROW 50701, 'Invalid service type. Allowed values: INSPECTION, MAINTENANCE, REPAIR, DIAGNOSTICS', 1;
        END;

        -- 3. The car must exist and must not be soft-deleted.
        IF NOT EXISTS
        (
            SELECT 1
            FROM dbo.Cars
            WHERE carId = @CarId
              AND ISNULL(isDeleted, 0) = 0
        )
        BEGIN
            THROW 50702, 'Car not found or unavailable', 1;
        END;

        -- 4. Create the booking (status defaults to 'PENDING').
        INSERT INTO dbo.serviceBookings
        (
            bookingId,
            userId,
            carId,
            serviceType,
            preferredDate,
            notes
        )
        VALUES
        (
            @BookingId,
            @UserId,
            @CarId,
            @ServiceType,
            @PreferredDate,
            @Notes
        );
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
        BEGIN
            ROLLBACK TRANSACTION;
        END;

        THROW;  -- rethrow with the original number (50701/50702/50705/...)
    END CATCH;

    -- 5. Return the created row joined with Cars + users.
    SELECT
        b.bookingId     AS bookingId,
        b.userId        AS userId,
        u.userName      AS userName,
        b.carId         AS carId,
        c.model         AS model,
        c.brand         AS brand,
        b.serviceType   AS serviceType,
        b.preferredDate AS preferredDate,
        b.status        AS status,
        b.notes         AS notes,
        b.createdAt     AS createdAt,
        b.updatedAt     AS updatedAt
    FROM dbo.serviceBookings AS b
    LEFT JOIN dbo.Cars AS c
        ON c.carId = b.carId
    LEFT JOIN dbo.users AS u
        ON u.userId = b.userId
    WHERE b.bookingId = @BookingId;
END;
GO

/* =============================================================================
   3. SpGetBookingsByUser
   Called by: GET /api/v1/service/bookings (getMyBookings)
   Payload from controller: { UserId }
   Returns the authenticated user's bookings joined with Cars (model, brand),
   newest first (createdAt DESC). Unknown/empty user -> empty recordset.
   ============================================================================= */
CREATE OR ALTER PROCEDURE dbo.SpGetBookingsByUser
    @UserId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        b.bookingId     AS bookingId,
        b.userId        AS userId,
        b.carId         AS carId,
        c.model         AS model,
        c.brand         AS brand,
        b.serviceType   AS serviceType,
        b.preferredDate AS preferredDate,
        b.status        AS status,
        b.notes         AS notes,
        b.createdAt     AS createdAt,
        b.updatedAt     AS updatedAt
    FROM dbo.serviceBookings AS b
    LEFT JOIN dbo.Cars AS c
        ON c.carId = b.carId
    WHERE b.userId = @UserId
    ORDER BY b.createdAt DESC;
END;
GO

/* =============================================================================
   4. spGetAllBookings
   Called by: GET /api/v1/service/bookings/all (getAllBookings — admin only)
   No parameters. Returns every booking joined with Cars (model, brand) and
   users (userName), newest first (createdAt DESC). LEFT JOINs guarantee every
   booking row is listed even if a joined parent is missing.
   ============================================================================= */
CREATE OR ALTER PROCEDURE dbo.spGetAllBookings
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        b.bookingId     AS bookingId,
        b.userId        AS userId,
        u.userName      AS userName,
        b.carId         AS carId,
        c.model         AS model,
        c.brand         AS brand,
        b.serviceType   AS serviceType,
        b.preferredDate AS preferredDate,
        b.status        AS status,
        b.notes         AS notes,
        b.createdAt     AS createdAt,
        b.updatedAt     AS updatedAt
    FROM dbo.serviceBookings AS b
    LEFT JOIN dbo.Cars AS c
        ON c.carId = b.carId
    LEFT JOIN dbo.users AS u
        ON u.userId = b.userId
    ORDER BY b.createdAt DESC;
END;
GO

/* =============================================================================
   5. spUpdateBookingStatus
   Called by: PATCH /api/v1/service/bookings/:bookingId/status
              (updateBookingStatus — admin only)
   Payload from controller: { BookingId, NewStatus }
   Behaviour:
     1. Defensive parameter validation (THROW 50705).
     2. Fetches the current status under UPDLOCK + HOLDLOCK (serializes
        concurrent transitions of the same booking) — unknown booking
        THROWs 50704.
     3. Enforces the state machine (THROW 50703 'Invalid status transition:
        <current> -> <new>' when the move is not allowed; terminal states
        COMPLETED / CANCELLED reject everything, including no-op moves).
     4. UPDATEs status + updatedAt and returns the updated row joined with
        Cars + users (controller reads recordset[0]).

   Allowed transitions:
     PENDING      -> CONFIRMED | CANCELLED
     CONFIRMED    -> IN_PROGRESS | CANCELLED
     IN_PROGRESS  -> COMPLETED | CANCELLED
     COMPLETED    -> (terminal)
     CANCELLED    -> (terminal)
   ============================================================================= */
CREATE OR ALTER PROCEDURE dbo.spUpdateBookingStatus
    @BookingId VARCHAR(50),
    @NewStatus VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @CurrentStatus VARCHAR(20);
    DECLARE @Message       NVARCHAR(2048);

    BEGIN TRY
        -- 1. Required parameters.
        IF @BookingId IS NULL OR LTRIM(RTRIM(@BookingId)) = ''
           OR @NewStatus IS NULL OR LTRIM(RTRIM(@NewStatus)) = ''
        BEGIN
            THROW 50705, 'BookingId and NewStatus are required', 1;
        END;

        BEGIN TRANSACTION;

        -- 2. Lock the booking row for the read-modify-write so two concurrent
        --    PATCHes cannot both pass the transition check.
        SELECT @CurrentStatus = status
        FROM dbo.serviceBookings WITH (UPDLOCK, HOLDLOCK)
        WHERE bookingId = @BookingId;

        IF @CurrentStatus IS NULL
        BEGIN
            THROW 50704, 'Booking not found', 1;
        END;

        -- 3. Enforce the state machine. A @NewStatus outside the supported
        --    list is also a 50703 (the controller pre-validates with Joi;
        --    this is the database-side safety net).
        IF NOT
        (
            (@CurrentStatus = 'PENDING'        AND @NewStatus IN ('CONFIRMED', 'CANCELLED'))
            OR (@CurrentStatus = 'CONFIRMED'   AND @NewStatus IN ('IN_PROGRESS', 'CANCELLED'))
            OR (@CurrentStatus = 'IN_PROGRESS' AND @NewStatus IN ('COMPLETED', 'CANCELLED'))
        )
        BEGIN
            SET @Message = CONCAT(N'Invalid status transition: ', @CurrentStatus, N' -> ', @NewStatus);
            THROW 50703, @Message, 1;
        END;

        -- 4. Apply the transition.
        UPDATE dbo.serviceBookings
        SET status    = @NewStatus,
            updatedAt = SYSUTCDATETIME()
        WHERE bookingId = @BookingId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
        BEGIN
            ROLLBACK TRANSACTION;
        END;

        THROW;  -- rethrow with the original number (50703/50704/50705/...)
    END CATCH;

    -- 5. Return the updated row joined with Cars + users.
    SELECT
        b.bookingId     AS bookingId,
        b.userId        AS userId,
        u.userName      AS userName,
        b.carId         AS carId,
        c.model         AS model,
        c.brand         AS brand,
        b.serviceType   AS serviceType,
        b.preferredDate AS preferredDate,
        b.status        AS status,
        b.notes         AS notes,
        b.createdAt     AS createdAt,
        b.updatedAt     AS updatedAt
    FROM dbo.serviceBookings AS b
    LEFT JOIN dbo.Cars AS c
        ON c.carId = b.carId
    LEFT JOIN dbo.users AS u
        ON u.userId = b.userId
    WHERE b.bookingId = @BookingId;
END;
GO
