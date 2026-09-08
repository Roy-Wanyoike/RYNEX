import { Request, Response } from 'express'
import { v4 as uid } from 'uuid'
import { db } from '../../DatabaseHelper'
import { createBookingSchema, updateBookingStatusSchema } from './service.schemas'

/**
 * RYNEX Service module controller — service bookings.
 *
 * Every handler answers with the global envelope:
 *   success -> 2xx { success: true, message, data? }
 *   failure -> { success: false, message }
 *
 * Identity comes from verifyToken ((req as any).user = { userId, ... }) —
 * a client can never read or mutate another user's bookings, and the
 * admin-only routes are guarded at router level (requireAdmin).
 *
 * SQL THROW numbers (see database/extensions/service.sql) surface as
 * node-mssql err.number and are mapped here:
 *   50701 invalid service type          -> 400
 *   50702 car not found / unavailable   -> 400
 *   50703 invalid status transition     -> 409 (conflict with current state)
 *   50704 booking not found             -> 404
 *   50705 missing required parameters   -> 400
 * Raw driver errors are logged via console.error only — never sent to the client.
 */

/** Shape of the decoded JWT payload attached by verifyToken. */
interface AuthUser {
  userId: string
  userName?: string
  isAdmin?: boolean
}

/** SQL THROW error numbers produced by the service procedures. */
const SQL_ERROR = {
  invalidServiceType: 50701,
  carNotFound: 50702,
  invalidTransition: 50703,
  bookingNotFound: 50704,
  missingParameters: 50705
} as const

/** Maps a stored-procedure THROW (err.number) onto the HTTP error envelope. */
const respondWithSqlError = (error: unknown, res: Response): Response | null => {
  const code = (error as { number?: number } | null | undefined)?.number
  const sqlMessage = (error as { message?: string } | null | undefined)?.message

  switch (code) {
    case SQL_ERROR.invalidServiceType:
      return res.status(400).json({
        success: false,
        message: 'Invalid service type. Allowed values: INSPECTION, MAINTENANCE, REPAIR, DIAGNOSTICS'
      })
    case SQL_ERROR.carNotFound:
      return res.status(400).json({
        success: false,
        message: 'carId does not reference an existing, available car'
      })
    case SQL_ERROR.invalidTransition:
      return res.status(409).json({
        success: false,
        message: sqlMessage || 'Invalid status transition'
      })
    case SQL_ERROR.bookingNotFound:
      return res.status(404).json({ success: false, message: 'Booking not found' })
    case SQL_ERROR.missingParameters:
      return res.status(400).json({ success: false, message: 'Missing required booking parameters' })
    default:
      return null
  }
}

/** Reads the authenticated subject attached by verifyToken (401 if absent). */
const getAuthUserId = (req: Request): string | null => {
  const user = (req as any).user as AuthUser | undefined
  return user && typeof user.userId === 'string' && user.userId.length > 0 ? user.userId : null
}

/**
 * "Today" as UTC midnight. preferredDate is compared date-only (a booking
 * for today is valid; only past dates are rejected), so both sides are
 * normalized to the same UTC midnight instant.
 */
const startOfTodayUtc = (): Date => {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
}

// POST /api/v1/service/bookings (verifyToken)
// Body: { carId, serviceType, preferredDate, notes? } -> 201 created booking.
export const createBooking = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = getAuthUserId(req)
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' })
    }

    const { carId, serviceType, preferredDate, notes } = req.body

    const { error } = createBookingSchema.validate({ carId, serviceType, preferredDate, notes })
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    // Not-in-past rule (date-only comparison: today itself is allowed).
    const preferred = new Date(`${preferredDate as string}T00:00:00Z`)
    if (preferred.getTime() < startOfTodayUtc().getTime()) {
      return res.status(400).json({
        success: false,
        message: 'preferredDate must be today or a future date'
      })
    }

    // notes: empty/whitespace strings are stored as NULL (column is nullable).
    const trimmedNotes = typeof notes === 'string' && notes.trim().length > 0 ? notes.trim() : null

    const booking = {
      BookingId: uid(),                    // server-owned id, never client-supplied
      UserId: userId,                      // from the verified JWT, never the body
      CarId: carId as string,
      ServiceType: serviceType as string,
      PreferredDate: preferredDate as string, // strict YYYY-MM-DD (validated above)
      Notes: trimmedNotes
    }

    const result = await db.exec('spCreateBooking', booking)

    return res.status(201).json({
      success: true,
      message: 'Service booking created',
      data: result.recordset[0]
    })
  } catch (error) {
    const mapped = respondWithSqlError(error, res)
    if (mapped) {
      return mapped
    }

    console.error('[createBooking] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to create booking' })
  }
}

// GET /api/v1/service/bookings (verifyToken)
// Returns the current user's bookings, newest first.
export const getMyBookings = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = getAuthUserId(req)
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' })
    }

    const result = await db.exec('SpGetBookingsByUser', { UserId: userId })

    return res.status(200).json({
      success: true,
      message: 'Bookings fetched',
      data: result.recordset ?? []
    })
  } catch (error) {
    console.error('[getMyBookings] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch bookings' })
  }
}

// GET /api/v1/service/bookings/all (requireAdmin)
// Returns every booking in the platform, newest first, with userName.
export const getAllBookings = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await db.exec('spGetAllBookings')

    return res.status(200).json({
      success: true,
      message: 'Bookings fetched',
      data: result.recordset ?? []
    })
  } catch (error) {
    console.error('[getAllBookings] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch bookings' })
  }
}

// PATCH /api/v1/service/bookings/:bookingId/status (requireAdmin)
// Body: { status } -> 200 updated booking. Illegal moves -> 409 (THROW 50703).
export const updateBookingStatus = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { bookingId } = req.params // already uuid-validated by the router
    const { status } = req.body

    const { error } = updateBookingStatusSchema.validate({ status })
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    const result = await db.exec('spUpdateBookingStatus', {
      BookingId: bookingId,
      NewStatus: status
    })

    return res.status(200).json({
      success: true,
      message: 'Booking status updated',
      data: result.recordset[0]
    })
  } catch (error) {
    const mapped = respondWithSqlError(error, res)
    if (mapped) {
      return mapped
    }

    console.error('[updateBookingStatus] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to update booking status' })
  }
}
