import { Request, Response } from 'express'
import { v4 as uid } from 'uuid'
import Joi from 'joi'
import mssql from 'mssql'
import { db } from '../../DatabaseHelper'

/**
 * Rynex Passport controller — vehicle digital identity & provenance.
 *
 * Every vehicle on RYNEX gets a digital identity (the passport) and an
 * append-only provenance timeline (the events). Claims about a vehicle are
 * only as good as the evidence behind them, so this module records history
 * instead of rewriting it.
 *
 * Every handler answers with the global envelope:
 *   success -> 2xx { success: true, message, data? }
 *   failure -> { success: false, message }
 *
 * Raw SQL/driver errors are logged via console.error only — they are never
 * sent to the client. The passport procedures THROW with dedicated numbers
 * (50401/50402/50403) which are mapped to clean HTTP responses:
 *   50401 'Car not found'/'Passport not found' -> 404
 *   50402 'Passport already exists'            -> 409
 *   50403 'Invalid event type'                 -> 400
 *
 * Admin enforcement for the POST routes lives at router level
 * (verifyToken + requireAdmin), not here.
 */

/** The provenance event taxonomy (mirrors the CHECK constraint + SP whitelist). */
const EVENT_TYPES = [
  'REGISTRATION',
  'INSPECTION',
  'SERVICE',
  'TRANSFER',
  'ACCIDENT',
  'OWNERSHIP',
  'OTHER'
] as const

/**
 * POST /passport payload.
 * carId anchors the passport to a catalogue car; vin and firstRegisteredAt
 * are optional identity fields captured at issuance.
 * NOTE: `user` is mirrored into req.body by verifyToken — payloads are
 * validated via an explicit pick, so that key can never leak into the schema.
 */
const createPassportSchema = Joi.object({
  carId: Joi.string().trim().min(1).max(50).required().messages({
    'string.empty': 'Car id is required',
    'string.min': 'Car id is required',
    'string.max': 'Car id must be at most 50 characters',
    'any.required': 'Car id is required'
  }),
  vin: Joi.string().trim().max(50).allow('', null).optional().messages({
    'string.max': 'VIN must be at most 50 characters'
  }),
  firstRegisteredAt: Joi.date().iso().allow(null).optional().messages({
    'date.base': 'firstRegisteredAt must be a valid date',
    'date.format': 'firstRegisteredAt must be an ISO 8601 date-time'
  })
})

/** POST /passport/:carId/events payload. */
const addEventSchema = Joi.object({
  eventType: Joi.string()
    .trim()
    .uppercase()
    .valid(...EVENT_TYPES)
    .required()
    .messages({
      'any.only': 'Invalid event type',
      'string.empty': 'Event type is required',
      'any.required': 'Event type is required'
    }),
  description: Joi.string().trim().min(1).max(500).required().messages({
    'string.empty': 'Description is required',
    'string.min': 'Description is required',
    'string.max': 'Description must be at most 500 characters',
    'any.required': 'Description is required'
  }),
  occurredAt: Joi.date().iso().allow(null).optional().messages({
    'date.base': 'occurredAt must be a valid date',
    'date.format': 'occurredAt must be an ISO 8601 date-time'
  })
})

/** Extracts a printable message from an unknown thrown value. */
const sqlErrorMessage = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

/** Extracts the SQL error number (THROW code), following driver wrappers. */
const sqlErrorNumber = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as {
    number?: unknown
    originalError?: { number?: unknown } | null
  }
  if (typeof candidate.number === 'number') return candidate.number
  if (typeof candidate.originalError?.number === 'number') {
    return candidate.originalError.number
  }
  return null
}

/**
 * Maps the passport THROW codes to HTTP responses. Matches on err.number
 * first and falls back to the THROW message prefix (some driver wrappers
 * only surface the message). Returns null for anything that is not one of
 * our errors — the caller then answers 500 without leaking details.
 */
const PASSPORT_SQL_ERRORS: Array<{
  code: number
  pattern: RegExp
  status: number
  message: string
}> = [
  { code: 50402, pattern: /Passport already exists/i, status: 409, message: 'Passport already exists' },
  { code: 50401, pattern: /Car not found|Passport not found/i, status: 404, message: 'Car not found' },
  { code: 50403, pattern: /Invalid event type/i, status: 400, message: 'Invalid event type' }
]

