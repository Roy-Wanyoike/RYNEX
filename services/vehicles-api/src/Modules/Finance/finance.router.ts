import { Router, Request, Response, NextFunction } from 'express'
import { verifyToken } from '../../Middlewares/verifyToken'
import { requireAdmin } from '../../Middlewares/requireAdmin'
import {
    initiateTransaction,
    getMyTransactions,
    getTransaction,
    updateTransactionStatus,
    receiveWebhook,
    txIdSchema
} from './finance.controller'

/**
 * RYNEX Finance router — mounted at /api/v1/finance by Router/modules.
 *
 * Routes:
 *   POST  /transactions               verifyToken           initiate a protected transaction
 *   GET   /transactions/mine          verifyToken           own transactions, newest first
 *   GET   /transactions/:txId         verifyToken           404 missing / 403 not owner & not admin
 *   PATCH /transactions/:txId/status verifyToken+admin      escrow state-machine transitions
 *   POST  /webhooks/:provider         PUBLIC (signature TODO — see controller/README)
 *
 * NOTE: /transactions/mine is declared BEFORE /transactions/:txId so the
 * literal segment is never captured as a txId parameter.
 */
const router = Router()

// :txId must be a uuid — reject anything else with 400 before any
// controller runs (defence in depth on top of the Joi schemas, which the
// controller applies to bodies). "mine" is a literal path segment on
// /transactions/mine, so it never reaches this param handler.
router.param('txId', (req: Request, res: Response, next: NextFunction, txId: string) => {
    const { error } = txIdSchema.validate(txId)
    if (error) {
        res.status(400).json({ success: false, message: 'txId must be a valid uuid' })
        return
    }
    next()
})

router.post('/transactions', verifyToken, initiateTransaction)
router.get('/transactions/mine', verifyToken, getMyTransactions)
router.get('/transactions/:txId', verifyToken, getTransaction)
router.patch('/transactions/:txId/status', verifyToken, requireAdmin, updateTransactionStatus)

// Public webhook endpoint — providers call server-to-server with no JWT.
// v1 stub only; PRODUCTION MUST verify the provider signature before
// trusting payloads (M-Pesa Daraja validation, PSP HMAC, ...).
router.post('/webhooks/:provider', receiveWebhook)

export default router
