import { Request, Response } from 'express'
import { db } from '../../DatabaseHelper'

/**
 * RYNEX Data module — audit trail read endpoints (admin only).
 *
 * There is deliberately NO public write endpoint: audit entries are
 * appended by server code only, via the recordAudit helper
 * (src/Modules/Data/recordAudit.ts) -> spWriteAudit. The trail is
 * append-only; nothing here can modify or delete rows.
 */

const DEFAULT_TOP = 50
const MIN_TOP = 1
const MAX_TOP = 200 // must match spGetRecentAudit's server-side cap

/**
 * Reads a single string query parameter (ignores repeated/array values).
 */
const readQueryString = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : ''

// GET /api/v1/data/audit?entityType=&entityId=
// Returns the audit trail for one entity, newest first. entityId is
// optional — omitting it returns every entry of that entityType.
export const getAuditByEntity = async (req: Request, res: Response) => {
    try {
        const entityType = readQueryString(req.query.entityType)
        if (!entityType) {
            return res.status(400).json({ success: false, message: 'entityType query parameter is required' })
        }
        const entityId = readQueryString(req.query.entityId) || null

        const result = await db.exec('SpGetAuditByEntity', { EntityType: entityType, EntityId: entityId })
        return res.status(200).json({ success: true, message: 'Audit entries fetched', data: result.recordset ?? [] })
    } catch (error) {
        console.error('getAuditByEntity failed:', error)
        return res.status(500).json({ success: false, message: 'Audit query failed' })
    }
}

// GET /api/v1/data/audit/recent?top=50
// Returns the newest audit rows, newest first. top is clamped to 1..200
// (spGetRecentAudit clamps again server-side); missing/invalid -> 50.
export const getRecentAudit = async (req: Request, res: Response) => {
    try {
        const rawTop = readQueryString(req.query.top)
        const parsedTop = rawTop === '' ? NaN : Number(rawTop)
        const top = Number.isFinite(parsedTop)
            ? Math.min(Math.max(Math.trunc(parsedTop), MIN_TOP), MAX_TOP)
            : DEFAULT_TOP

        const result = await db.exec('spGetRecentAudit', { Top: top })
        return res.status(200).json({ success: true, message: 'Recent audit entries fetched', data: result.recordset ?? [] })
    } catch (error) {
        console.error('getRecentAudit failed:', error)
        return res.status(500).json({ success: false, message: 'Audit query failed' })
    }
}
