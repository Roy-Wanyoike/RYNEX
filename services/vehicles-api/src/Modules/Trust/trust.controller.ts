import { Request, Response } from 'express'
import Joi from 'joi'
import mssql from 'mssql'
import { db } from '../../DatabaseHelper'

/**
 * RYNEX Trust — seller trust profiles, verification flags, ratings and scores.
 *
 * Every handler answers with the global envelope:
 *   success -> 2xx { success: true, message, data? }
 *   failure -> { success: false, message }
 *
 * Raw SQL/driver errors are logged via console.error only — they are never
 * sent to the client. The only client-visible non-generic error messages are
 * the module's own controlled RAISERROR signals (SELLER_NOT_FOUND,
 * RATING_INVALID), which the SPs raise deliberately so the controller can
 * answer 404/400 instead of 500.
 *
 * Auth enforcement lives at router level (verifyToken / requireAdmin), not
 * here. verifyToken attaches the JWT payload to (req as any).user.
 */

/* Controlled RAISERROR signals raised by the trust stored procedures. */
const SELLER_NOT_FOUND = 'Seller user not found'
const RATING_INVALID = 'Rating must be an integer between 1 and 5'

/* ------------------------------ validation ------------------------------ */

/**
 * Admin verification payload — every field optional: fields left out (or
 * null) are preserved by the SP's COALESCE upsert, so a partial admin
 * request never wipes existing data.
 */
const verifySchema = Joi.object({
  idVerified: Joi.boolean().optional(),
  phoneVerified: Joi.boolean().optional(),
  emailVerified: Joi.boolean().optional(),
  businessName: Joi.string().max(100).allow(null).optional()
})
  .min(1)
  .messages({
    'object.min': 'Provide at least one field to update: idVerified, phoneVerified, emailVerified or businessName'
  })

/** Buyer rating — strict 1..5 integer (server-side, never trusted from UI). */
const ratingSchema = Joi.object({
  rating: Joi.number()
    .integer()
    .min(1)
    .max(5)
    .required()
    .messages({
      'number.base': 'rating must be a number',
      'number.integer': 'rating must be a whole number',
      'number.min': 'rating must be between 1 and 5',
      'number.max': 'rating must be between 1 and 5',
      'any.required': 'rating is required'
    })
})

/* ------------------------------- helpers -------------------------------- */

/**
 * The mutating SPs emit [trustScore] (from spComputeTrustScore) and then the
 * payload row — the caller always wants the LAST result set.
 */
const lastRecordset = (result: mssql.IResult<any>): Record<string, any>[] => {
  const sets = result.recordsets
  if (Array.isArray(sets) && sets.length > 0) {
    return sets[sets.length - 1] ?? []
  }
  return result.recordset ?? []
}

/** True when the thrown error is one of our own controlled SP signals. */
const isSignal = (error: unknown, signal: string): boolean =>
  error instanceof Error && error.message.includes(signal)

/* ------------------------------- handlers ------------------------------- */

// GET /trust/sellers/:userId — public seller profile + trust score
export const getSellerProfile = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { userId } = req.params

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Seller userId is required' })
    }

    const result = await db.exec('spGetSellerProfile', { UserId: userId })
    const rows: Record<string, any>[] = result.recordset ?? []

    // Profiles are created by the admin verify / rating flows only — an
    // unknown seller is a plain 404, never an auto-created empty row.
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Seller profile not found' })
    }

    return res.status(200).json({ success: true, message: 'Seller profile fetched', data: rows[0] })
  } catch (error) {
    console.error('[getSellerProfile] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch seller profile' })
  }
}

// GET /trust/leaderboard — public top 20 sellers by trust score
export const getTrustLeaderboard = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await db.exec('spTrustLeaderboard')
    const rows: Record<string, any>[] = result.recordset ?? []

    return res.status(200).json({ success: true, message: 'Trust leaderboard fetched', data: rows })
  } catch (error) {
    console.error('[getTrustLeaderboard] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch trust leaderboard' })
  }
}

// POST /trust/sellers/:userId/verify — admin sets verification flags
export const verifySeller = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { userId } = req.params

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Seller userId is required' })
    }

    const { idVerified, phoneVerified, emailVerified, businessName } = req.body ?? {}
    const { error } = verifySchema.validate({ idVerified, phoneVerified, emailVerified, businessName })

    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    // Server-owned parameter set: only fields actually present in the request
    // are sent, so the SP's COALESCE upsert preserves everything the admin
    // left out. BIT/VARCHAR types are bound explicitly — the DatabaseHelper's
    // default NVarChar(MAX) binding cannot represent SQL BIT booleans.
    const data: Record<string, unknown> = { UserId: userId }
    const types: Record<string, mssql.ISqlType> = {}

    // mssql.Bit()/mssql.Int() are called (not passed as factories) because
    // DatabaseHelper's TypeMap expects ISqlType instances.
    if (typeof idVerified === 'boolean') {
      data.IdVerified = idVerified
      types.IdVerified = mssql.Bit()
    }
    if (typeof phoneVerified === 'boolean') {
      data.PhoneVerified = phoneVerified
      types.PhoneVerified = mssql.Bit()
    }
    if (typeof emailVerified === 'boolean') {
      data.EmailVerified = emailVerified
      types.EmailVerified = mssql.Bit()
    }
    if (businessName !== undefined) {
      data.BusinessName = businessName
      types.BusinessName = mssql.VarChar(100)
    }

    const result = await db.exec('spUpsertSellerProfile', data, types)
    const rows = lastRecordset(result)

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: SELLER_NOT_FOUND })
    }

    return res.status(200).json({ success: true, message: 'Seller profile updated', data: rows[0] })
  } catch (error) {
    console.error('[verifySeller] failed:', error)
    if (isSignal(error, SELLER_NOT_FOUND)) {
      return res.status(404).json({ success: false, message: SELLER_NOT_FOUND })
    }
    return res.status(500).json({ success: false, message: 'Failed to update seller profile' })
  }
}

// POST /trust/sellers/:userId/rating — authenticated buyer rates a seller
export const rateSeller = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { userId } = req.params
    const rater = (req as any).user as { userId?: string } | undefined

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Seller userId is required' })
    }

    // verifyToken guarantees .user, but fail closed if it is ever missing.
    if (!rater || !rater.userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' })
    }

    // A seller cannot inflate their own score.
    if (rater.userId === userId) {
      return res.status(400).json({ success: false, message: 'Cannot rate yourself' })
    }

    const { error, value } = ratingSchema.validate({ rating: req.body?.rating })

    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    // The SP validates the 1..5 range again (defense in depth), auto-
    // provisions the profile row on the seller's first rating, accumulates
    // ratingSum/ratingCount and recomputes the trust score.
    const result = await db.exec(
      'spRecordSellerRating',
      { UserId: userId, Rating: value.rating },
      { Rating: mssql.Int() }
    )
    const rows = lastRecordset(result)

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: SELLER_NOT_FOUND })
    }

    return res.status(200).json({ success: true, message: 'Rating recorded', data: rows[0] })
  } catch (error) {
    console.error('[rateSeller] failed:', error)
    if (isSignal(error, SELLER_NOT_FOUND)) {
      return res.status(404).json({ success: false, message: SELLER_NOT_FOUND })
    }
    if (isSignal(error, RATING_INVALID)) {
      return res.status(400).json({ success: false, message: RATING_INVALID })
    }
    return res.status(500).json({ success: false, message: 'Failed to record rating' })
  }
}
