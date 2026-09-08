import mssql from 'mssql'
import dotenv from 'dotenv'
import path from 'path'

// Load .env relative to the compiled file location (dist/config -> Backend/.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

// Values are read straight from the environment and intentionally kept loose:
// user/password/database may be undefined until a .env file exists. mssql
// treats them as optional and fails fast with a clear driver error if they
// are missing — no `as string` lies here.
export const sqlConfig: mssql.config = {
  user: process.env.DB_USER,
  password: process.env.DB_PWD,
  database: process.env.DB_NAME,
  server: process.env.DB_SERVER || 'localhost',
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true', // set DB_ENCRYPT=true for Azure
    trustServerCertificate: true // required for local dev / self-signed certs
  }
}

// Cached global-pool connect promise (node-mssql caches the pool per config,
// this guards against our own double-connects).
let connectionPromise: Promise<mssql.ConnectionPool> | null = null

/**
 * Connects once and caches the pool. Idempotent and safe to call
 * concurrently — repeated calls await the same connection. Silent on
 * success; on failure logs a credential-free message to console.error,
 * resets the cache so a later call can retry, and rethrows.
 */
export async function ensureConnection(): Promise<void> {
  if (connectionPromise === null) {
    connectionPromise = mssql.connect(sqlConfig).catch((error: unknown) => {
      connectionPromise = null // allow retry on the next call
      console.error('[config] Database connection failed:', error instanceof Error ? error.message : error)
      throw error
    })
  }
  await connectionPromise
}
