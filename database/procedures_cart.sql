/* =====================================================================
   procedures_cart.sql
   ---------------------------------------------------------------------
   Purpose:
     Hardened stored procedures for the shopping cart, matching the
     fixed cart controller (Backend/src/Controller/cartController.ts)
     and the tables defined in Backend/Database/schema_tables.sql:

       cart (cardID VARCHAR(50) PK,
             userId VARCHAR(50) FK -> users(userId),
             carId  VARCHAR(50) FK -> Cars(carId),
             carBrand VARCHAR(50),
             prices DECIMAL(10,2),
             quantity INT DEFAULT 1,
             UNIQUE (userId, carId))

       Cars (carId VARCHAR(50) PK,
             model VARCHAR(100),
             brand VARCHAR(50),
             prices DECIMAL(10,2),
             pictureUrl VARCHAR(255),
             isDeleted BIT)

       users (userId VARCHAR(50) PK, userName VARCHAR(50))

     SECURITY MODEL (never trust the client):
       - spAddToCart derives carBrand and prices from the Cars table and
         generates cardID via NEWID() server-side; the client may only
         supply carId + quantity (plus its authenticated userId).
       - Upsert on (userId, carId): re-adding the same car MERGES into
         quantity instead of creating a new row.

     Procedures created here:
       spAddToCart      (@UserId, @CarId, @Quantity)
                        -> validates the car, upserts the cart row inside
                           a transaction (TRY...CATCH + THROW), returns the
                           resulting row joined with Cars (recordset[0])
       spGetCartByUser  (@UserId)
                        -> the user's cart rows joined with Cars,
                           ordered by model
       AddCar           (@CardID)
                        -> quantity = quantity + 1 for that cardID ONLY
                           (legacy version had no WHERE and updated every
                           row!); returns the updated row, or an empty
                           recordset when cardID does not exist
       SubtractCar      (@CardID)
                        -> quantity - 1 while quantity > 1, otherwise
                           DELETEs the row; returns the remaining row
                           (empty recordset when deleted)
       spGetAllCart     ()
                        -> every cart row joined with Cars (model,
                           pictureUrl) and users (userName), for the
                           admin GET /cart/all endpoint, ordered by
                           userName then model

     Error contract (THROW numbers surface as node-mssql err.number;
     the controller maps any of them to a generic 500 response):
       50001  Car not found or unavailable
       50002  Invalid quantity (must be a positive integer)
       50003  UserId and CarId are required
   ---------------------------------------------------------------------
   Dependency:
     REQUIRES the cart / Cars / users tables from
     Backend/Database/schema_tables.sql (run schema_tables.sql FIRST,
     then this file).
   ---------------------------------------------------------------------
   Execution (sqlcmd):
     sqlcmd -S <server> -d carOrders -U <user> -P <password> ^
            -i "Backend/Database/schema_tables.sql"
     sqlcmd -S <server> -d carOrders -U <user> -P <password> ^
            -i "Backend/Database/procedures_cart.sql"

     (On Linux/macOS use "\" line continuation or put everything on one
      line. Adjust -S/-d/-U/-P to your environment; alternatively
      uncomment the USE statement below.)
   ---------------------------------------------------------------------
   NOTE: No test EXECUTE statements are included in this script on
         purpose — it is safe to re-run at any time (CREATE OR ALTER).
   ===================================================================== */

-- USE carOrders;  -- optional: uncomment if not specifying the database via sqlcmd -d
GO

/* =====================================================================
   spAddToCart
   Called by: POST /cart (addProductsToCart)
   Payload from controller: { UserId, CarId, Quantity }
   Behaviour:
     1. Validates params and quantity.
     2. Rejects (THROW 50001) when the car does not exist or is
        soft-deleted — brand/price are then read from Cars, never from
        the client.
     3. Upsert on (userId, carId) inside a serializable read
        (UPDLOCK + HOLDLOCK): existing row -> quantity += @Quantity;
        otherwise INSERT a new row with a server-generated cardID
        (CONVERT(VARCHAR(50), NEWID())).
     4. COMMIT; returns the resulting cart row joined with Cars:
        cardID, carId, model, carBrand, prices, quantity, pictureUrl.
   ===================================================================== */
