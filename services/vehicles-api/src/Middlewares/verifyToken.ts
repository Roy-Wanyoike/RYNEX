import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import path from 'path'
import { RequestHandler } from 'express'

dotenv.config({ path: path.resolve(__dirname, '../../.env') })

/**
 * Decoded JWT payload shape (matches the signing side):
 * { userId, userName, email, fullName, isAdmin }
 * isAdmin is normalized to a strict boolean before attaching.
 */
interface TokenPayload {
  userId: string
  userName: string
  email: string
  fullName: string
  isAdmin: boolean
}

export const verifyToken: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization

  // Header must exist and use the "Bearer <token>" scheme.
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' })
    return
  }

  const token = header.slice('Bearer '.length).trim()
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' })
    return
  }

  // Never verify against an undefined secret.
  const secret = process.env.SECRETKEY
  if (!secret) {
    res.status(401).json({ success: false, message: 'Authentication configuration error' })
    return
  }

  let payload: TokenPayload
  try {
    payload = jwt.verify(token, secret) as TokenPayload
  } catch {
    // Invalid signature, malformed token, or expired token.
    res.status(401).json({ success: false, message: 'Invalid or expired token' })
    return
  }

  if (typeof payload !== 'object' || payload === null) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' })
    return
  }

  // Normalize isAdmin to a strict boolean (tolerates '1'/1 from legacy tokens).
  const raw = payload as unknown as { isAdmin?: boolean | string | number }
  payload.isAdmin = raw.isAdmin === true || raw.isAdmin === '1' || raw.isAdmin === 1

  // Attach for modern controllers...
  ;(req as any).user = payload
  // ...and mirror for legacy controllers that read req.body.user.
  if (req.body && typeof req.body === 'object') {
    req.body.user = payload
  }

  next()
}
