/*==============================================================================
  File:        extensions/trust.sql
  Purpose:     RYNEX Trust module extension — seller trust profiles, identity
               verification flags, buyer ratings, explainable trust scores and
               the public leaderboard.

  Spec mapping (docs/FEATURES.md / ROADMAP.md):
               - Seller Verification  (CarTrust spec #20)
               - Trust Score          (CarTrust spec #45)
               - Ratings / leaderboard (spec #46, partial)

  Contents:
               1. dbo.sellerProfiles     table (guarded by IF OBJECT_ID)
               2. dbo.spGetSellerProfile : profile row LEFT JOIN users
               3. dbo.spComputeTrustScore: recompute + store the trust score
               4. dbo.spUpsertSellerProfile : admin upsert of verification flags
               5. dbo.spRecordSellerRating  : buyer 1-5 rating + recompute
               6. dbo.spTrustLeaderboard    : top 20 sellers by trust score

  Idempotency: The table is created only when missing; every procedure uses
               CREATE OR ALTER, so the file can be re-run safely at any time.
               No test EXECUTEs, no data modifications on existing rows.

  Trust-score formula (documented here AND in spComputeTrustScore — the single
  source of truth for the arithmetic):
               score = 40*idVerified            (identity verified)
                     + 20*phoneVerified         (phone verified)
                     + 15*emailVerified         (email verified)
                     + LEAST(15, ratingAvg*3)   (buyer reputation, 0..15)
                     + LEAST(10, salesCount)    (sales track record, 0..10)
                     - LEAST(20, disputeCount*5) (dispute penalty, 0..20)
               clamped to the 0..100 range.
               SQL Server (< 2022) has no LEAST(), so the caps below are
               written as IIF(x > cap, cap, x) chains.

  Execution:   Runs inside the database named by DB_NAME (there is no USE
               statement). Requires the dbo.users table (schema_tables.sql).
               SQL Server 2016 SP1+ for CREATE OR ALTER:

                 sqlcmd -S <server> -d <database> -U <user> -P <password> -i extensions\trust.sql

  Security notes:
               - Verification flags are only set by the admin upsert flow;
                 buyers can never verify themselves.
               - Ratings are validated (1..5 integers) server-side.
               - Every procedure sets NOCOUNT ON to keep node-mssql result
                 sets predictable.
==============================================================================*/

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ----------------------------------------------------------------------------
   1. sellerProfiles — one row per seller (userId -> dbo.users)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.sellerProfiles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.sellerProfiles
    (
        userId        VARCHAR(50)   NOT NULL
            CONSTRAINT PK_sellerProfiles PRIMARY KEY
            CONSTRAINT FK_sellerProfiles_users FOREIGN KEY (userId)
                REFERENCES dbo.users (userId) ON DELETE CASCADE,
        idVerified    BIT           NOT NULL
            CONSTRAINT DF_sellerProfiles_idVerified DEFAULT (0),
        phoneVerified BIT           NOT NULL
            CONSTRAINT DF_sellerProfiles_phoneVerified DEFAULT (0),
        emailVerified BIT           NOT NULL
            CONSTRAINT DF_sellerProfiles_emailVerified DEFAULT (0),
        businessName  VARCHAR(100)  NULL,
        ratingSum     INT           NOT NULL
            CONSTRAINT DF_sellerProfiles_ratingSum DEFAULT (0),
        ratingCount   INT           NOT NULL
            CONSTRAINT DF_sellerProfiles_ratingCount DEFAULT (0),
        salesCount    INT           NOT NULL
            CONSTRAINT DF_sellerProfiles_salesCount DEFAULT (0),
        disputeCount  INT           NOT NULL
            CONSTRAINT DF_sellerProfiles_disputeCount DEFAULT (0),
        trustScore    DECIMAL(5,2)  NOT NULL
            CONSTRAINT DF_sellerProfiles_trustScore DEFAULT (50.00),
        updatedAt     DATETIME2     NOT NULL
            CONSTRAINT DF_sellerProfiles_updatedAt DEFAULT (SYSUTCDATETIME())
    );
END;
GO

/* Nonclustered index backing the leaderboard ORDER BY trustScore DESC. */
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_sellerProfiles_trustScore' AND object_id = OBJECT_ID(N'dbo.sellerProfiles'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_sellerProfiles_trustScore
        ON dbo.sellerProfiles (trustScore DESC);
END;
GO

