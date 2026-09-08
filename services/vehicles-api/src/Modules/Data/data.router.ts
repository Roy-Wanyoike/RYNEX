import { Router } from 'express'
import { verifyToken } from '../../Middlewares/verifyToken'
import { requireAdmin } from '../../Middlewares/requireAdmin'
import { getAuditByEntity, getRecentAudit } from './data.controller'

/**
 * RYNEX Data module router (mounted at /api/v1/data by Router/modules.ts).
 *
 * Read-only by design:
 *   GET /audit          audit trail of one entity   (admin only)
 *   GET /audit/recent   newest audit entries        (admin only)
 *
 * There is no POST/PUT/DELETE route: audit rows are appended by server
 * code through recordAudit (see recordAudit.ts), never by clients — an
 * append-only trail must not accept public writes.
 */
const router = Router()

// Route order does not matter here ('/audit' never shadows '/audit/recent'),
// but listing the more specific path first keeps intent obvious.
router.get('/audit/recent', verifyToken, requireAdmin, getRecentAudit)
router.get('/audit', verifyToken, requireAdmin, getAuditByEntity)

export default router
