import { Request, Response } from 'express'
import Joi from 'joi'
import mssql from 'mssql'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../../DatabaseHelper'

/**
 * RYNEX Finance — protected transactions & escrow (issue #19).
 *
 * Mounted by finance.router.ts under /api/v1/finance. Every response uses
 * the platform envelope { success, message, data? }.
 *
 * SECURITY MODEL:
 *  - txId is ALWAYS generated server-side (uuid v4) and never read from
 *    the request body; the client cannot choose or predict-through ids.
 *  - status is NEVER accepted at initiation: rows start at 'INITIATED'
 *    and only spUpdateTransactionStatus (admin-only endpoint) can move
 *    them through the escrow state machine.
 *  - Car purchases (carId supplied) must have the price resolved
 *    server-side from Cars in production — see the TODO in
 *    initiateTransaction and the module README ("Security notes").
 */

// ---------------------------------------------------------------------------
// Validation schemas (Joi, in-module per platform convention)
// ---------------------------------------------------------------------------

export const PROVIDERS = ['MPESA', 'CARD', 'ESCROW'] as const
export const STATUSES = ['INITIATED', 'PENDING', 'HELD', 'RELEASED', 'REFUNDED', 'FAILED'] as const

/** Path parameter validation for :txId (enforced by router.param). */
export const txIdSchema = Joi.string()
    .guid()
    .required()
    .messages({
        'string.guid': 'txId must be a valid uuid',
        'string.empty': 'txId is required',
        'any.required': 'txId is required'
    })

/**
 * POST /transactions body.
 * `carId` is optional (non-car services have no vehicle); when present it
 * must be a uuid of a live Cars row (verified in spInitiateTransaction).
 * `amount` must be a positive number with at most 2 decimal places
 * (DECIMAL(12,2) storage cap enforced with max()).
 */
export const initiateTransactionSchema = Joi.object({
    carId: Joi.string()
        .guid()
        .allow(null)
        .optional()
        .messages({
            'string.guid': 'carId must be a valid uuid',
            'string.base': 'carId must be a string'
        }),
    amount: Joi.number()
        .positive()
        .precision(2)
        .max(9999999999.99) // DECIMAL(12,2) upper bound
        .required()
        .messages({
            'number.base': 'amount must be a number',
            'number.positive': 'amount must be a positive number',
            'number.precision': 'amount must have at most 2 decimal places',
            'number.max': 'amount exceeds the maximum allowed value',
            'any.required': 'amount is required'
        }),
    provider: Joi.string()
        .valid(...PROVIDERS)
        .required()
        .messages({
            'any.only': 'provider must be one of MPESA, CARD, ESCROW',
            'string.empty': 'provider is required',
            'any.required': 'provider is required'
        })
})

/** PATCH /transactions/:txId/status body (admin). */
export const updateTransactionStatusSchema = Joi.object({
    status: Joi.string()
        .valid(...STATUSES)
        .required()
        .messages({
            'any.only': 'status must be one of INITIATED, PENDING, HELD, RELEASED, REFUNDED, FAILED',
            'string.empty': 'status is required',
            'any.required': 'status is required'
        })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the authenticated user's id from the decoded JWT.
 * verifyToken stores the payload at (req as any).user (and req.body.user).
 */
const getUserId = (req: Request): string | undefined => {
    const fromToken = (req as any).user?.userId
    const fromBody = (req as any).body?.user?.userId
    return fromToken ?? fromBody
}

const getAuthUser = (req: Request): { userId?: string; isAdmin?: boolean } | undefined => {
    return (req as any).user ?? (req as any).body?.user
}

/** Extracts the THROW number (err.number) from a node-mssql error. */
const getSqlErrorCode = (error: unknown): number | undefined => {
    if (error && typeof error === 'object' && 'number' in error) {
        const code = (error as { number?: unknown }).number
        if (typeof code === 'number') {
            return code
        }
    }
    return undefined
}

/**
 * Maps stored-procedure THROW numbers (see database/extensions/finance.sql)
 * to HTTP statuses and safe messages. Unknown codes fall back to 500 and
 * never leak raw driver error text to the client.
 */
const respondSqlError = (res: Response, error: unknown, fallbackMessage: string): Response => {
    const code = getSqlErrorCode(error)
    switch (code) {
        case 50901: // Invalid payment provider
            return res.status(400).json({ success: false, message: 'Invalid payment provider' })
        case 50902: // Invalid transaction transition
            return res.status(409).json({ success: false, message: 'Invalid transaction transition' })
        case 50903: // Transaction not found
            return res.status(404).json({ success: false, message: 'Transaction not found' })
        case 50904: // Car not found / unavailable
            return res.status(404).json({ success: false, message: 'Car not found or unavailable' })
        case 50905: // User not found
            return res.status(404).json({ success: false, message: 'User not found' })
        case 50906: // Missing TxId / UserId / non-positive amount
            return res.status(400).json({ success: false, message: 'Invalid transaction parameters' })
        default:
            console.error(`Finance operation failed (sql code: ${code ?? 'n/a'}):`, error)
            return res.status(500).json({ success: false, message: fallbackMessage })
    }
}

// ---------------------------------------------------------------------------
// POST /transactions  (verifyToken)
// Initiates a protected transaction. The row is created in 'INITIATED'
// state; only the admin status endpoint can move it through the escrow
// state machine (PENDING -> HELD -> RELEASED/REFUNDED, FAILED anywhere
// before HELD).
// ---------------------------------------------------------------------------
export const initiateTransaction = async (req: Request, res: Response) => {
    try {
        const { carId, amount, provider } = req.body ?? {}

        const { error, value } = initiateTransactionSchema.validate({ carId, amount, provider })
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message })
        }

        const userId = getUserId(req)
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' })
        }

        // ------------------------------------------------------------------
        // SECURITY — client-supplied amount (v1, documented).
        // TODO(PRODUCTION): never trust the client's amount for car
        // purchases. When carId is provided, production MUST resolve the
        // price server-side from Cars.prices (exactly as the cart module
        // already does in spAddToCart) and ignore/reject any client-sent
        // amount. v1 accepts explicit amounts only so non-car services can
        // be priced without a Cars row; the cross-check below is a final
        // guard that the amount is a strictly positive number.
        // ------------------------------------------------------------------
        if (value.carId) {
            if (!(typeof value.amount === 'number' && value.amount > 0)) {
                return res.status(400).json({ success: false, message: 'amount must be a positive number' })
            }
        }

        // txId is generated HERE — never accepted from the client.
        const txId = uuidv4()

        const result = await db.exec(
            'spInitiateTransaction',
            {
                TxId: txId,
                UserId: userId,
                CarId: value.carId ?? null,
                Amount: value.amount,
                Provider: value.provider
            },
            { Amount: mssql.Decimal(12, 2) }
        )

        return res.status(201).json({
            success: true,
            message: 'Transaction initiated',
            data: result.recordset?.[0] ?? null
        })
    } catch (error) {
        return respondSqlError(res, error, 'Finance operation failed')
    }
}

