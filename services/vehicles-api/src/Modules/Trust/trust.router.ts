import { Router } from 'express'
import {
  getSellerProfile,
  getTrustLeaderboard,
  verifySeller,
  rateSeller
} from './trust.controller'
import { verifyToken } from '../../Middlewares/verifyToken'
import { requireAdmin } from '../../Middlewares/requireAdmin'

/**
 * RYNEX Trust — routes (mounted at /api/v1/trust by src/Router/modules.ts).
 *
 *   GET  /leaderboard            public   top 20 sellers by trust score
 *   GET  /sellers/:userId        public   seller profile + trust score
 *   POST /sellers/:userId/rating verifyToken   buyer 1-5 rating (not self)
 *   POST /sellers/:userId/verify verifyToken + requireAdmin   verification flags
 */
const trustRouter = Router()

// Public reads
trustRouter.get('/leaderboard', getTrustLeaderboard)
trustRouter.get('/sellers/:userId', getSellerProfile)

// Any authenticated user may rate a seller — the controller rejects
// self-ratings and non-1..5 values.
trustRouter.post('/sellers/:userId/rating', verifyToken, rateSeller)

// Admin-only: set verification flags / business name (recomputes the score).
trustRouter.post('/sellers/:userId/verify', verifyToken, requireAdmin, verifySeller)

export default trustRouter
