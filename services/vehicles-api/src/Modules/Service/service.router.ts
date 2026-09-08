import { Router, Request, Response } from 'express'
import { verifyToken } from '../../Middlewares/verifyToken'
import { requireAdmin } from '../../Middlewares/requireAdmin'
import {
  createBooking,
  getAllBookings,
  getMyBookings,
  updateBookingStatus
} from './service.controller'
import { bookingIdParamSchema } from './service.schemas'

/**
 * RYNEX Service module router.
 * Mounted by the platform gateway at /api/v1/service (src/Router/modules.ts),
 * so the paths below are module-relative:
 *
 *   POST   /api/v1/service/bookings                    (verifyToken)          create a booking
 *   GET    /api/v1/service/bookings                    (verifyToken)          current user's bookings
 *   GET    /api/v1/service/bookings/all                (verifyToken+admin)    all bookings
 *   PATCH  /api/v1/service/bookings/:bookingId/status  (verifyToken+admin)    state-machine transition
 */
const serviceRouter = Router()

/**
 * Path-parameter guard: :bookingId must be a UUID. Rejecting malformed ids
 * here (400) keeps junk traffic away from the database entirely.
 */
const requireUuidBookingId = (req: Request, res: Response, next: () => void): void => {
  const { error } = bookingIdParamSchema.validate({ bookingId: req.params.bookingId })
  if (error) {
    res.status(400).json({ success: false, message: error.details[0].message })
    return
  }
  next()
}

// User-facing booking endpoints (authenticated users only).
serviceRouter.post('/bookings', verifyToken, createBooking)
serviceRouter.get('/bookings', verifyToken, getMyBookings)

// Admin endpoints.
serviceRouter.get('/bookings/all', verifyToken, requireAdmin, getAllBookings)
serviceRouter.patch(
  '/bookings/:bookingId/status',
  verifyToken,
  requireAdmin,
  requireUuidBookingId,
  updateBookingStatus
)

export default serviceRouter
