/* =====================================================================
   RYNEX — database/extensions/finance.sql
   ---------------------------------------------------------------------
   Module:  Finance (protected transactions & escrow)
   Issue:   #19  ·  Spec: Protected Transactions #33, Transaction State
            Machine #34, Payment Integrations #35, Digital Deal Room #43
   API:     services/vehicles-api/src/Modules/Finance/ (mounted at
            /api/v1/finance)

   Contents:
     1. transactions table
          txId      VARCHAR(50)   PK   — server-generated UUID (API side)
          userId    VARCHAR(50)   FK -> users(userId)        NOT NULL
          carId     VARCHAR(50)   FK -> Cars(carId), NULL    (NULL for
                    non-car services; car purchases link the vehicle)
          amount    DECIMAL(12,2) NOT NULL, CHECK (amount > 0)
          currency  CHAR(3)       NOT NULL DEFAULT 'KES'
          provider  VARCHAR(20)   NOT NULL CHECK IN
                    ('MPESA','CARD','ESCROW')
          status    VARCHAR(20)   NOT NULL DEFAULT 'INITIATED' CHECK IN
                    ('INITIATED','PENDING','HELD','RELEASED',
                     'REFUNDED','FAILED')
          reference VARCHAR(100)  NULL — provider/psp reference, filled
                    later by the payment integration (NOT by the client)
          createdAt DATETIME2     DEFAULT SYSUTCDATETIME()
          updatedAt DATETIME2     DEFAULT SYSUTCDATETIME()

     2. Stored procedures (all CREATE OR ALTER -> idempotent, no test
        EXECUTEs at the bottom, SET NOCOUNT ON everywhere):
          spInitiateTransaction (@TxId,@UserId,@CarId,@Amount,@Provider)
          SpGetMyTransactions   (@UserId)                 newest first
          spGetTransaction      (@TxId)                   single row
          spUpdateTransactionStatus (@TxId,@NewStatus)    escrow state
                                machine, see transition table below

   Escrow state machine (enforced in spUpdateTransactionStatus):

        INITIATED --> PENDING --> HELD --> RELEASED   (deal closed)
             |             |          +--> REFUNDED   (deal reversed)
             +-> FAILED    +-> FAILED
        RELEASED / REFUNDED / FAILED are TERMINAL (no further moves).

   Error contract (THROW numbers surface as node-mssql err.number; the
   Finance controller maps them to HTTP responses):
     50901  Invalid payment provider                      -> 400
     50902  Invalid transaction transition                -> 409
     50903  Transaction not found                         -> 404
     50904  Car not found or unavailable                  -> 404
     50905  User not found                                -> 404
     50906  Invalid transaction parameters (missing TxId /
            UserId, non-positive amount)                 -> 400

   SECURITY MODEL (never trust the client):
     - txId is generated server-side (uuid v4 in the controller), never
       accepted from the request body.
     - status is NEVER set directly by INSERT — rows always start at
       'INITIATED' and may only move through spUpdateTransactionStatus,
       which enforces the transition table above (admin-only endpoint).
     - v1 note: the API accepts explicit amounts for non-car services,
       but car purchases (carId supplied) will have their price resolved
       server-side from Cars in production, exactly like the cart module
       does. See the TODO in finance.controller.ts and the module README.

   Dependency: requires the users and Cars tables from
   database/schema_tables.sql (master.sql runs schema first).
   ===================================================================== */

/* ----------------------------------------------------------------------------
   1. transactions — protected payments / escrow ledger rows
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.transactions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.transactions
    (
        txId      VARCHAR(50)    NOT NULL
            CONSTRAINT PK_transactions PRIMARY KEY,
        userId    VARCHAR(50)    NOT NULL,
        carId     VARCHAR(50)    NULL,          -- NULL for non-car services
        amount    DECIMAL(12,2)  NOT NULL
            CONSTRAINT CK_transactions_amount_positive CHECK (amount > 0),
        currency  CHAR(3)        NOT NULL
            CONSTRAINT DF_transactions_currency DEFAULT ('KES'),
        provider  VARCHAR(20)    NOT NULL
            CONSTRAINT CK_transactions_provider
            CHECK (provider IN ('MPESA','CARD','ESCROW')),
        status    VARCHAR(20)    NOT NULL
            CONSTRAINT DF_transactions_status DEFAULT ('INITIATED')
            CONSTRAINT CK_transactions_status
            CHECK (status IN ('INITIATED','PENDING','HELD','RELEASED','REFUNDED','FAILED')),
        reference VARCHAR(100)   NULL,          -- PSP reference; never client-supplied
        createdAt DATETIME2      NOT NULL
            CONSTRAINT DF_transactions_createdAt DEFAULT (SYSUTCDATETIME()),
        updatedAt DATETIME2      NOT NULL
            CONSTRAINT DF_transactions_updatedAt DEFAULT (SYSUTCDATETIME())
    );
END;
GO

/* Foreign keys are added separately (guarded) so partially-provisioned
   databases are repaired on re-run instead of silently staying broken. */
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_transactions_users')
BEGIN
    ALTER TABLE dbo.transactions WITH CHECK
        ADD CONSTRAINT FK_transactions_users
        FOREIGN KEY (userId) REFERENCES dbo.users (userId)
        ON DELETE NO ACTION;   -- keep the ledger: payments outlive accounts
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_transactions_cars')
BEGIN
    ALTER TABLE dbo.transactions WITH CHECK
        ADD CONSTRAINT FK_transactions_cars
        FOREIGN KEY (carId) REFERENCES dbo.Cars (carId)
        ON DELETE NO ACTION;
