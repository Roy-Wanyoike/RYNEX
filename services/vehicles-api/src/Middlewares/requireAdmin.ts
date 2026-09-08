import { RequestHandler } from 'express'

/**
 * Authorization middleware. MUST run after verifyToken, which attaches the
 * decoded JWT payload to (req as any).user (and mirrors it at req.body.user).
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  const user = ((req as any).user ?? req.body?.user) as { isAdmin?: boolean } | undefined

  if (!user || user.isAdmin !== true) {
    res.status(403).json({ success: false, message: 'Admin access required' })
    return
  }

  next()
}
