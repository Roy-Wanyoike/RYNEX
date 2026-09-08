/* =============================================================================
   CARSHOP — Backend/Database/master.sql
   -----------------------------------------------------------------------------
   WHAT IT DOES
     Ordered bootstrap runner: executes every database script in this folder in
     the correct dependency order using sqlcmd :r include directives.

       1. schema_tables.sql      tables: users, Cars, cart, specCarOrders
       2. procedures_users.sql   spRegisterUser, SpGetUsers, SpGetSpecificUser,
                                 SpDeleteSpecificUser, SpSendWelcomeEmails,
                                 SpUpdateUserSentEmail
       3. procedures_cars.sql    spAddCars, SpGetCars, getCarByBodyShape,
                                 getCarByBrand, getOneCar, softDeleteProduct
       4. procedures_cart.sql    spAddToCart, spGetCartByUser, AddCar,
                                 SubtractCar, spGetAllCart
       5. seed.sql               idempotent demo data (users 'admin' + 'john',
                                 10 cars, 2 cart rows for john)
                                 -- comment the include below out if you want
                                    an empty database.

     Dependency order matters: procedures require their tables; seed requires
     tables + procedures' parent rows (cart has FKs to users and Cars).

   HOW TO RUN
     The target database must already exist — docker-compose.yml at the repo
     root provisions SQL Server and the "carshop" database automatically
     (docker compose up -d). Then run:

       sqlcmd -S localhost -d carshop -U sa -P <password> -v ScriptPath="<folder>" -i master.sql

     THE -v ScriptPath=... SWITCH (required)
       -v defines a sqlcmd *scripting variable*. The :r directives below
       substitute it into the include path: ":r $(ScriptPath)\schema_tables.sql"
       becomes "C:\...\Backend\Database\schema_tables.sql" (or wherever you
       point it). ScriptPath must be the folder that contains master.sql and
       the five .sql files it includes — i.e. Backend/Database.

       Spelling the current folder per shell:
         cmd.exe:      -v ScriptPath="%cd%"
         PowerShell:   -v ScriptPath="$((Get-Location).Path)"
         bash / zsh:   -v ScriptPath="$(pwd)"

       Rules:
         * quote the value when the path contains spaces;
         * do NOT add a trailing slash or backslash — the :r lines below
           already append "\<file>.sql";
         * easiest of all: cd into Backend/Database first and pass
           -v ScriptPath="."
       If you forget -v, sqlcmd aborts with:
         "'ScriptPath' scripting variable is not defined."
       — that is this missing switch, not a SQL error.

   ERROR HANDLING
     :on error exit makes sqlcmd stop immediately on the first failing batch
     and return a non-zero exit code, so CI/CD and shell scripts can detect a
     half-applied bootstrap instead of silently continuing.

   CLIENT REQUIREMENTS
     :r / :on error exit are sqlcmd directives, not T-SQL. Run this file with
     the sqlcmd CLI, or in SSMS / Azure Data Studio with SQLCMD mode enabled
     (SSMS: Query > SQLCMD Mode). Plain SSMS query mode fails with
     "Incorrect syntax near ':'".
     On Linux/macOS (go-sqlcmd, or sqlcmd inside the MSSQL docker container)
     the '\<file>' separators below may need to be '/' — in that case simply
     run the five scripts individually in the order shown above (README.md,
     "Option B").
   ============================================================================= */

:on error exit

PRINT N'=== CARSHOP DB bootstrap: start ===';

/* -----------------------------------------------------------------------------
   1. Tables + indexes (users, Cars, cart, specCarOrders) — no dependencies.
   ----------------------------------------------------------------------------- */
:r $(ScriptPath)\schema_tables.sql
GO

/* -----------------------------------------------------------------------------
   2. User stored procedures (require the users table).
   ----------------------------------------------------------------------------- */
:r $(ScriptPath)\procedures_users.sql
GO

/* -----------------------------------------------------------------------------
   3. Car stored procedures (require the Cars table).
   ----------------------------------------------------------------------------- */
:r $(ScriptPath)\procedures_cars.sql
GO

/* -----------------------------------------------------------------------------
   4. Cart stored procedures (require cart + Cars + users).
   ----------------------------------------------------------------------------- */
:r $(ScriptPath)\procedures_cart.sql
GO

/* -----------------------------------------------------------------------------
   5. Idempotent demo data — 2 users, 10 cars, 2 cart rows for 'john'.
      Safe to re-run (guarded inserts). Comment out if you want an empty DB.
   ----------------------------------------------------------------------------- */
:r $(ScriptPath)\seed.sql
GO

PRINT N'=== CARSHOP DB bootstrap: done (tables + procedures + seed) ===';

-- ============================================================
-- RYNEX PLATFORM MODULE EXTENSIONS
-- Each module ships its own idempotent extension file.
-- Module owners: uncomment exactly your own line below.
-- ============================================================
:r $(ScriptPath)\extensions\trust.sql
-- :r $(ScriptPath)\extensions\passport.sql
:r $(ScriptPath)\extensions\intelligence.sql
-- :r $(ScriptPath)\extensions\parts.sql
:r $(ScriptPath)\extensions\service.sql
-- :r $(ScriptPath)\extensions\fleet.sql
:r $(ScriptPath)\extensions\finance.sql
-- :r $(ScriptPath)\extensions\data.sql
GO