// ---------------------------------------------------------------------------
// GET /transactions/mine  (verifyToken)
// Returns the current user's transactions, newest first.
// ---------------------------------------------------------------------------
export const getMyTransactions = async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req)
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' })
        }

        const result = await db.exec('SpGetMyTransactions', { UserId: userId })
        return res.status(200).json({
            success: true,
            message: 'Transactions fetched',
            data: result.recordset ?? []
        })
    } catch (error) {
        return respondSqlError(res, error, 'Finance operation failed')
    }
}

// ---------------------------------------------------------------------------
// GET /transactions/:txId  (verifyToken)
// Single transaction. 404 when missing; 403 when the caller is neither
// the owner nor an admin.
// ---------------------------------------------------------------------------
export const getTransaction = async (req: Request, res: Response) => {
    try {
        const txId = req.params.txId

        const result = await db.exec('spGetTransaction', { TxId: txId })
        const row = result.recordset?.[0]
        if (!row) {
            return res.status(404).json({ success: false, message: 'Transaction not found' })
        }

        const user = getAuthUser(req)
        const isOwner = user?.userId === row.userId
        const isAdmin = user?.isAdmin === true
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'You do not have access to this transaction' })
        }

        return res.status(200).json({
            success: true,
            message: 'Transaction fetched',
            data: row
        })
    } catch (error) {
        return respondSqlError(res, error, 'Finance operation failed')
    }
}

// ---------------------------------------------------------------------------
// PATCH /transactions/:txId/status  (verifyToken + requireAdmin)
// Moves a transaction through the escrow state machine. The transition
// rules live in spUpdateTransactionStatus:
//   INITIATED -> PENDING | FAILED
//   PENDING   -> HELD    | FAILED
//   HELD      -> RELEASED | REFUNDED
//   RELEASED / REFUNDED / FAILED -> terminal
// Invalid moves surface as THROW 50902 -> HTTP 409; unknown txId -> 404.
// ---------------------------------------------------------------------------
export const updateTransactionStatus = async (req: Request, res: Response) => {
    try {
        const { status } = req.body ?? {}

        const { error } = updateTransactionStatusSchema.validate({ status })
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message })
        }

        const txId = req.params.txId

        const result = await db.exec('spUpdateTransactionStatus', { TxId: txId, NewStatus: status })
        return res.status(200).json({
            success: true,
            message: 'Transaction status updated',
            data: result.recordset?.[0] ?? null
        })
    } catch (error) {
        return respondSqlError(res, error, 'Finance operation failed')
    }
}

// ---------------------------------------------------------------------------
// POST /webhooks/:provider  (PUBLIC — no verifyToken)
// Payment-provider delivery endpoint (M-Pesa Daraja, card PSPs, ...).
//
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// +++  SECURITY WARNING — PRODUCTION MUST VERIFY THE PROVIDER SIGNATURE   +++
// +++  BEFORE TRUSTING ANY PAYLOAD.                                       +++
// +++                                                                     +++
// +++  This v1 handler is a STUB: it acknowledges delivery (202) and      +++
// +++  persists NOTHING. It accepts and discards the body.                +++
// +++                                                                     +++
// +++  Before going live, every call must be authenticated, e.g.:         +++
// +++   * M-Pesa (Safaricom Daraja): validate the callback origin/        +++
// +++     credentials per Daraja's callback requirements and verify the   +++
// +++     transaction via a server-side STK query (id, amount, status).   +++
// +++   * Card PSPs: verify the HMAC/signature header against the raw     +++
// +++     request body using the provider webhook secret.                 +++
// +++  Until signature verification exists, DO NOT read amounts, ids or   +++
// +++  statuses from webhook payloads, and DO NOT mutate transactions     +++
// +++  from this endpoint.                                                +++
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ---------------------------------------------------------------------------
export const receiveWebhook = async (req: Request, res: Response) => {
    // v1 stub: deliberately no persistence and no payload trust.
    // Payload is intentionally ignored (lint-safe explicit reference).
    void req
    return res.status(202).json({ success: true, message: 'Webhook received' })
}
