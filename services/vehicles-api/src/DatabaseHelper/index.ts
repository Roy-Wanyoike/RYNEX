import mssql from 'mssql'
import { sqlConfig } from '../config'

type DataMap = Record<string, unknown>
type TypeMap = Record<string, mssql.ISqlType>

/**
 * Thin wrapper around node-mssql with a LAZY, shared connection pool.
 * - No connection is opened in the constructor; the pool connects on first use.
 * - Concurrent first calls share a single connect promise (no duplicate pools).
 * - The pool is reused for every subsequent call.
 *
 * Usage:
 *   await db.exec('AddCar', { Make: 'Toyota' }, { Make: mssql.VarChar(50) })
 *   await db.query('SELECT * FROM Cars')
 */
export class DatabaseHelper {
  private poolPromise: Promise<mssql.ConnectionPool> | null = null

  /** Lazily connects and reuses one shared pool promise across all calls. */
  private getPool(): Promise<mssql.ConnectionPool> {
    if (this.poolPromise === null) {
      this.poolPromise = mssql.connect(sqlConfig).catch((error: unknown) => {
        // Never cache a failed connect: the next call should be able to retry.
        this.poolPromise = null
        throw error
      })
    }
    return this.poolPromise
  }

  /**
   * Binds every entry of `data` onto the request and returns it.
   * - If `types[key]` exists (e.g. mssql.VarChar(100)) it is passed straight
   *   through as the mssql type argument of request.input.
   * - Default binding is NVarChar(MAX) so long values (e.g. 60-char bcrypt
   *   hashes) are never silently truncated.
   */
  createRequest(request: mssql.Request, data: DataMap = {}, types: TypeMap = {}): mssql.Request {
    for (const key of Object.keys(data)) {
      const explicitType = types[key]
      if (explicitType) {
        request.input(key, explicitType, data[key])
      } else {
        request.input(key, mssql.NVarChar(mssql.MAX), data[key])
      }
    }
    return request
  }

  /** Executes a stored procedure and returns the raw driver result. */
  async exec(storedProcedure: string, data: DataMap = {}, types: TypeMap = {}): Promise<mssql.IResult<any>> {
    const pool = await this.getPool()
    const request = this.createRequest(pool.request(), data, types)
    return request.execute(storedProcedure)
  }

  /** Runs a raw SQL query and returns the raw driver result. */
  async query(queryString: string): Promise<mssql.IResult<any>> {
    const pool = await this.getPool()
    return pool.request().query(queryString)
  }
}

export const db = new DatabaseHelper()
