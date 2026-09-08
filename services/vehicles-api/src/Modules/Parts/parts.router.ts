import { Router } from 'express'
import { addPart, getParts, getOnePart, adjustStock, removePart } from './parts.controller'
import { verifyToken } from '../../Middlewares/verifyToken'
import { requireAdmin } from '../../Middlewares/requireAdmin'

/**
 * RYNEX Parts module router.
 * Mounted by Router/modules.ts under the versioned gateway: /api/v1/parts.
 *
 *   POST   /parts                (admin)  create a part
 *   GET    /parts                (public) catalogue with compatibility filters
 *   GET    /parts/:partId        (public) single part
 *   PATCH  /parts/:partId/stock  (admin)  adjust stock by signed delta
 *   DELETE /parts/:partId        (admin)  soft delete
 */
const partsRouter = Router()

// Admin: create a catalogue part
partsRouter.post('', verifyToken, requireAdmin, addPart)

// Public: browse the catalogue (?category&brand&fitsMake&fitsModel)
partsRouter.get('', getParts)

// Public: single part detail
partsRouter.get('/:partId', getOnePart)

// Admin: stock adjustment { delta: -999..999 }
partsRouter.patch('/:partId/stock', verifyToken, requireAdmin, adjustStock)

// Admin: soft delete
partsRouter.delete('/:partId', verifyToken, requireAdmin, removePart)

export default partsRouter