CREATE OR ALTER PROCEDURE spAddToCart
    @UserId   VARCHAR(50),
    @CarId    VARCHAR(50),
    @Quantity INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ExistingCardID VARCHAR(50);

    BEGIN TRY
        -- 1. Defensive parameter validation (controller pre-validates,
        --    but the database must not rely on that).
        IF @UserId IS NULL OR LTRIM(RTRIM(@UserId)) = ''
           OR @CarId IS NULL OR LTRIM(RTRIM(@CarId)) = ''
        BEGIN
            THROW 50003, 'UserId and CarId are required', 1;
        END;

        IF @Quantity IS NULL OR @Quantity <= 0
        BEGIN
            THROW 50002, 'Invalid quantity', 1;
        END;

        -- 2. The car must exist and must not be soft-deleted.
        --    carBrand + prices are read from Cars below; the client is
        --    never trusted for pricing data.
        IF NOT EXISTS (
            SELECT 1
            FROM Cars
            WHERE carId = @CarId
              AND ISNULL(isDeleted, 0) = 0
        )
        BEGIN
            THROW 50001, 'Car not found or unavailable', 1;
        END;

        -- 3. Upsert on (userId, carId). UPDLOCK + HOLDLOCK serializes
        --    concurrent adds for the same user+car so the UNIQUE key can
        --    never be violated by a race between two INSERTs.
        BEGIN TRANSACTION;

        SELECT @ExistingCardID = cardID
        FROM cart WITH (UPDLOCK, HOLDLOCK)
        WHERE userId = @UserId
          AND carId = @CarId;

        IF @ExistingCardID IS NOT NULL
        BEGIN
            -- Merge: add to the existing row only (scoped WHERE).
            UPDATE cart
            SET quantity = quantity + @Quantity
            WHERE cardID = @ExistingCardID;
        END
        ELSE
        BEGIN
            INSERT INTO cart
            (
                cardID,
                userId,
                carId,
                carBrand,
                prices,
                quantity
            )
            SELECT
                CONVERT(VARCHAR(50), NEWID()),  -- server-generated id
                @UserId,
                @CarId,
                Cars.brand,
                Cars.prices,
                @Quantity
            FROM Cars
            WHERE carId = @CarId
              AND ISNULL(isDeleted, 0) = 0;

            -- The car was soft-deleted between the check and the insert
            -- (race): treat it exactly like a missing car.
            IF @@ROWCOUNT = 0
            BEGIN
                THROW 50001, 'Car not found or unavailable', 1;
            END;
        END;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
        BEGIN
            ROLLBACK TRANSACTION;
        END;

        THROW;  -- rethrow with original number (50001/50002/50003/...)
    END CATCH;

    -- 4. Only reached on success: the resulting cart row joined with Cars.
    SELECT
        c.cardID      AS cardID,
        c.carId       AS carId,
        ca.model      AS model,
        c.carBrand    AS carBrand,
        c.prices      AS prices,
        c.quantity    AS quantity,
        ca.pictureUrl AS pictureUrl
    FROM cart AS c
    INNER JOIN Cars AS ca
        ON ca.carId = c.carId
    WHERE c.userId = @UserId
      AND c.carId = @CarId;
END;
GO

/* =====================================================================
   spGetCartByUser
   Called by: GET /cart (getCart)
   Payload from controller: { UserId }
   Returns the user's cart rows joined with Cars:
     cardID, carId, model, carBrand, prices, quantity, pictureUrl
   Ordered by model (contract). Unknown/empty user -> empty recordset.
   ===================================================================== */
