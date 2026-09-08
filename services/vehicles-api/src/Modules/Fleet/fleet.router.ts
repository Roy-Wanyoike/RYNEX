import { Router, RequestHandler } from 'express'
import { verifyToken } from '../../Middlewares/verifyToken'
import { requireAdmin } from '../../Middlewares/requireAdmin'
import {
    createFleet,
    getMyFleets,
    getAllFleets,
    getFleetVehicles,
    assignVehicle,
    removeVehicle
} from './fleet.controller'

/**
 * RYNEX Fleet module router (multi-vehicle management, spec §51 (f2)).
 * Mounted by src/Router/modules.ts at /api/v1/fleet — the paths below are
 * relative to that mount (so "POST /fleets" is POST /api/v1/fleet/fleets).
 */

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Rejects requests whose :fleetId / :carId params are not uuids with a 400
 * before they can reach the database (both PKs are uuid-shaped strings).
 */
const requireUuidParams = (...names: string[]): RequestHandler => (req, res, next) => {
    for (const name of names) {
        const value: string | undefined = req.params[name]
        if (!value || !UUID_PATTERN.test(value)) {
            res.status(400).json({ success: false, message: `A valid ${name} (uuid) is required` })
            return
        }
    }
    next()
}

const router = Router()

// POST /api/v1/fleet/fleets — create a fleet (owner = token user)
router.post('/fleets', verifyToken, createFleet)

// GET /api/v1/fleet/fleets — the authenticated user's fleets + vehicle counts
router.get('/fleets', verifyToken, getMyFleets)

// GET /api/v1/fleet/fleets/all — every fleet (admin only)
router.get('/fleets/all', verifyToken, requireAdmin, getAllFleets)

// GET /api/v1/fleet/fleets/:fleetId/vehicles — fleet vehicles (owner or admin)
router.get('/fleets/:fleetId/vehicles', verifyToken, requireUuidParams('fleetId'), getFleetVehicles)

// POST /api/v1/fleet/fleets/:fleetId/vehicles — assign a car (owner or admin)
router.post('/fleets/:fleetId/vehicles', verifyToken, requireUuidParams('fleetId'), assignVehicle)

// DELETE /api/v1/fleet/fleets/:fleetId/vehicles/:carId — remove a car (owner or admin)
router.delete('/fleets/:fleetId/vehicles/:carId', verifyToken, requireUuidParams('fleetId', 'carId'), removeVehicle)

export default router
