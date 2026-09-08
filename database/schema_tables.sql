/* ============================================================================
   CARSHOP — Backend/Database/schema_tables.sql
   ----------------------------------------------------------------------------
   Purpose:
     Creates the four core tables (users, Cars, cart, specCarOrders) and the
     supporting nonclustered indexes for the CARSHOP API, in one top-to-bottom
     runnable script. This is the authoritative replacement for the legacy
     one-off files under Database/Tables/ (users.sql, CarsTable.sql,
     CartTable.sql, CarOrders.sql), which contain incremental ALTERs, undersized
     columns, missing keys and stray "USE carOrders" statements — do NOT run
     those legacy files against the hardened schema.

   Idempotency:
     Every object is created only if it does not already exist
     (IF OBJECT_ID / IF NOT EXISTS sys.indexes guards), so the script can be
     safely re-run. Existing tables are left untouched (no destructive ALTERs,
     no data loss).

   Target database:
     There is deliberately NO "USE <db>" statement in this script. Run it
     inside the database named by the application's DB_NAME environment
     variable (see Backend/.env), passing it to sqlcmd with the -d switch:

       sqlcmd -S localhost -d carshop -U sa -P <pwd> -i schema_tables.sql

     The target database must already exist (this script does not create it).

   Execution order (single pass):
     1. users            (no dependencies)
     2. Cars             (no dependencies) + IX_Cars_BodyType / IX_Cars_Brand
     3. cart             (FKs -> users, Cars; UNIQUE (userId, carId))
     4. specCarOrders    (no dependencies; standalone order records)

   Design notes:
     * users.password is VARCHAR(255) — comfortably holds 60-char bcrypt
       hashes (the legacy VARCHAR(50) silently truncated them).
     * email is UNIQUE; isAdmin / emailSent / isDeleted are BIT, not
       VARCHAR '0'/'1' strings.
     * prices / carPrice use DECIMAL(10,2) — money with cents, not DECIMAL(10)
       which had zero decimal places.
     * cart.cardID keeps its legacy (misspelled) column name on purpose: the
       API routes /cart/add/:cardID and /cart/subtract/:cardID and the
       AddCar / SubtractCar procedures reference it unchanged.
     * cart has a real primary key and a UNIQUE (userId, carId) constraint so
       quantity merging (upsert) works and duplicate line items are impossible.
     * Both cart foreign keys cascade: deleting a user or a car cleans up the
       cart automatically (users and Cars are independent, so no cascade-path
       cycle exists).
     * specCarOrders.created defaults to SYSUTCDATETIME() (UTC timestamps).
     * The SET options below are required to create filtered indexes; forcing
       them ON makes the script work under any client session settings.
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
   1. users — application accounts (bcrypt-hashed credentials)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.users
    (
        userId    VARCHAR(50)  NOT NULL
            CONSTRAINT PK_users PRIMARY KEY,
        userName  VARCHAR(50)  NOT NULL
            CONSTRAINT UQ_users_userName UNIQUE,
        email     VARCHAR(100) NOT NULL
            CONSTRAINT UQ_users_email UNIQUE,
        password  VARCHAR(255) NOT NULL,          -- 60-char bcrypt hash + headroom
        address   VARCHAR(100) NULL,
        fullName  VARCHAR(100) NULL,
        phoneNo   VARCHAR(30)  NULL,
        country   VARCHAR(50)  NULL,
        isAdmin   BIT          NOT NULL
            CONSTRAINT DF_users_isAdmin DEFAULT (0),
        emailSent BIT          NOT NULL
            CONSTRAINT DF_users_emailSent DEFAULT (0)
    );
END;
GO

/* ----------------------------------------------------------------------------
   2. Cars — car catalogue (soft-deletable rows)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Cars', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Cars
    (
        carId      VARCHAR(50)   NOT NULL
            CONSTRAINT PK_Cars PRIMARY KEY,
        model      VARCHAR(100)  NOT NULL,
        bodyType   VARCHAR(50)   NOT NULL,
        brand      VARCHAR(50)   NOT NULL,
        prices     DECIMAL(10,2) NOT NULL
            CONSTRAINT DF_Cars_prices DEFAULT (0),
        pictureUrl VARCHAR(255)  NULL,
        isDeleted  BIT           NOT NULL
            CONSTRAINT DF_Cars_isDeleted DEFAULT (0)
    );
END;
GO

/* Nonclustered indexes on Cars — filtered to live (non-deleted) rows only. */
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_Cars_BodyType' AND object_id = OBJECT_ID(N'dbo.Cars'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Cars_BodyType
        ON dbo.Cars (bodyType)
        WHERE isDeleted = 0;
END;
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_Cars_Brand' AND object_id = OBJECT_ID(N'dbo.Cars'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Cars_Brand
        ON dbo.Cars (brand)
        WHERE isDeleted = 0;
END;
GO

/* ----------------------------------------------------------------------------
   3. cart — one row per (user, car) line item; UNIQUE constraint backs the
      quantity-merge upsert performed by the cart stored procedures.
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.cart', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.cart
    (
        cardID   VARCHAR(50)   NOT NULL
            CONSTRAINT PK_cart PRIMARY KEY,     -- legacy spelling kept (API routes / procedures reference it)
        userId   VARCHAR(50)   NOT NULL,
        carId    VARCHAR(50)   NOT NULL,
        carBrand VARCHAR(50)   NULL,
        prices   DECIMAL(10,2) NOT NULL
            CONSTRAINT DF_cart_prices DEFAULT (0),
        quantity INT           NOT NULL
            CONSTRAINT DF_cart_quantity DEFAULT (1),

        CONSTRAINT FK_cart_users FOREIGN KEY (userId) REFERENCES dbo.users (userId)
            ON DELETE CASCADE,
        CONSTRAINT FK_cart_cars FOREIGN KEY (carId) REFERENCES dbo.Cars (carId)
            ON DELETE CASCADE,
        CONSTRAINT UQ_cart_user_car UNIQUE (userId, carId)  -- enables merging quantities per user+car
    );
END;
GO

/* ----------------------------------------------------------------------------
   4. specCarOrders — special-order / order-log records (soft-deletable)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.specCarOrders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.specCarOrders
    (
        id        VARCHAR(50)   NOT NULL
            CONSTRAINT PK_specCarOrders PRIMARY KEY,
        userName  VARCHAR(50)   NULL,
        carId     VARCHAR(50)   NULL,
        email     VARCHAR(100)  NULL,
        carName   VARCHAR(100)  NULL,
        carPrice  DECIMAL(10,2) NULL,
        created   DATETIME2     NOT NULL
            CONSTRAINT DF_specCarOrders_created DEFAULT (SYSUTCDATETIME()),
        isDeleted BIT           NOT NULL
            CONSTRAINT DF_specCarOrders_isDeleted DEFAULT (0)
    );
END;
GO
