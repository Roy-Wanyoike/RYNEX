/* =====================================================================
   procedures_cars.sql
   ---------------------------------------------------------------------
   Purpose:
     Hardened stored procedures for the car catalogue, matching the
     fixed products controller (Backend/src/Controller/products.ts)
     and the Cars table defined in Backend/Database/schema_tables.sql:

       Cars (carId VARCHAR(50) PK,
             model VARCHAR(100),
             bodyType VARCHAR(50),
             brand VARCHAR(50),
             prices DECIMAL(10,2),
             pictureUrl VARCHAR(255),
             isDeleted BIT DEFAULT 0)

     Procedures created here:
       spAddCars          (@CarId, @Model, @BodyType, @Brand, @Prices, @PictureUrl)
                          -> INSERT + returns the inserted row
                          (controller reads recordset[0]; isDeleted is NOT
                           a parameter and relies on the table default 0)
       SpGetCars          ()                       -> all rows, isDeleted = 0
       getCarByBodyShape  (@BodyType VARCHAR(50))  -> rows by bodyType, isDeleted = 0
       getCarByBrand      (@Brand VARCHAR(50))     -> rows by brand,    isDeleted = 0
       getOneCar          (@CarId VARCHAR(50))     -> one row, isDeleted = 0
       softDeleteProduct  (@CarId VARCHAR(50))     -> UPDATE isDeleted = 1,
                          returns NO recordset (SET NOCOUNT ON, no SELECT)
   ---------------------------------------------------------------------
   Dependency:
     REQUIRES the Cars table from Backend/Database/schema_tables.sql
     (run schema_tables.sql FIRST, then this file).
   ---------------------------------------------------------------------
   Execution (sqlcmd):
     sqlcmd -S <server> -d carOrders -U <user> -P <password> ^
            -i "Backend/Database/schema_tables.sql"
     sqlcmd -S <server> -d carOrders -U <user> -P <password> ^
            -i "Backend/Database/procedures_cars.sql"

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
   spAddCars
   Called by: POST /products (addProducts)
   Payload from controller:
     { CarId, Model, BodyType, Brand, Prices, PictureUrl }  (6 params)
   @IsDeleted is intentionally NOT a parameter — omitted from the INSERT
   column list so the table default (0) applies.
   Returns the inserted row (controller responds with recordset[0]).
   ===================================================================== */
CREATE OR ALTER PROCEDURE spAddCars
    @CarId      VARCHAR(50),
    @Model      VARCHAR(100),
    @BodyType   VARCHAR(50),
    @Brand      VARCHAR(50),
    @Prices     DECIMAL(10,2),
    @PictureUrl VARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO Cars
    (
        carId,
        model,
        bodyType,
        brand,
        prices,
        pictureUrl
        -- isDeleted intentionally omitted -> table default 0
    )
    VALUES
    (
        @CarId,
        @Model,
        @BodyType,
        @Brand,
        @Prices,
        @PictureUrl
    );

    -- Return the inserted row so the controller can read recordset[0]
    SELECT *
    FROM Cars
    WHERE carId = @CarId;
END;
GO

/* =====================================================================
   SpGetCars
   Called by: GET /products/getproducts (getProducts) — no parameters.
   Public catalogue: only non-deleted rows.
   ===================================================================== */
CREATE OR ALTER PROCEDURE SpGetCars
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM Cars
    WHERE isDeleted = 0
    ORDER BY model;
END;
GO

/* =====================================================================
   getCarByBodyShape
   Called by: GET /products/getcarbodyshape/:bodyType (getCarsBodyShape)
   Parameter: @BodyType VARCHAR(50)
   ===================================================================== */
CREATE OR ALTER PROCEDURE getCarByBodyShape
    @BodyType VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM Cars
    WHERE isDeleted = 0
      AND bodyType = @BodyType
    ORDER BY model;
END;
GO

/* =====================================================================
   getCarByBrand
   Called by: GET /products/getcarbrand/:brand (getCarBrand)
   Parameter: @Brand VARCHAR(50)
   ===================================================================== */
CREATE OR ALTER PROCEDURE getCarByBrand
    @Brand VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM Cars
    WHERE isDeleted = 0
      AND brand = @Brand
    ORDER BY model;
END;
GO

/* =====================================================================
   getOneCar
   Called by: GET /products/getonecar/:carId (getOneCarProduct)
   Parameter: @CarId VARCHAR(50)
   Returns an empty recordset (not an error) when the car does not
   exist or is soft-deleted — the controller maps that to 404.
   ===================================================================== */
CREATE OR ALTER PROCEDURE getOneCar
    @CarId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM Cars
    WHERE isDeleted = 0
      AND carId = @CarId
    ORDER BY model;
END;
GO

/* =====================================================================
   softDeleteProduct
   Called by: POST /products/softdeletecar/:carId (softDeleteProduct)
   Parameter: @CarId VARCHAR(50)
   Soft-deletes by flagging isDeleted = 1. Deliberately returns NO
   recordset: SET NOCOUNT ON + no trailing SELECT, so the driver's
   result has no recordset for the UPDATE (controller discards it).
   ===================================================================== */
CREATE OR ALTER PROCEDURE softDeleteProduct
    @CarId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Cars
    SET isDeleted = 1
    WHERE carId = @CarId;
END;
GO
