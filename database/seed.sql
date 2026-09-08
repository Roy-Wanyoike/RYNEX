/* =============================================================================
   CARSHOP — Backend/Database/seed.sql
   -----------------------------------------------------------------------------
   Idempotent demo data for local development and demos:

     * 2 users : 'admin' (isAdmin = 1) and 'john' (isAdmin = 0)
     * 10 cars : realistic KES-priced catalogue (900,000.00 – 8,500,000.00),
                 pictureUrl pointing at the images shipped in
                 Frontend/src/images/
     * 2 cart rows for 'john' (FKs to users + Cars must exist first)

   PASSWORDS (bcrypt, cost 10 — generated with the Backend's own bcrypt
   package so they match what authController compares against):
     admin : plaintext 'Admin123$'  ->  $2b$10$Y.glXY9Mle5zZ0usX5/4pe19LaqDLYXFGVhZkaJThc9C5ZdZ05pjm
     john  : plaintext 'John1234$'  ->  $2b$10$DG23ActacVPLdBXdwmQTGOCTDq5upNPwqL9ddqG8S18z/77MYJ5su
   Both hashes are exactly 60 characters; users.password is VARCHAR(255) per
   schema_tables.sql, so they fit. Demo credentials ONLY — change them for
   anything resembling a real deployment.

   IDEMPOTENCY
     Every INSERT is guarded with IF NOT EXISTS (users by userName, cars by
     their fixed carId, cart rows by (userId, carId)), so the script can be
     re-run any number of times: existing rows are skipped, never duplicated.

   DEPENDENCY
     Requires the tables from schema_tables.sql (run schema_tables.sql, or
     master.sql, first). Deliberately contains NO GO statements: the whole
     file is ONE batch, so the DECLAREd GUID variables stay alive top-to-bottom.

   FIXED IDENTIFIERS
     All ids are fixed literals declared below, so the cars and the cart rows
     reference the same keys on every run (no NEWID() drift between re-runs).
   ============================================================================= */

SET NOCOUNT ON;

/* ----------------------------------------------------------------------------
   Fixed identifiers (stable across runs so cart <-> car references hold).
   ---------------------------------------------------------------------------- */
DECLARE @adminUserId VARCHAR(50) = '3147cfc0-436b-475d-861f-b53cbf8660d0';
DECLARE @johnUserId  VARCHAR(50) = '82523847-d0b1-42ee-bccf-8a6eae6a4ba5';

DECLARE @carIdAudiA4     VARCHAR(50) = 'a90b580a-da97-46d5-b351-10633295adc9';  -- Audi A4 2.0 TFSI
DECLARE @carIdAudiA5     VARCHAR(50) = '14e6fe7e-bf15-491f-b2c4-c7ff17e23e93';  -- Audi A5 Cabriolet
DECLARE @carIdBenzC200   VARCHAR(50) = 'd354f912-5235-476b-afd7-ed0a2d8bfc57';  -- Mercedes-Benz C200
DECLARE @carIdBmw320     VARCHAR(50) = 'dfb95b3f-e958-4149-94e0-126e7e53fab7';  -- BMW 320i M Sport
DECLARE @carIdJeep       VARCHAR(50) = 'd9ab3cc3-96ed-4bc7-9b35-97bfb1dfbddd';  -- Jeep Wrangler Rubicon
DECLARE @carIdMazdaCx5   VARCHAR(50) = '66f4b3ab-2ad9-4882-8324-7135391277ee';  -- Mazda CX-5
DECLARE @carIdMazdaMx5   VARCHAR(50) = '2b8b83e4-9639-470f-a46e-4310c61bf41d';  -- Mazda MX-5
DECLARE @carIdVwGolf     VARCHAR(50) = '8981cfd5-3c80-4027-b86c-31f0f53cd104';  -- VW Golf GTI
DECLARE @carIdVwTouareg  VARCHAR(50) = 'f41a32b8-5375-46e1-899a-c93cab982b2c';  -- VW Touareg
DECLARE @carIdVolvoXc60  VARCHAR(50) = '7128472f-6dcd-4872-822c-37328a5a9822';  -- Volvo XC60

DECLARE @cartRow1Id VARCHAR(50) = 'd185658d-5a10-45ba-83a2-66f2c2c5ce98';       -- john -> Audi A4
DECLARE @cartRow2Id VARCHAR(50) = 'a708fa79-3a6e-469c-8c31-2a839344c4fb';       -- john -> Mazda CX-5

/* ----------------------------------------------------------------------------
   Seed everything inside one transaction: all rows land, or none do.
   ---------------------------------------------------------------------------- */
