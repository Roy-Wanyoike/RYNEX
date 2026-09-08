import { v4 as uuid } from 'uuid'
import { db } from '../../DatabaseHelper'

/**
 * RYNEX Data module — reusable audit recording helper.
 *
 * OTHER MODULES ADOPT THIS (no direct DB/SQL knowledge required):
 *
 *   import { recordAudit } from '../Data/recordAudit'
 *
 *   // inside any controller/service, after the business action succeeds:
 *   await recordAudit(userId, 'CAR_ADDED', 'CAR', carId, { model: car.model })
 *   // ...or fire-and-forget:
 *   void recordAudit(userId, 'CAR_ADDED', 'CAR', carId, { model: car.model })
 *
 * Semantics:
 *   - Appends exactly one row to dbo.auditLog via spWriteAudit
 *     (INSERT-only stored procedure — see database/extensions/data.sql).
 *   - logId is a fresh GUID; createdAt is set by the database (UTC).
 *   - metadata is serialized to JSON here and re-validated by ISJSON in
 *     the database (THROW 51001 on invalid JSON — cannot happen when it
 *     came from JSON.stringify, but the DB must not trust that).
 *   - FIRE-AND-FORGET: every failure (serialization, connection, SQL) is
 *     caught, logged with console.error, and swallowed — the promise
 *     NEVER rejects, so awaiting or not awaiting recordAudit can never
 *     break a business flow. An unwritten audit entry is logged loudly
 *     instead of crashing the request that produced it.
 */

/**
 * Standard audit actions used across RYNEX modules. The union is a
 * vocabulary suggestion only — `AuditAction` accepts ANY string, so new
 * integrations can record custom actions without changing this module.
 */
export type StandardAuditAction =
    | 'USER_REGISTERED'        // Auth: a new account was registered
    | 'CAR_ADDED'              // Vehicles: a car was added to the catalogue
    | 'CAR_SOFT_DELETED'       // Vehicles: a car was soft-deleted (isDeleted = 1)
    | 'CART_ITEM_ADDED'        // Commerce: a car was added to a user's cart
    | 'PASSPORT_CREATED'       // Passport: a Rynex Passport was issued
    | 'PASSPORT_EVENT_ADDED'   // Passport: a verification event was appended
    | 'TX_STATUS_CHANGED'      // Finance: a transaction changed status
    | 'BOOKING_STATUS_CHANGED' // Bookings: a booking changed status
    | 'TRUST_RATED'            // Trust: a user/entity received a rating

/** Any string is a valid AuditAction; the union documents the standard set. */
export type AuditAction = StandardAuditAction | (string & {})

/**
 * Appends one audit row. Never throws, never rejects.
 *
 * @param actorUserId id of the authenticated user responsible for the
 *                    action, or null for system-originated actions.
 * @param action      what happened (standard vocabulary or custom string).
 * @param entityType  entity kind, e.g. 'USER' | 'CAR' | 'CART' | 'PASSPORT'
 *                    | 'TX' | 'BOOKING' | 'TRUST' (max 30 chars, DB-enforced).
 * @param entityId    id of the affected entity, or null when the action is
 *                    not tied to a single entity (max 50 chars).
 * @param metadata    optional JSON-serializable context (object, array,
 *                    primitive). Serialized with JSON.stringify.
 */
export async function recordAudit(
    actorUserId: string | null,
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    metadata?: unknown
): Promise<void> {
    await appendAuditRow(actorUserId, action, entityType, entityId, metadata).catch((error: unknown) => {
        // Audit failures must never break business flows: log and move on.
        console.error(
            `recordAudit: failed to record audit entry (action=${action}, entityType=${entityType}, entityId=${entityId ?? 'n/a'}):`,
            error
        )
    })
}

/**
 * The actual (throwing) write. Kept separate so recordAudit can guard the
 * whole pipeline — JSON serialization included — behind a single .catch.
 */
async function appendAuditRow(
    actorUserId: string | null,
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    metadata?: unknown
): Promise<void> {
    const metadataJson = metadata === undefined || metadata === null ? null : JSON.stringify(metadata)

    await db.exec('spWriteAudit', {
        LogId: uuid(),
        ActorUserId: actorUserId,
        Action: action,
        EntityType: entityType,
        EntityId: entityId,
        Metadata: metadataJson
    })
}
