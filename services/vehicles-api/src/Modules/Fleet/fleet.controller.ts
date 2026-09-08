import { Request, Response } from 'express'
import Joi from 'joi'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../../DatabaseHelper'

/* -----------------------------------------------------------------------------
   Schemas (Joi, in-module — Fleet owns its own validation)
   --------------------------------------------------------------------------- */

/** POST /fleets — only { name }; the owner comes from the JWT, never the body. */
export const createFleetSchema = Joi.object({
    name: Joi.string().min(1).max(100).trim().required().messages({
        'string.empty': 'Fleet name is required',
        'string.min': 'Fleet name must be at least 1 character',
        'string.max': 'Fleet name must be at most 100 characters',
        'any.required': 'Fleet name is required'
    })
})

/** POST /fleets/:fleetId/vehicles — only { carId }; must be a uuid (Cars PK). */
export const assignVehicleSchema = Joi.object({
    carId: Joi.string().guid().required().messages({
        'string.guid': 'A valid carId (uuid) is required',
        'string.empty': 'carId is required',
        'any.required': 'carId is required'
    })
})

/* -----------------------------------------------------------------------------
   Shared helpers
   --------------------------------------------------------------------------- */

interface AuthUser {
    userId?: string
    isAdmin?: boolean
}

/** Shape returned by spGetFleet / SpGetFleetsByUser / spGetAllFleets. */
interface FleetRow {
    fleetId: string
    ownerUserId: string
    name: string
    createdAt?: string
    vehicleCount?: number
}

/** THROW numbers raised by database/extensions/fleet.sql. */
const SQL_ERROR = {
    missingParams: 50800,
    carNotFound: 50801,
    vehicleAlreadyInFleet: 50802,
    fleetNotFound: 50803
} as const

/** node-mssql surfaces a THROW's number as err.number. */
const getSqlErrorNumber = (error: unknown): number | undefined => {
    if (error !== null && typeof error === 'object' && 'number' in error) {
        const num = (error as { number?: unknown }).number
        if (typeof num === 'number') {
            return num
        }
    }
    return undefined
}

/** verifyToken stores the decoded JWT payload at (req as any).user. */
const getAuth = (req: Request): AuthUser => {
    const user = (req as any).user as AuthUser | undefined
    return { userId: user?.userId, isAdmin: user?.isAdmin === true }
}

/**
 * Ownership gate for every per-fleet route.
 * Loads the fleet (spGetFleet) and enforces the Fleet ownership model:
 *   - missing fleet            -> 404 (response already sent, returns null)
 *   - not the owner, not admin -> 403 (response already sent, returns null)
 *   - otherwise                -> returns the fleet row for the handler.
 * Admins bypass the ownership check (read/assign/remove on any fleet).
 */
const authorizeFleetAccess = async (req: Request, res: Response): Promise<FleetRow | null> => {
    const { userId, isAdmin } = getAuth(req)
    if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' })
        return null
    }

    const result = await db.exec('spGetFleet', { FleetId: req.params.fleetId })
    const fleet = result.recordset?.[0] as FleetRow | undefined

    if (!fleet) {
        res.status(404).json({ success: false, message: 'Fleet not found' })
        return null
    }

    if (fleet.ownerUserId !== userId && !isAdmin) {
        res.status(403).json({ success: false, message: 'You do not have access to this fleet' })
        return null
    }

    return fleet
}

/* -----------------------------------------------------------------------------
   Handlers
   --------------------------------------------------------------------------- */

// POST /api/v1/fleet/fleets
// Creates a fleet for the authenticated user. The owner is ALWAYS the token
// subject; the id is generated server-side (uuid v4).
export const createFleet = async (req: Request, res: Response) => {
    try {
        const { name } = req.body ?? {}

        const { error } = createFleetSchema.validate({ name })
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message })
        }

        const { userId } = getAuth(req)
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' })
        }

        const fleetId = uuidv4()
        const result = await db.exec('spCreateFleet', {
            FleetId: fleetId,
            OwnerUserId: userId,
            Name: name
        })

        return res.status(201).json({ success: true, message: 'Fleet created', data: result.recordset?.[0] ?? null })
    } catch (error) {
        console.error('createFleet failed:', error)
        return res.status(500).json({ success: false, message: 'Fleet operation failed' })
    }
}

