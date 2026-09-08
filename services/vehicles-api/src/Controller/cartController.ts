import { Request, Response } from 'express'
import { cartSchema } from '../Helpers'
import { db } from '../DatabaseHelper'

/**
 * Extracts the authenticated user's id from the decoded JWT.
 * verifyToken stores the payload at (req as any).user (and req.body.user).
 */
const getUserId = (req: Request): string | undefined => {
    const fromToken = (req as any).user?.userId
    const fromBody = (req as any).body?.user?.userId
    return fromToken ?? fromBody
}

// POST /cart
// Adds a car to the current user's cart. Trusts ONLY { carId, quantity } from
// the client — carBrand and prices are derived from the Cars table inside
// spAddToCart (prevents client-side price tampering). The SP upserts on
// (userId, carId) so repeated adds merge into quantity instead of new rows.
export const addProductsToCart = async (req: Request, res: Response) => {
    try {
        const { carId, quantity } = req.body ?? {}

        const { error } = cartSchema.validate({ carId, quantity })
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message })
        }

        const userId = getUserId(req)
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' })
        }

        const result = await db.exec('spAddToCart', { UserId: userId, CarId: carId, Quantity: Number(quantity) })
        return res.status(201).json({ success: true, message: 'Added to cart', data: result.recordset?.[0] ?? null })
    } catch (error) {
        console.error('addProductsToCart failed:', error)
        return res.status(500).json({ success: false, message: 'Cart operation failed' })
    }
}

// GET /cart
// Returns all cart rows for the current user.
export const getCart = async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req)
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' })
        }

        const result = await db.exec('spGetCartByUser', { UserId: userId })
        return res.status(200).json({ success: true, message: 'Cart fetched', data: result.recordset })
    } catch (error) {
        console.error('getCart failed:', error)
        return res.status(500).json({ success: false, message: 'Cart operation failed' })
    }
}

// POST /cart/add/:cardID
// Increments the quantity of an existing cart row by 1.
export const addProducts = async (req: Request, res: Response) => {
    try {
        const cardID = req.params.cardID
        if (!cardID || cardID.trim() === '') {
            return res.status(400).json({ success: false, message: 'cardID is required' })
        }

        const result = await db.exec('AddCar', { CardID: cardID })
        return res.status(200).json({ success: true, message: 'Quantity increased', data: result.recordset?.[0] ?? null })
    } catch (error) {
        console.error('addProducts failed:', error)
        return res.status(500).json({ success: false, message: 'Cart operation failed' })
    }
}

// POST /cart/subtract/:cardID
// Decrements the quantity of an existing cart row by 1; the SP deletes the
// row when quantity reaches 0.
export const subtractProducts = async (req: Request, res: Response) => {
    try {
        const cardID = req.params.cardID
        if (!cardID || cardID.trim() === '') {
            return res.status(400).json({ success: false, message: 'cardID is required' })
        }

        const result = await db.exec('SubtractCar', { CardID: cardID })
        return res.status(200).json({ success: true, message: 'Quantity decreased', data: result.recordset?.[0] ?? null })
    } catch (error) {
        console.error('subtractProducts failed:', error)
        return res.status(500).json({ success: false, message: 'Cart operation failed' })
    }
}

// GET /cart/all  (admin only)
// Returns every cart row joined with users.userName.
export const getAllCart = async (req: Request, res: Response) => {
    try {
        const result = await db.exec('spGetAllCart')
        return res.status(200).json({ success: true, message: 'All carts fetched', data: result.recordset })
    } catch (error) {
        console.error('getAllCart failed:', error)
        return res.status(500).json({ success: false, message: 'Cart operation failed' })
    }
}
