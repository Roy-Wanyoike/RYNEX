import Joi from 'joi'

/**
 * Joi schemas for the RYNEX Service module.
 *
 * Validation lives INSIDE the module folder (module-owned schemas, per the
 * module registry convention) — src/Helpers/index.ts is shared legacy and is
 * never extended by platform modules.
 */

/** Supported service categories (mirrors CK_serviceBookings_serviceType). */
export const SERVICE_TYPES = ['INSPECTION', 'MAINTENANCE', 'REPAIR', 'DIAGNOSTICS'] as const

/** Booking lifecycle states (mirrors CK_serviceBookings_status). */
export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const

/** preferredDate is a SQL DATE — the API contract is strict calendar dates. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * :bookingId path parameter — must be a UUID (bookings are created with
 * uuid.v4() server-side; malformed ids are rejected before hitting the DB).
 */
export const bookingIdParamSchema = Joi.object({
    bookingId: Joi.string()
        .guid()
        .required()
        .messages({
            'string.guid': 'A valid bookingId (uuid) is required',
            'string.empty': 'bookingId is required',
            'any.required': 'bookingId is required'
        })
})

/**
 * POST /bookings body.
 *
 * preferredDate: the client supplies the date, so it is NOT trusted blindly —
 * it must be a strict YYYY-MM-DD string AND a real calendar date (2025-02-30
 * is rejected). The "not in the past" rule is enforced by the controller
 * after schema validation (it needs "today", which is not a schema concern).
 */
export const createBookingSchema = Joi.object({
    carId: Joi.string()
        .guid()
        .required()
        .messages({
            'string.guid': 'A valid carId (uuid) is required',
            'string.empty': 'carId is required',
            'any.required': 'carId is required'
        }),
    serviceType: Joi.string()
        .valid(...SERVICE_TYPES)
        .required()
        .messages({
            'any.only': 'serviceType must be one of INSPECTION, MAINTENANCE, REPAIR, DIAGNOSTICS',
            'string.empty': 'serviceType is required',
            'any.required': 'serviceType is required'
        }),
    preferredDate: Joi.string()
        .pattern(DATE_ONLY_PATTERN)
        .required()
        .custom((value: string, helpers: Joi.CustomHelpers<string>) => {
            const parsed = new Date(`${value}T00:00:00Z`)
            if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
                return helpers.error('date.invalid')
            }
            return value
        })
        .messages({
            'string.pattern.base': 'preferredDate must be a date string in YYYY-MM-DD format',
            'date.invalid': 'preferredDate must be a valid calendar date in YYYY-MM-DD format',
            'string.empty': 'preferredDate is required',
            'any.required': 'preferredDate is required'
        }),
    notes: Joi.string()
        .allow(null)
        .max(500)
        .optional()
        .messages({
            'string.max': 'notes must be at most 500 characters'
        })
})

/**
 * PATCH /bookings/:bookingId/status body — admin moves a booking through the
 * state machine. Transition LEGALITY (which move is allowed from the current
 * state) is enforced by the database (spUpdateBookingStatus, THROW 50703 ->
 * HTTP 409), not by Joi.
 */
export const updateBookingStatusSchema = Joi.object({
    status: Joi.string()
        .valid(...BOOKING_STATUSES)
        .required()
        .messages({
            'any.only': 'status must be one of PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED',
            'string.empty': 'status is required',
            'any.required': 'status is required'
        })
})