BEGIN TRY
    BEGIN TRANSACTION;

    /* ==========================================================================
       1. USERS
       ========================================================================== */

    -- Admin account — plaintext password (local demo only): 'Admin123$'
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE userName = 'admin')
    BEGIN
        INSERT INTO dbo.users
            (userId, userName, email, password, address, fullName, phoneNo, country, isAdmin, emailSent)
        VALUES
            (@adminUserId,
             'admin',
             'admin@carshop.local',
             '$2b$10$Y.glXY9Mle5zZ0usX5/4pe19LaqDLYXFGVhZkaJThc9C5ZdZ05pjm',  -- bcrypt(10) of 'Admin123$'
             'Nairobi CBD, Nairobi',
             'Car Shop Admin',
             '+254700000001',
             'Kenya',
             1,   -- isAdmin   = true  -> requireAdmin passes for this account
             1);  -- emailSent = true  -> demo admin is not queued for a welcome e-mail
        PRINT 'seed: user "admin" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: user "admin" already exists - skipped';
    END;

    -- Regular customer — plaintext password (local demo only): 'John1234$'
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE userName = 'john')
    BEGIN
        INSERT INTO dbo.users
            (userId, userName, email, password, address, fullName, phoneNo, country, isAdmin, emailSent)
        VALUES
            (@johnUserId,
             'john',
             'john@carshop.local',
             '$2b$10$DG23ActacVPLdBXdwmQTGOCTDq5upNPwqL9ddqG8S18z/77MYJ5su',  -- bcrypt(10) of 'John1234$'
             'Westlands, Nairobi',
             'John Doe',
             '+254700000002',
             'Kenya',
             0,   -- isAdmin   = false -> normal customer account
             0);  -- emailSent = false -> Background-Services e-mail worker
                  -- (SpSendWelcomeEmails) will pick this row up as a demo
        PRINT 'seed: user "john" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: user "john" already exists - skipped';
    END;

    /* ==========================================================================
       2. CARS (10 demo cars; pictureUrl maps to Frontend/src/images/<file>)
       ========================================================================== */

    -- 1) Audi A4 — Saloon
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdAudiA4)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdAudiA4, 'Audi A4 2.0 TFSI', 'Saloon', 'Audi', 4500000.00, '/images/audiA4.jpg', 0);
        PRINT 'seed: car "Audi A4 2.0 TFSI" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Audi A4 2.0 TFSI" already exists - skipped';
    END;

    -- 2) Audi A5 — Convertible
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdAudiA5)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdAudiA5, 'Audi A5 Cabriolet 2.0 TFSI', 'Convertible', 'Audi', 5200000.00, '/images/audiA5.jpg', 0);
        PRINT 'seed: car "Audi A5 Cabriolet 2.0 TFSI" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Audi A5 Cabriolet 2.0 TFSI" already exists - skipped';
    END;

    -- 3) Mercedes-Benz C200 — Saloon
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdBenzC200)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdBenzC200, 'Mercedes-Benz C200 AMG Line', 'Saloon', 'Mercedes-Benz', 6800000.00, '/images/benz.jpeg', 0);
        PRINT 'seed: car "Mercedes-Benz C200 AMG Line" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Mercedes-Benz C200 AMG Line" already exists - skipped';
    END;

    -- 4) BMW 320i — Saloon
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdBmw320)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdBmw320, 'BMW 320i M Sport', 'Saloon', 'BMW', 5500000.00, '/images/bmw.jpeg', 0);
        PRINT 'seed: car "BMW 320i M Sport" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "BMW 320i M Sport" already exists - skipped';
    END;

    -- 5) Jeep Wrangler — SUV
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdJeep)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdJeep, 'Jeep Wrangler Rubicon 3.6 V6', 'SUV', 'Jeep', 7900000.00, '/images/jeep.jpg', 0);
        PRINT 'seed: car "Jeep Wrangler Rubicon 3.6 V6" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Jeep Wrangler Rubicon 3.6 V6" already exists - skipped';
    END;

    -- 6) Mazda CX-5 — SUV
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdMazdaCx5)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdMazdaCx5, 'Mazda CX-5 2.5 Grand Touring', 'SUV', 'Mazda', 4800000.00, '/images/mazdacx5.jpg', 0);
        PRINT 'seed: car "Mazda CX-5 2.5 Grand Touring" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Mazda CX-5 2.5 Grand Touring" already exists - skipped';
    END;

    -- 7) Mazda MX-5 — Convertible
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdMazdaMx5)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdMazdaMx5, 'Mazda MX-5 2.0 Roadster', 'Convertible', 'Mazda', 3100000.00, '/images/mazdamx5.jpg', 0);
        PRINT 'seed: car "Mazda MX-5 2.0 Roadster" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Mazda MX-5 2.0 Roadster" already exists - skipped';
    END;

    -- 8) Volkswagen Golf GTI — Hatchback
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdVwGolf)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdVwGolf, 'Volkswagen Golf 2.0 GTI', 'Hatchback', 'Volkswagen', 3600000.00, '/images/volkswagen.png', 0);
        PRINT 'seed: car "Volkswagen Golf 2.0 GTI" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Volkswagen Golf 2.0 GTI" already exists - skipped';
    END;

    -- 9) Volkswagen Touareg — SUV
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdVwTouareg)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdVwTouareg, 'Volkswagen Touareg 3.6 V6', 'SUV', 'Volkswagen', 8500000.00, '/images/vwToureg.jpg', 0);
        PRINT 'seed: car "Volkswagen Touareg 3.6 V6" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Volkswagen Touareg 3.6 V6" already exists - skipped';
    END;

    -- 10) Volvo XC60 — SUV
    IF NOT EXISTS (SELECT 1 FROM dbo.Cars WHERE carId = @carIdVolvoXc60)
    BEGIN
        INSERT INTO dbo.Cars (carId, model, bodyType, brand, prices, pictureUrl, isDeleted)
        VALUES (@carIdVolvoXc60, 'Volvo XC60 T6 Inscription', 'SUV', 'Volvo', 6200000.00, '/images/volvoxc60.jpg', 0);
        PRINT 'seed: car "Volvo XC60 T6 Inscription" created';
    END
    ELSE
    BEGIN
        PRINT 'seed: car "Volvo XC60 T6 Inscription" already exists - skipped';
    END;

    /* ==========================================================================
       3. CART — two basket lines for 'john'.
          Car data (brand/price) mirrors what spAddToCart derives from Cars.
          Guarded by (userId, carId), the same business key the procedures
          upsert on — never duplicate line items.
       ========================================================================== */

    -- john: 2 x Audi A4
    IF NOT EXISTS (SELECT 1 FROM dbo.cart WHERE userId = @johnUserId AND carId = @carIdAudiA4)
    BEGIN
        INSERT INTO dbo.cart (cardID, userId, carId, carBrand, prices, quantity)
        VALUES (@cartRow1Id, @johnUserId, @carIdAudiA4, 'Audi', 4500000.00, 2);
        PRINT 'seed: cart row (john x "Audi A4 2.0 TFSI" x2) created';
    END
    ELSE
    BEGIN
        PRINT 'seed: cart row (john x Audi A4) already exists - skipped';
    END;

    -- john: 1 x Mazda CX-5
    IF NOT EXISTS (SELECT 1 FROM dbo.cart WHERE userId = @johnUserId AND carId = @carIdMazdaCx5)
    BEGIN
        INSERT INTO dbo.cart (cardID, userId, carId, carBrand, prices, quantity)
        VALUES (@cartRow2Id, @johnUserId, @carIdMazdaCx5, 'Mazda', 4800000.00, 1);
        PRINT 'seed: cart row (john x "Mazda CX-5 2.5 Grand Touring" x1) created';
    END
    ELSE
    BEGIN
        PRINT 'seed: cart row (john x Mazda CX-5) already exists - skipped';
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;
    PRINT 'seed: FAILED - transaction rolled back: ' + ERROR_MESSAGE();
    THROW;  -- surface the original error to sqlcmd/master.sql (non-zero exit)