CREATE OR ALTER PROCEDURE spGetCartByUser
    @UserId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.cardID      AS cardID,
        c.carId       AS carId,
        ca.model      AS model,
        c.carBrand    AS carBrand,
        c.prices      AS prices,
        c.quantity    AS quantity,
        ca.pictureUrl AS pictureUrl
    FROM cart AS c
    INNER JOIN Cars AS ca
        ON ca.carId = c.carId
    WHERE c.userId = @UserId
    ORDER BY ca.model;
END;
GO

/* =====================================================================
   AddCar
   Called by: POST /cart/add/:cardID (addProducts)
   Payload from controller: { CardID }
   quantity = quantity + 1 for that cardID ONLY — the WHERE clause below
   is mandatory; the legacy version updated EVERY cart row. Returns the
   updated row joined with Cars (controller reads recordset[0]); if the
   cardID does not exist nothing happens (empty recordset, no error) and
   the controller maps that to null.
   ===================================================================== */
CREATE OR ALTER PROCEDURE AddCar
    @CardID VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE cart
    SET quantity = quantity + 1
    WHERE cardID = @CardID;

    IF @@ROWCOUNT > 0
    BEGIN
        SELECT
            c.cardID      AS cardID,
            c.carId       AS carId,
            ca.model      AS model,
            c.carBrand    AS carBrand,
            c.prices      AS prices,
            c.quantity    AS quantity,
            ca.pictureUrl AS pictureUrl
        FROM cart AS c
        INNER JOIN Cars AS ca
            ON ca.carId = c.carId
        WHERE c.cardID = @CardID;
    END;
    -- Unknown cardID: no row updated, no error — graceful no-op.
END;
GO

/* =====================================================================
   SubtractCar
   Called by: POST /cart/subtract/:cardID (subtractProducts)
   Payload from controller: { CardID }
   If quantity > 1 -> quantity = quantity - 1; otherwise DELETE the row.
   Returns the remaining row (controller reads recordset[0]); when the
   row was deleted (or never existed) the recordset is empty and the
   controller maps that to null.
   ===================================================================== */
CREATE OR ALTER PROCEDURE SubtractCar
    @CardID VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1
        FROM cart
        WHERE cardID = @CardID
          AND quantity > 1
    )
    BEGIN
        UPDATE cart
        SET quantity = quantity - 1
        WHERE cardID = @CardID;
    END
    ELSE
    BEGIN
        -- Last item removed (or cardID unknown) -> row gone.
        DELETE FROM cart
        WHERE cardID = @CardID;
    END;

    -- Returns the remaining row, or an empty recordset after deletion.
    SELECT
        c.cardID      AS cardID,
        c.carId       AS carId,
        ca.model      AS model,
        c.carBrand    AS carBrand,
        c.prices      AS prices,
        c.quantity    AS quantity,
        ca.pictureUrl AS pictureUrl
    FROM cart AS c
    INNER JOIN Cars AS ca
        ON ca.carId = c.carId
    WHERE c.cardID = @CardID;
END;
GO

/* =====================================================================
   spGetAllCart
   Called by: GET /cart/all (getAllCart — admin only)
   No parameters. Returns every cart row joined with Cars (model,
   pictureUrl) and users (userName):
     cardID, userId, userName, carId, model, carBrand, prices, quantity,
     pictureUrl
   Ordered by userName then model (contract). LEFT JOINs guarantee every
   cart row is listed even if a joined parent is missing.
   ===================================================================== */
CREATE OR ALTER PROCEDURE spGetAllCart
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.cardID      AS cardID,
        c.userId      AS userId,
        u.userName    AS userName,
        c.carId       AS carId,
        ca.model      AS model,
        c.carBrand    AS carBrand,
        c.prices      AS prices,
        c.quantity    AS quantity,
        ca.pictureUrl AS pictureUrl
    FROM cart AS c
    LEFT JOIN Cars AS ca
        ON ca.carId = c.carId
    LEFT JOIN users AS u
        ON u.userId = c.userId
    ORDER BY u.userName, ca.model;
END;
GO