END;
GO

/* Owner listing (SpGetMyTransactions orders by createdAt DESC). */
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_transactions_user_created' AND object_id = OBJECT_ID(N'dbo.transactions'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_transactions_user_created
        ON dbo.transactions (userId, createdAt DESC);
END;
GO

/* Admin queue scans by escrow state (e.g. all HELD transactions). */
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_transactions_status' AND object_id = OBJECT_ID(N'dbo.transactions'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_transactions_status
        ON dbo.transactions (status);
END;
GO

/* =====================================================================
   spInitiateTransaction
   Called by: POST /api/v1/finance/transactions (initiateTransaction)
   Payload from controller: { TxId, UserId, CarId?, Amount, Provider }
   Behaviour:
     1. Validates required params and the amount (THROW 50906) and the
        provider whitelist (THROW 50901) — the DB must not rely on the
        API's Joi validation alone.
     2. Verifies the user exists (THROW 50905).
     3. When @CarId is supplied it must be a live (non-deleted) car
        (THROW 50904).
        TODO(PRODUCTION): for car purchases the price must be resolved
        server-side from Cars.prices (as the cart module already does);
        v1 still accepts the API-supplied amount for audit purposes.
     4. INSERTs the row with status left at its 'INITIATED' default —
        the client can never seed an advanced escrow state — and
        returns the new row (recordset[0]).
   ===================================================================== */
CREATE OR ALTER PROCEDURE spInitiateTransaction
    @TxId     VARCHAR(50),
    @UserId   VARCHAR(50),
    @CarId    VARCHAR(50) = NULL,
    @Amount   DECIMAL(12,2),
    @Provider VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        -- 1. Defensive parameter validation (controller pre-validates,
        --    but the database must not rely on that).
        IF @TxId IS NULL OR LTRIM(RTRIM(@TxId)) = ''
           OR @UserId IS NULL OR LTRIM(RTRIM(@UserId)) = ''
        BEGIN
            THROW 50906, 'TxId and UserId are required', 1;
        END;

        IF @Provider IS NULL
           OR @Provider NOT IN ('MPESA','CARD','ESCROW')
        BEGIN
            THROW 50901, 'Invalid payment provider', 1;
        END;

        IF @Amount IS NULL OR @Amount <= 0
        BEGIN
            THROW 50906, 'Invalid transaction parameters', 1;
        END;

        -- 2. The paying user must exist (the FK would catch it too, but
        --    a THROW gives the API a clean 404 instead of a raw FK 500).
        IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE userId = @UserId)
        BEGIN
            THROW 50905, 'User not found', 1;
        END;

        -- 3. Car purchases must reference a live car.
        IF @CarId IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM dbo.Cars
               WHERE carId = @CarId
                 AND ISNULL(isDeleted, 0) = 0
           )
        BEGIN
            THROW 50904, 'Car not found or unavailable', 1;
        END;

        -- TODO(PRODUCTION): resolve @Amount from Cars.prices when
        -- @CarId IS NOT NULL (see module README, "Security notes").

        -- 4. status/currency/timestamps take their column defaults;
        --    'INITIATED' is the only valid starting state.
        INSERT INTO dbo.transactions (txId, userId, carId, amount, provider)
        VALUES (@TxId, @UserId, @CarId, @Amount, @Provider);
    END TRY
    BEGIN CATCH
        THROW;  -- rethrow with original number (50901/50904/50905/50906/...)
    END CATCH;

    -- Return the freshly created row (controller reads recordset[0]).
    SELECT
        txId      AS txId,
        userId    AS userId,
        carId     AS carId,
        amount    AS amount,
        currency  AS currency,
        provider  AS provider,
        status    AS status,
        reference AS reference,
        createdAt AS createdAt,
        updatedAt AS updatedAt
    FROM dbo.transactions
    WHERE txId = @TxId;