// GET /api/v1/fleet/fleets
// The authenticated user's fleets, each with its vehicleCount.
export const getMyFleets = async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req)
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' })
        }

        const result = await db.exec('SpGetFleetsByUser', { OwnerUserId: userId })
        return res.status(200).json({ success: true, message: 'Fleets fetched', data: result.recordset })
    } catch (error) {
        console.error('getMyFleets failed:', error)
        return res.status(500).json({ success: false, message: 'Fleet operation failed' })
    }
}

// GET /api/v1/fleet/fleets/all  (admin only — requireAdmin in fleet.router.ts)
// Every fleet joined with the owner's userName + vehicleCount.
export const getAllFleets = async (req: Request, res: Response) => {
    try {
        const result = await db.exec('spGetAllFleets')
        return res.status(200).json({ success: true, message: 'All fleets fetched', data: result.recordset })
    } catch (error) {
        console.error('getAllFleets failed:', error)
        return res.status(500).json({ success: false, message: 'Fleet operation failed' })
    }
}

// GET /api/v1/fleet/fleets/:fleetId/vehicles
// The fleet's vehicles (JOIN Cars). Owner or admin only.
export const getFleetVehicles = async (req: Request, res: Response) => {
    try {
        const fleet = await authorizeFleetAccess(req, res)
        if (!fleet) {
            return
        }

        const result = await db.exec('spGetFleetVehicles', { FleetId: fleet.fleetId })
        return res.status(200).json({ success: true, message: 'Fleet vehicles fetched', data: result.recordset })
    } catch (error) {
        console.error('getFleetVehicles failed:', error)
        return res.status(500).json({ success: false, message: 'Fleet operation failed' })
    }
}

// POST /api/v1/fleet/fleets/:fleetId/vehicles  { carId }
// Assigns a catalogue car to the fleet. Owner or admin only.
// SP error mapping: 50801/50803 -> 404, 50802 (UNIQUE fleetId+carId) -> 409.
export const assignVehicle = async (req: Request, res: Response) => {
    try {
        const { carId } = req.body ?? {}

        const { error } = assignVehicleSchema.validate({ carId })
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message })
        }

        const fleet = await authorizeFleetAccess(req, res)
        if (!fleet) {
            return
        }

        const result = await db.exec('spAssignVehicleToFleet', { FleetId: fleet.fleetId, CarId: carId })
        return res.status(201).json({ success: true, message: 'Vehicle assigned to fleet', data: result.recordset?.[0] ?? null })
    } catch (error) {
        const sqlErrorNumber = getSqlErrorNumber(error)
        if (sqlErrorNumber === SQL_ERROR.carNotFound) {
            return res.status(404).json({ success: false, message: 'Car not found or unavailable' })
        }
        if (sqlErrorNumber === SQL_ERROR.fleetNotFound) {
            return res.status(404).json({ success: false, message: 'Fleet not found' })
        }
        if (sqlErrorNumber === SQL_ERROR.vehicleAlreadyInFleet) {
            return res.status(409).json({ success: false, message: 'Vehicle already in fleet' })
        }

        console.error('assignVehicle failed:', error)
        return res.status(500).json({ success: false, message: 'Fleet operation failed' })
    }
}

// DELETE /api/v1/fleet/fleets/:fleetId/vehicles/:carId
// Removes the assignment. Owner or admin only. Idempotent: removing a car
// that is not in the fleet still answers 200 'Vehicle removed'.
export const removeVehicle = async (req: Request, res: Response) => {
    try {
        const fleet = await authorizeFleetAccess(req, res)
        if (!fleet) {
            return
        }

        const result = await db.exec('spRemoveVehicleFromFleet', { FleetId: fleet.fleetId, CarId: req.params.carId })
        return res.status(200).json({ success: true, message: 'Vehicle removed', data: result.recordset?.[0] ?? null })
    } catch (error) {
        console.error('removeVehicle failed:', error)
        return res.status(500).json({ success: false, message: 'Fleet operation failed' })
    }
}