END CATCH;

/* ----------------------------------------------------------------------------
   Run summary (counts reflect what is present after the run, not what was
   newly inserted — the script is idempotent).
   ---------------------------------------------------------------------------- */
DECLARE @usersPresent INT =
    (SELECT COUNT(*) FROM dbo.users WHERE userId IN (@adminUserId, @johnUserId));
DECLARE @carsPresent INT =
    (SELECT COUNT(*) FROM dbo.Cars
     WHERE carId IN (@carIdAudiA4, @carIdAudiA5, @carIdBenzC200, @carIdBmw320,
                     @carIdJeep, @carIdMazdaCx5, @carIdMazdaMx5, @carIdVwGolf,
                     @carIdVwTouareg, @carIdVolvoXc60));
DECLARE @cartPresent INT =
    (SELECT COUNT(*) FROM dbo.cart WHERE userId = @johnUserId);

PRINT 'seed: summary -> demo users ' + CONVERT(VARCHAR(2), @usersPresent) + '/2'
    + ', demo cars '           + CONVERT(VARCHAR(2), @carsPresent)  + '/10'
    + ', john cart rows '      + CONVERT(VARCHAR(2), @cartPresent)  + '/2';
PRINT 'seed: done (login as admin/Admin123$ or john/John1234$)';