END;
GO

/* =====================================================================
   SpGetMyTransactions
   Called by: GET /api/v1/finance/transactions/mine (getMyTransactions)
   Payload from controller: { UserId }
   Returns ALL of the user's transactions, newest first (createdAt DESC,
   txId DESC as a deterministic tiebreaker). Unknown user -> empty
   recordset (the API renders that as an empty list, not an error).
   ===================================================================== */
CREATE OR ALTER PROCEDURE SpGetMyTransactions
    @UserId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        txId      AS txId,
        userId    AS userId,
        carId     AS carId,
        amount    AS amount,
        currency  AS currency,
        provider  AS provider,
        status    AS status,
        reference AS reference,
        createdAt AS createdAt,
        updatedAt AS updatedAt
    FROM dbo.transactions
    WHERE userId = @UserId
    ORDER BY createdAt DESC, txId DESC;
END;
GO

/* =====================================================================
   spGetTransaction
   Called by: GET /api/v1/finance/transactions/:txId (getTransaction)
   Payload from controller: { TxId }
   Returns the single transaction row, or an empty recordset when the
   txId does not exist (the controller maps that to 404; ownership and
   admin checks happen in the controller, which knows the JWT).
   ===================================================================== */
CREATE OR ALTER PROCEDURE spGetTransaction
    @TxId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        txId      AS txId,
        userId    AS userId,
        carId     AS carId,
        amount    AS amount,
        currency  AS currency,
        provider  AS provider,
        status    AS status,
        reference AS reference,
        createdAt AS createdAt,
        updatedAt AS updatedAt
    FROM dbo.transactions
    WHERE txId = @TxId;
END;
GO

/* =====================================================================
   spUpdateTransactionStatus
   Called by: PATCH /api/v1/finance/transactions/:txId/status (admin)
   Payload from controller: { TxId, NewStatus }
   Enforces the escrow state machine:

     INITIATED -> PENDING | FAILED
     PENDING   -> HELD    | FAILED
     HELD      -> RELEASED | REFUNDED
     RELEASED / REFUNDED / FAILED  -> terminal (no outgoing edges)

   Any other move — including unknown target states and terminal
   states — THROWs 50902 'Invalid transaction transition' (HTTP 409);
   an unknown txId THROWs 50903 'Transaction not found' (HTTP 404).
   The status read + update happen inside one transaction with
   UPDLOCK + HOLDLOCK so two concurrent admin PATCHes can never race
   past the transition guard. updatedAt is refreshed on every move.
   Returns the updated row (recordset[0]).
   ===================================================================== */
CREATE OR ALTER PROCEDURE spUpdateTransactionStatus
    @TxId      VARCHAR(50),
    @NewStatus VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @CurrentStatus VARCHAR(20);

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Serialize concurrent transitions on the same row.
        SELECT @CurrentStatus = status
        FROM dbo.transactions WITH (UPDLOCK, HOLDLOCK)
        WHERE txId = @TxId;

        IF @CurrentStatus IS NULL
        BEGIN
            THROW 50903, 'Transaction not found', 1;
        END;

        IF NOT (
               (@CurrentStatus = 'INITIATED' AND @NewStatus IN ('PENDING','FAILED'))
            OR (@CurrentStatus = 'PENDING'   AND @NewStatus IN ('HELD','FAILED'))
            OR (@CurrentStatus = 'HELD'      AND @NewStatus IN ('RELEASED','REFUNDED'))
        )
        BEGIN
            -- Covers unknown states, terminal states and every
            -- non-listed edge (e.g. HELD -> PENDING, INITIATED -> HELD,
            -- RELEASED -> anything).
            THROW 50902, 'Invalid transaction transition', 1;
        END;

        UPDATE dbo.transactions
        SET status    = @NewStatus,
            updatedAt = SYSUTCDATETIME()
        WHERE txId = @TxId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
        BEGIN
            ROLLBACK TRANSACTION;
        END;

        THROW;  -- rethrow with original number (50902/50903/...)
    END CATCH;

    -- Return the updated row (controller reads recordset[0]).
    SELECT
        txId      AS txId,
        userId    AS userId,
        carId     AS carId,
        amount    AS amount,
        currency  AS currency,
        provider  AS provider,
        status    AS status,
        reference AS reference,
        createdAt AS createdAt,
        updatedAt AS updatedAt
    FROM dbo.transactions
    WHERE txId = @TxId;
END;
GO