/* ----------------------------------------------------------------------------
   2) spGetSellerProfile
      Called by: GET /trust/sellers/:userId (public; controller 404s on empty).
      Returns the seller profile LEFT JOIN users so callers get userName/email
      alongside the trust data. ratingAvg is computed (0 when unrated).
---------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.spGetSellerProfile
    @UserId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        sp.userId        AS userId,
        u.userName       AS userName,
        u.email          AS email,
        sp.idVerified    AS idVerified,
        sp.phoneVerified AS phoneVerified,
        sp.emailVerified AS emailVerified,
        sp.businessName  AS businessName,
        sp.ratingSum     AS ratingSum,
        sp.ratingCount   AS ratingCount,
        sp.salesCount    AS salesCount,
        sp.disputeCount  AS disputeCount,
        sp.trustScore    AS trustScore,
        CASE WHEN sp.ratingCount = 0 THEN 0
             ELSE CAST(sp.ratingSum AS DECIMAL(5,2)) / sp.ratingCount
        END              AS ratingAvg,
        sp.updatedAt     AS updatedAt
    FROM dbo.sellerProfiles sp
    LEFT JOIN dbo.users u
        ON u.userId = sp.userId
    WHERE sp.userId = @UserId;
END;
GO

/* ----------------------------------------------------------------------------
   3) spComputeTrustScore
      Called by: spUpsertSellerProfile, spRecordSellerRating (and future
      order/dispute flows). Recomputes and stores the trust score for one
      seller, then returns it as a single-row result set (trustScore column).

      Formula (see file header for rationale):
        40*idVerified + 20*phoneVerified + 15*emailVerified
        + LEAST(15, ratingAvg*3) + LEAST(10, salesCount)
        - LEAST(20, disputeCount*5), clamped to 0..100.
      LEAST() replacements are IIF chains because SQL Server < 2022 has no
      LEAST()/GREATEST() functions.
---------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.spComputeTrustScore
    @UserId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE
        @IdVerified   BIT,
        @PhoneVerified BIT,
        @EmailVerified BIT,
        @RatingSum    INT,
        @RatingCount  INT,
        @SalesCount   INT,
        @DisputeCount INT;

    SELECT
        @IdVerified    = idVerified,
        @PhoneVerified = phoneVerified,
        @EmailVerified = emailVerified,
        @RatingSum     = ratingSum,
        @RatingCount   = ratingCount,
        @SalesCount    = salesCount,
        @DisputeCount  = disputeCount
    FROM dbo.sellerProfiles
    WHERE userId = @UserId;

    IF @IdVerified IS NULL
    BEGIN
        -- No profile to score: all callers must provision one first.
        RAISERROR('Seller profile not found', 16, 1);
        RETURN;
    END;

    -- Buyer reputation: average rating (0 when unrated) scaled to 0..15 points.
    DECLARE @RatingAvg DECIMAL(10,4) =
        CASE WHEN @RatingCount = 0 THEN 0
             ELSE CAST(@RatingSum AS DECIMAL(10,4)) / @RatingCount
        END;

    -- LEAST(15, ratingAvg*3) — a perfect 5.0 average earns the full 15 points.
    DECLARE @RatingPoints DECIMAL(10,4) = IIF(@RatingAvg * 3.0 > 15, 15, @RatingAvg * 3.0);

    -- LEAST(10, salesCount) — first 10 completed sales earn 1 point each.
    DECLARE @SalesPoints INT = IIF(@SalesCount > 10, 10, @SalesCount);

    -- LEAST(20, disputeCount*5) — each dispute costs 5 points, capped at 20.
    DECLARE @DisputePenalty INT = IIF(@DisputeCount * 5 > 20, 20, @DisputeCount * 5);

    DECLARE @RawScore DECIMAL(10,4) =
          (40.0 * @IdVerified)     -- identity verified:      +40
        + (20.0 * @PhoneVerified)  -- phone verified:         +20
        + (15.0 * @EmailVerified)  -- email verified:         +15
        + @RatingPoints            -- buyer reputation:     0..+15
        + @SalesPoints             -- sales track record:   0..+10
        - @DisputePenalty;         -- disputes:             0..-20

    -- Clamp to the 0..100 range (defensive: the raw max is exactly 100).
    DECLARE @Score DECIMAL(5,2) =
        CASE
            WHEN @RawScore < 0   THEN 0
            WHEN @RawScore > 100 THEN 100
            ELSE CAST(@RawScore AS DECIMAL(5,2))
        END;

    UPDATE dbo.sellerProfiles
    SET trustScore = @Score,
        updatedAt  = SYSUTCDATETIME()
    WHERE userId = @UserId;

    SELECT @Score AS trustScore;
END;
GO

/* ----------------------------------------------------------------------------
   4) spUpsertSellerProfile
      Called by: POST /trust/sellers/:userId/verify (admin only).
      Admin sets verification flags / business name. Every flag parameter is
      optional (NULL = "leave unchanged" on update, 0 on first insert) so a
      partial admin request never wipes existing data. The trust score is
      recomputed afterwards. Result sets: [trustScore], [profile row].
---------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.spUpsertSellerProfile
    @UserId        VARCHAR(50),
    @IdVerified    BIT          = NULL,
    @PhoneVerified BIT          = NULL,
    @EmailVerified BIT          = NULL,
    @BusinessName  VARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE userId = @UserId)
    BEGIN
        RAISERROR('Seller user not found', 16, 1);
        RETURN;
    END;

    IF EXISTS (SELECT 1 FROM dbo.sellerProfiles WHERE userId = @UserId)
    BEGIN
        UPDATE dbo.sellerProfiles
        SET idVerified    = COALESCE(@IdVerified,    idVerified),
            phoneVerified = COALESCE(@PhoneVerified, phoneVerified),
            emailVerified = COALESCE(@EmailVerified, emailVerified),
            businessName  = COALESCE(@BusinessName,  businessName),
            updatedAt     = SYSUTCDATETIME()
        WHERE userId = @UserId;
    END;
    ELSE
    BEGIN
        INSERT INTO dbo.sellerProfiles (userId, idVerified, phoneVerified, emailVerified, businessName)
        VALUES (@UserId, COALESCE(@IdVerified, 0), COALESCE(@PhoneVerified, 0), COALESCE(@EmailVerified, 0), @BusinessName);
    END;

    -- Recompute after the flag change (emits the fresh trustScore row first).
    EXEC dbo.spComputeTrustScore @UserId;

    SELECT
        sp.userId        AS userId,
        u.userName       AS userName,
        u.email          AS email,
        sp.idVerified    AS idVerified,
        sp.phoneVerified AS phoneVerified,
        sp.emailVerified AS emailVerified,
        sp.businessName  AS businessName,
        sp.ratingSum     AS ratingSum,
        sp.ratingCount   AS ratingCount,
        sp.salesCount    AS salesCount,
        sp.disputeCount  AS disputeCount,
        sp.trustScore    AS trustScore,
        CASE WHEN sp.ratingCount = 0 THEN 0
             ELSE CAST(sp.ratingSum AS DECIMAL(5,2)) / sp.ratingCount
        END              AS ratingAvg,
        sp.updatedAt     AS updatedAt
    FROM dbo.sellerProfiles sp
    LEFT JOIN dbo.users u
        ON u.userId = sp.userId
    WHERE sp.userId = @UserId;
END;
GO

/* ----------------------------------------------------------------------------
   5) spRecordSellerRating
      Called by: POST /trust/sellers/:userId/rating (any authenticated user
      except the seller themself — enforced in the controller).
      Validates the 1..5 range, auto-provisions the profile row with defaults
      on the seller's first rating, accumulates ratingSum/ratingCount and
      recomputes the trust score. Result sets: [trustScore], [rating summary].
---------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.spRecordSellerRating
    @UserId VARCHAR(50),
    @Rating INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Rating IS NULL OR @Rating < 1 OR @Rating > 5
    BEGIN
        RAISERROR('Rating must be an integer between 1 and 5', 16, 1);
        RETURN;
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE userId = @UserId)
    BEGIN
        RAISERROR('Seller user not found', 16, 1);
        RETURN;
    END;

    -- Auto-provision the profile on first rating (table defaults apply: all
    -- verification flags 0, trustScore 50 before the recompute below).
    IF NOT EXISTS (SELECT 1 FROM dbo.sellerProfiles WHERE userId = @UserId)
    BEGIN
        INSERT INTO dbo.sellerProfiles (userId) VALUES (@UserId);
    END;

    UPDATE dbo.sellerProfiles
    SET ratingSum   = ratingSum + @Rating,
        ratingCount = ratingCount + 1,
        updatedAt   = SYSUTCDATETIME()
    WHERE userId = @UserId;

    -- Recompute after the new rating (emits the fresh trustScore row first).
    EXEC dbo.spComputeTrustScore @UserId;

    SELECT
        userId,
        ratingSum,
        ratingCount,
        CASE WHEN ratingCount = 0 THEN 0
             ELSE CAST(ratingSum AS DECIMAL(5,2)) / ratingCount
        END AS ratingAvg,
        trustScore
    FROM dbo.sellerProfiles
    WHERE userId = @UserId;
END;
GO

/* ----------------------------------------------------------------------------
   6) spTrustLeaderboard
      Called by: GET /trust/leaderboard (public).
      Top 20 sellers by trust score (INNER JOIN users — a profile can only
      exist for a real user). Deterministic tie-breaks: more ratings first,
      then alphabetical by userName.
---------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.spTrustLeaderboard
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (20)
        sp.userId        AS userId,
        u.userName       AS userName,
        u.fullName       AS fullName,
        sp.businessName  AS businessName,
        sp.trustScore    AS trustScore,
        CASE WHEN sp.ratingCount = 0 THEN 0
             ELSE CAST(sp.ratingSum AS DECIMAL(5,2)) / sp.ratingCount
        END              AS ratingAvg,
        sp.ratingCount   AS ratingCount,
        sp.salesCount    AS salesCount
    FROM dbo.sellerProfiles sp
    INNER JOIN dbo.users u
        ON u.userId = sp.userId
    ORDER BY
        sp.trustScore DESC,
        sp.ratingCount DESC,
        u.userName ASC;
END;
GO
