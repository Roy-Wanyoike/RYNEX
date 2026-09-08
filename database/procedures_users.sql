/*==============================================================================
  File:        procedures_users.sql
  Purpose:     Hardened user-related stored procedures for the CarShop backend
               (auth/registration, admin user listing, login lookup, admin
               delete, and the welcome-email workflow used by the email worker).

  Scope:       - spRegisterUser          : parameterized INSERT (no client role)
               - SpGetUsers              : user list WITHOUT password column
               - SpGetSpecificUser       : full login row (incl. bcrypt hash)
                                           with camelCase result columns
               - SpDeleteSpecificUser    : admin delete by userId
               - SpSendWelcomeEmails     : pending-email queue (emailSent = 0)
               - SpUpdateUserSentEmail   : mark a user's welcome email sent

  DEPENDENCY:  The users table must already exist in its hardened form.
               Execute "schema_tables.sql" (same folder) FIRST — it creates and
               widens the users columns (email VARCHAR(100), password
               VARCHAR(255) for 60-char bcrypt hashes, address VARCHAR(100),
               fullName VARCHAR(100), phoneNo VARCHAR(30), country VARCHAR(50))
               and provides the isAdmin / emailSent defaults (0).

  Execution:   SQL Server 2016 SP1+ is required for CREATE OR ALTER.
               Windows authentication:
                 sqlcmd -S localhost -d CarShop -E -i "Backend\Database\procedures_users.sql"
               SQL authentication:
                 sqlcmd -S <server> -d <database> -U <user> -P <password> -i "Backend\Database\procedures_users.sql"

  Security notes:
               - isAdmin is NEVER a parameter of spRegisterUser; the column
                 falls back to its table default (0). Roles are never
                 client-controlled.
               - SpGetUsers deliberately excludes the password column so user
                 listings can never leak password hashes.
               - Every procedure sets NOCOUNT ON to suppress done-row noise
                 (avoids the " statement(s) affected " extra result sets that
                 confuse node-mssql consumers).
==============================================================================*/

/* -----------------------------------------------------------------------------
  1) spRegisterUser
     Called by: POST /auth/register (authController -> db.exec)
     Contract params (exact 8): @IdUser, @Name, @Email, @Password (bcrypt hash),
     @Address, @FullName, @PhoneNo, @Country.
     isAdmin is intentionally NOT a parameter -> table default 0 applies.
----------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.spRegisterUser
    @IdUser   VARCHAR(50),
    @Name     VARCHAR(50),
    @Email    VARCHAR(100),
    @Password VARCHAR(255),
    @Address  VARCHAR(100),
    @FullName VARCHAR(100),
    @PhoneNo  VARCHAR(30),
    @Country  VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.users
    (
        userId,
        userName,
        email,
        password,
        address,
        fullName,
        phoneNo,
        country
    )
    VALUES
    (
        @IdUser,
        @Name,
        @Email,
        @Password,
        @Address,
        @FullName,
        @PhoneNo,
        @Country
    );
    -- isAdmin and emailSent are intentionally omitted: table defaults (0) apply.
END;
GO

/* -----------------------------------------------------------------------------
  2) SpGetUsers
     Called by: GET /users (admin only; controller strips password defensively).
     Returns every user EXCEPT the password column, ordered by userName.
----------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.SpGetUsers
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        userId    AS userId,
        userName  AS userName,
        email     AS email,
        address   AS address,
        fullName  AS fullName,
        phoneNo   AS phoneNo,
        country   AS country,
        isAdmin   AS isAdmin,
        emailSent AS emailSent
    FROM dbo.users
    ORDER BY userName;
END;
GO

/* -----------------------------------------------------------------------------
  3) SpGetSpecificUser
     Called by: POST /auth/login (authController -> db.exec('SpGetSpecificUser', { Name })).
     Returns the FULL row including the password hash so bcrypt.compare can
     verify credentials; every column is aliased camelCase so node-mssql
     consumers can rely on exact result keys.
----------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.SpGetSpecificUser
    @Name VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        userId    AS userId,
        userName  AS userName,
        email     AS email,
        password  AS password,
        address   AS address,
        fullName  AS fullName,
        phoneNo   AS phoneNo,
        country   AS country,
        isAdmin   AS isAdmin,
        emailSent AS emailSent
    FROM dbo.users
    WHERE userName = @Name;
END;
GO

/* -----------------------------------------------------------------------------
  4) SpDeleteSpecificUser
     Called by: admin user-removal flow.
     Deletes a single user identified by userId (@IdUser).
----------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.SpDeleteSpecificUser
    @IdUser VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.users
    WHERE userId = @IdUser;
END;
GO

/* -----------------------------------------------------------------------------
  5) SpSendWelcomeEmails
     Called by: Background-Services email worker.
     Returns the queue of users whose welcome email has not been sent yet
     (emailSent = 0) with the minimal columns the mailer needs.
----------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.SpSendWelcomeEmails
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        userId   AS userId,
        userName AS userName,
        email    AS email
    FROM dbo.users
    WHERE emailSent = 0;
END;
GO

/* -----------------------------------------------------------------------------
  6) SpUpdateUserSentEmail
     Called by: Background-Services email worker after successful delivery.
     Marks one user's welcome email as sent (emailSent = 1).
----------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.SpUpdateUserSentEmail
    @IdUser VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.users
    SET emailSent = 1
    WHERE userId = @IdUser;
END;
GO