const mapPassportSqlError = (
  error: unknown
): { status: number; message: string } | null => {
  // 1) The THROW number is authoritative when the driver surfaces it.
  const number = sqlErrorNumber(error)
  if (number !== null) {
    const entry = PASSPORT_SQL_ERRORS.find((candidate) => candidate.code === number)
    if (!entry) return null
    // Prefer the exact THROW text (e.g. 'Passport not found' vs 'Car not
    // found'); fall back to the canned message if the text looks off.
    const message = sqlErrorMessage(error)
    const trusted = message !== null && entry.pattern.test(message) ? message : entry.message
    return { status: entry.status, message: trusted }
  }

  // 2) Message-prefix fallback for driver wrappers that drop the number.
  const message = sqlErrorMessage(error)
  if (message === null) return null
  const entry = PASSPORT_SQL_ERRORS.find((candidate) => candidate.pattern.test(message))
  if (!entry) return null
  return { status: entry.status, message }
}

// POST /passport (admin) — issue the digital identity for a catalogue car
export const createPassport = async (req: Request, res: Response): Promise<Response> => {
  try {
    const body: Record<string, unknown> = req.body ?? {}
    const { error, value } = createPassportSchema.validate({
      carId: body.carId,
      vin: body.vin,
      firstRegisteredAt: body.firstRegisteredAt
    })

    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    // passportId is server-owned: a fresh uuid, whatever the client sent.
    const passportToCreate = {
      PassportId: uid(),
      CarId: value.carId,
      Vin: value.vin ? value.vin : null,
      FirstRegisteredAt: value.firstRegisteredAt ?? null
    }

    // FirstRegisteredAt is bound as DateTime2: the shared helper defaults
    // untyped inputs to NVarChar(MAX), which rejects Date values.
    const result = await db.exec(
      'spCreatePassport',
      passportToCreate,
      { FirstRegisteredAt: mssql.DateTime2() }
    )

    return res.status(201).json({
      success: true,
      message: 'Passport created',
      data: result.recordset[0]
    })
  } catch (error) {
    const mapped = mapPassportSqlError(error)
    if (mapped) {
      return res.status(mapped.status).json({ success: false, message: mapped.message })
    }
    console.error('[createPassport] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to create passport' })
  }
}

// GET /passport/:carId (public) — the passport + its full provenance timeline
export const getPassport = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { carId } = req.params

    if (!carId) {
      return res.status(400).json({ success: false, message: 'Car id is required' })
    }

    // spGetPassport returns two recordsets: [0] = passport, [1] = events
    // (occurredAt DESC). No passport -> empty recordsets, mapped to 404.
    const result = await db.exec('spGetPassport', { CarId: carId })
    // Normalize the recordsets union to a plain array before indexing.
    const recordsets: any[] = Array.isArray(result.recordsets) ? result.recordsets : []
    const passport: Record<string, any> | undefined = recordsets[0]?.[0]

    if (!passport) {
      return res.status(404).json({ success: false, message: 'Passport not found' })
    }

    const events: Record<string, any>[] = recordsets[1] ?? []

    return res.status(200).json({
      success: true,
      message: 'Passport fetched',
      data: { passport, events }
    })
  } catch (error) {
    console.error('[getPassport] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch passport' })
  }
}

// POST /passport/:carId/events (admin) — append one immutable provenance event
export const addPassportEvent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { carId } = req.params

    if (!carId) {
      return res.status(400).json({ success: false, message: 'Car id is required' })
    }

    const body: Record<string, unknown> = req.body ?? {}
    const { error, value } = addEventSchema.validate({
      eventType: body.eventType,
      description: body.description,
      occurredAt: body.occurredAt
    })

    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    // recordedBy = the admin's userId from the verified JWT payload.
    const user = (req as any).user as { userId?: string } | undefined

    // occurredAt defaults to "now" when the caller does not supply it.
    const eventToRecord = {
      CarId: carId,
      EventType: value.eventType,
      Description: value.description,
      OccurredAt: value.occurredAt ?? new Date(),
      RecordedBy: user?.userId ?? null
    }

    // OccurredAt is bound as DateTime2 (the helper's NVarChar default
    // rejects Date values); eventId is generated inside the procedure.
    const result = await db.exec(
      'spAddPassportEvent',
      eventToRecord,
      { OccurredAt: mssql.DateTime2() }
    )

    return res.status(201).json({
      success: true,
      message: 'Event recorded',
      data: result.recordset[0]
    })
  } catch (error) {
    const mapped = mapPassportSqlError(error)
    if (mapped) {
      return res.status(mapped.status).json({ success: false, message: mapped.message })
    }
    console.error('[addPassportEvent] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to record event' })
  }
}
