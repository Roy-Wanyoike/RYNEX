import { Router } from 'express'
import {
  addPassportEvent,
  createPassport,
  getPassport
} from './passport.controller'
import { verifyToken } from '../../Middlewares/verifyToken'
import { requireAdmin } from '../../Middlewares/requireAdmin'

/**
 * Rynex Passport routes — mounted by Router/modules at
 * /api/v1/passport (see src/Router/modules.ts).
 */
const router = Router()

// Admin-only passport issuance and event recording
router.post('', verifyToken, requireAdmin, createPassport)
router.post('/:carId/events', verifyToken, requireAdmin, addPassportEvent)

// Public provenance reads — anyone can inspect a vehicle's passport
router.get('/:carId', getPassport)

export default router
