# Backend/Database — SQL bootstrap for CARSHOP

Microsoft SQL Server scripts that build the database used by the hardened
CARSHOP backend (`Backend/src`). Everything at the top level of this folder is
the **current, authoritative** schema. The legacy sub-folders
[`Tables/`](#deprecated-folders--do-not-run) and
[`Stored Procedures/`](#deprecated-folders--do-not-run) are kept **only for
history** — do not run them.

---

## File map (this is the run order)

| # | File | What it creates | Depends on |
|---|------|-----------------|------------|
| 1 | `schema_tables.sql` | Tables `users`, `Cars`, `cart`, `specCarOrders` + indexes | — |
| 2 | `procedures_users.sql` | `spRegisterUser`, `SpGetUsers`, `SpGetSpecificUser`, `SpDeleteSpecificUser`, `SpSendWelcomeEmails`, `SpUpdateUserSentEmail` | `users` |
| 3 | `procedures_cars.sql` | `spAddCars`, `SpGetCars`, `getCarByBodyShape`, `getCarByBrand`, `getOneCar`, `softDeleteProduct` | `Cars` |
| 4 | `procedures_cart.sql` | `spAddToCart`, `spGetCartByUser`, `AddCar`, `SubtractCar`, `spGetAllCart` | `cart`, `Cars`, `users` |
| 5 | `seed.sql` | Idempotent demo data: 2 users, 10 cars, 2 cart rows | 1–4 |
| — | `master.sql` | **Runner** that executes 1 → 5 in order via sqlcmd `:r` | — |

Key schema decisions (details in each file's header):

* `users.password` is `VARCHAR(255)` — bcrypt hashes are exactly 60 chars (the
  legacy `VARCHAR(50)` silently truncated them, making logins impossible).
* `users.email` is `UNIQUE`; `isAdmin` / `emailSent` are real `BIT` columns.
* `Cars.prices` is `DECIMAL(10,2)`; soft delete via `isDeleted BIT`.
* `cart` has PK `cardID` (legacy spelling kept — the API routes
  `/cart/add/:cardID` and `/cart/subtract/:cardID` reference it), a
  `UNIQUE (userId, carId)` constraint that backs quantity-merging, FKs to
  `users`/`Cars` (both `ON DELETE CASCADE`), and `quantity INT`.

---

## Prerequisites

* SQL Server **2016 SP1 or newer** (the procedure scripts use `CREATE OR ALTER`).
* The target database (`carshop`) must **already exist** — none of these
  scripts issue `CREATE DATABASE`. The `docker-compose.yml` at the repo root
  (created by the infra agent) provisions SQL Server + the `carshop`
  database automatically; just run `docker compose up -d` first and wait for
  the container to report healthy.
* A `sqlcmd` client: the standalone CLI, SSMS/Azure Data Studio **with SQLCMD
  mode enabled**, or `sqlcmd` inside the MSSQL docker container.

---

## Option A — one-shot bootstrap with `master.sql` (recommended)

`master.sql` includes all five scripts in dependency order using sqlcmd `:r`
directives and stops at the first error (`:on error exit`):

```bash
sqlcmd -S localhost -d carshop -U sa -P <password> -v ScriptPath="<folder>" -i master.sql
```

### The `-v ScriptPath=...` switch — read this

`-v` defines a **sqlcmd scripting variable**. The `:r` lines inside
`master.sql` look like `:r $(ScriptPath)\schema_tables.sql`, and sqlcmd
substitutes the variable to build the real include path. **`ScriptPath` must
be the folder that contains `master.sql` and the five `.sql` files** — i.e.
this directory (`Backend/Database`).

Spelling the current folder in each shell:

| Shell | `-v` value |
|-------|------------|
| cmd.exe | `-v ScriptPath="%cd%"` |
| PowerShell | `-v ScriptPath="$((Get-Location).Path)"` |
| bash / zsh | `-v ScriptPath="$(pwd)"` |

Rules:

* Quote the value when the path contains spaces.
* Do **not** add a trailing slash/backslash — the `:r` lines append
  `\<file>.sql` themselves.
* Easiest: `cd` into `Backend/Database` first, then use `-v ScriptPath="."`.
* If you forget `-v`, sqlcmd aborts with
  *"'ScriptPath' scripting variable is not defined."* — that is the missing
  switch, not a SQL error.

Example (Windows, from the repo root):

```bat
cd Backend\Database
sqlcmd -S localhost -d carshop -U sa -P "YourStrong!Passw0rd" -v ScriptPath="%cd%" -i master.sql
```

Notes:

* `:r` / `:on error exit` are **sqlcmd directives, not T-SQL**. In SSMS enable
  *Query → SQLCMD Mode* first, or plain query mode fails with
  *"Incorrect syntax near ':'"*.
* On Linux/macOS (go-sqlcmd, or sqlcmd inside the MSSQL container) the
  `\<file>` separators may need to be `/` — if so, just use Option B.
* Exit code is non-zero if any step fails, so CI/CD can detect a broken
  bootstrap.

---

## Option B — run each file individually

Works everywhere (SSMS, Azure Data Studio, `sqlcmd`, `docker exec ... sqlcmd`)
but you must keep the order:

```bash
sqlcmd -S localhost -d carshop -U sa -P <password> -i schema_tables.sql
sqlcmd -S localhost -d carshop -U sa -P <password> -i procedures_users.sql
sqlcmd -S localhost -d carshop -U sa -P <password> -i procedures_cars.sql
sqlcmd -S localhost -d carshop -U sa -P <password> -i procedures_cart.sql
sqlcmd -S localhost -d carshop -U sa -P <password> -i seed.sql
```

(Run from inside `Backend/Database`, or pass full paths to `-i`.) Every script
is re-runnable: tables are created `IF OBJECT_ID ... IS NULL`, procedures are
`CREATE OR ALTER`, and `seed.sql` is fully idempotent (guarded inserts —
existing rows are skipped, never duplicated).

---

## Connection settings (what the Backend reads)

The API connects with the env vars in `Backend/.env`, read by
`Backend/src/config/index.ts`:

| Env var | Maps to (`config/index.ts`) | Meaning | Example |
|---------|-----------------------------|---------|---------|
| `DB_SERVER` | `sqlConfig.server` (fallback `localhost`) | SQL Server host | `localhost` |
| `DB_NAME` | `sqlConfig.database` | Target database | `carshop` |
| `DB_USER` | `sqlConfig.user` | SQL login | `sa` |
| `DB_PWD` | `sqlConfig.password` | Password for that login | `YourStrong!Passw0rd` |
| `DB_ENCRYPT` | `options.encrypt` | `"true"` only for Azure / TLS-required servers; `false` for local docker | `false` |

Sample `.env` for local development:

```dotenv
DB_SERVER=localhost
DB_NAME=carshop
DB_USER=sa
DB_PWD=YourStrong!Passw0rd
DB_ENCRYPT=false
```

These are the **runtime** settings of the API. The bootstrap scripts take the
equivalent values as sqlcmd flags instead (`-S` = server, `-d` = database,
`-U`/`-P` = login). The `docker-compose.yml` at the repo root sets the
server-side counterparts (`MSSQL_SA_PASSWORD`, etc.) — keep them consistent.

---

## Demo data (`seed.sql`)

Seeded **demo** credentials (bcrypt, cost factor 10 — the same scheme
`authController` uses):

| User | Password (plaintext) | isAdmin | Notes |
|------|----------------------|---------|-------|
| `admin` / `admin@carshop.local` | `Admin123$` | 1 | Full admin (`requireAdmin` passes). `emailSent = 1`. |
| `john` / `john@carshop.local` | `John1234$` | 0 | Regular customer. `emailSent = 0`, so the Background-Services e-mail worker (`SpSendWelcomeEmails`) picks it up as a demo. |

Seeded catalogue (all `isDeleted = 0`, prices in KES-style magnitudes;
`pictureUrl` resolves against `Frontend/src/images/`):

| Model | BodyType | Brand | Price | pictureUrl |
|-------|----------|-------|-------|------------|
| Audi A4 2.0 TFSI | Saloon | Audi | 4,500,000.00 | `/images/audiA4.jpg` |
| Audi A5 Cabriolet 2.0 TFSI | Convertible | Audi | 5,200,000.00 | `/images/audiA5.jpg` |
| Mercedes-Benz C200 AMG Line | Saloon | Mercedes-Benz | 6,800,000.00 | `/images/benz.jpeg` |
| BMW 320i M Sport | Saloon | BMW | 5,500,000.00 | `/images/bmw.jpeg` |
| Jeep Wrangler Rubicon 3.6 V6 | SUV | Jeep | 7,900,000.00 | `/images/jeep.jpg` |
| Mazda CX-5 2.5 Grand Touring | SUV | Mazda | 4,800,000.00 | `/images/mazdacx5.jpg` |
| Mazda MX-5 2.0 Roadster | Convertible | Mazda | 3,100,000.00 | `/images/mazdamx5.jpg` |
| Volkswagen Golf 2.0 GTI | Hatchback | Volkswagen | 3,600,000.00 | `/images/volkswagen.png` |
| Volkswagen Touareg 3.6 V6 | SUV | Volkswagen | 8,500,000.00 | `/images/vwToureg.jpg` |
| Volvo XC60 T6 Inscription | SUV | Volvo | 6,200,000.00 | `/images/volvoxc60.jpg` |

Plus **2 cart rows** for `john` (2 × Audi A4, 1 × Mazda CX-5). `specCarOrders`
starts empty and is populated when orders are placed.

All ids (users, cars, cart rows) are fixed GUID literals declared at the top of
`seed.sql`, so the rows keep referencing each other consistently on every
re-run. To reset the demo data completely, drop and recreate the database
(`DROP DATABASE carshop;` + recreate + re-run `master.sql`), or
`docker compose down -v && docker compose up -d` and bootstrap again.

---

## Deprecated folders — do NOT run

* `Database/Tables/` (`users.sql`, `CarsTable.sql`, `CartTable.sql`,
  `CarOrders.sql`)
* `Database/Stored Procedures/` (`UserProcedures/`, `CarsProcedures/`,
  `CartProcedures/`)

These are the original one-off migration files, kept **only for git history /
reference**. They are superseded by `schema_tables.sql` +
`procedures_*.sql` and are **not** referenced by `master.sql`. Do not execute
them against the hardened schema — they contain incremental `ALTER`s,
undersized columns (`password VARCHAR(50)` truncates bcrypt hashes,
`email` not unique), string `'0'/'1'` flags instead of `BIT`, and stray
`USE carOrders` statements.

---

## Troubleshooting

| Symptom (SQL error) | Cause | Fix |
|---------------------|-------|-----|
| *String or binary data would be truncated* when inserting `users` | `password` column is `VARCHAR(50)` (legacy `Tables/users.sql` schema) but bcrypt hashes are 60 chars | Recreate the table via `schema_tables.sql` (`password VARCHAR(255)`); never run the legacy `Tables/` scripts |
| *Violation of UNIQUE KEY constraint 'UQ_users_email' / 'UQ_users_userName'* (2627) | That e-mail/username is already registered | Expected behaviour; `seed.sql` guards against this and skips existing rows, and the API maps duplicates to HTTP 409. Delete the conflicting row if you really need to re-insert |
| *Violation of UNIQUE KEY constraint 'UQ_cart_user_car'* | A cart row for the same user+car already exists | By design: `spAddToCart` merges quantities via the upsert on `(userId, carId)` instead of adding a second line |
| *Invalid object name 'users' / 'Cars' / 'cart'* (208) | `schema_tables.sql` not run, or wrong `-d` database | Run `schema_tables.sql` first (or `master.sql`); confirm `-d carshop` matches `DB_NAME` |
| *Could not find stored procedure 'spAddToCart' / 'spRegisterUser' / ...* (2812) | A `procedures_*.sql` file was not run | Run all three procedure files in order (or just `master.sql`) |
| *Database 'carshop' does not exist* (4060) | `-d` typo, or the container/db was never created | `docker compose up -d` (provisions `carshop`), then re-run the bootstrap |
| *Login failed for user 'sa'* (18456) | Wrong `DB_PWD`, or the MSSQL container is still booting | Check `docker compose ps` / logs; the compose `MSSQL_SA_PASSWORD` must satisfy SQL Server complexity rules; retry after the container is healthy |
| *Incorrect syntax near ':'* in SSMS | You ran `master.sql` without SQLCMD mode — `:r` is a sqlcmd directive | Enable *Query → SQLCMD Mode* in SSMS, or use the sqlcmd CLI (Option B always works) |
| *'ScriptPath' scripting variable is not defined* | `master.sql` run without the `-v` switch | Add `-v ScriptPath="<this folder>"` (see Option A) |
| *The INSERT statement conflicted with the FOREIGN KEY constraint 'FK_cart_users' / 'FK_cart_cars'* (547) | Hand-inserting cart rows whose user/car do not exist | Insert parents first — `seed.sql` seeds users → cars → cart in that order inside one transaction |
| Car images 404 in the UI | `pictureUrl` (`/images/<file>`) must match a real file in `Frontend/src/images/` | Compare extensions exactly (e.g. `mazdamx5.jpg` vs `.jpeg`); the DB stores the URL, the frontend must serve the file |
| API connection fails with TLS/certificate errors | `DB_ENCRYPT` mismatch | Local docker: `DB_ENCRYPT=false` (the config sets `trustServerCertificate: true`). Azure: `DB_ENCRYPT=true` |
