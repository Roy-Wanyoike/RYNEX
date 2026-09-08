import { RequestHandler } from 'express'
import { db } from '../DatabaseHelper'

/**
 * GET /users (protected by verifyToken + requireAdmin in the router).
 * Lists all user accounts via the SpGetUsers stored procedure.
 * Password hashes are stripped defensively before responding.
 */
export const getUsers: RequestHandler = async (_req, res) => {
  try {
    const result = await db.exec('SpGetUsers')
    const rows: Record<string, any>[] = result.recordset ?? []

    // Defensive: never let password hashes leave the server.
    const users = rows.map(({ password: _password, ...safeUser }) => safeUser)

    res.status(200).json({ success: true, message: 'Users fetched', data: users })
  } catch (error) {
    console.error('getUsers failed:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch users' })
  }
}
