import { Request, Response } from 'express'
import { v4 as uid } from 'uuid'
import { car } from '../Helpers'
import { db } from '../DatabaseHelper'

/**
 * Products controller.
 *
 * Every handler answers with the global envelope:
 *   success -> 2xx { success: true, message, data? }
 *   failure -> { success: false, message }
 *
 * Raw SQL/driver errors are logged via console.error only — they are never
 * sent to the client.
 *
 * Admin enforcement for the POST routes lives at router level
 * (verifyToken + requireAdmin), not here.
 */

// POST /products (admin) — create a car
export const addProducts = async (req: Request, res: Response): Promise<Response> => {
  try {
    // carId and isDeleted are server-owned values: whatever the client sends
    // for them is ignored (carId is generated here, isDeleted defaults to 0
    // in the spAddCars procedure).
    const { model, bodyType, brand, prices, pictureUrl } = req.body

    const { error } = car.validate({ model, bodyType, brand, prices, pictureUrl })

    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    const carToAdd = {
      CarId: uid(),
      Model: model,
      BodyType: bodyType,
      Brand: brand,
      Prices: Number(prices),
      PictureUrl: pictureUrl ?? ''
    }

    const result = await db.exec('spAddCars', carToAdd)

    return res.status(201).json({ success: true, message: 'Product added', data: result.recordset[0] })
  } catch (error) {
    console.error('[addProducts] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to add product' })
  }
}

// GET /products/getproducts — public catalogue (only isDeleted = 0 rows)
export const getProducts = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await db.exec('SpGetCars')
    return res.status(200).json({ success: true, message: 'Cars fetched', data: result.recordset ?? [] })
  } catch (error) {
    console.error('[getProducts] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch cars' })
  }
}

// GET /products/getcarbodyshape/:bodyType
export const getCarsBodyShape = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { bodyType } = req.params

    if (!bodyType) {
      return res.status(400).json({ success: false, message: 'Body type is required' })
    }

    const result = await db.exec('getCarByBodyShape', { BodyType: bodyType })
    const cars: Record<string, any>[] = result.recordset ?? []

    if (cars.length === 0) {
      return res.status(404).json({ success: false, message: 'No cars found' })
    }

    return res.status(200).json({ success: true, message: 'Cars fetched', data: cars })
  } catch (error) {
    console.error('[getCarsBodyShape] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch cars' })
  }
}

// GET /products/getcarbrand/:brand
export const getCarBrand = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { brand } = req.params

    if (!brand) {
      return res.status(400).json({ success: false, message: 'Brand is required' })
    }

    const result = await db.exec('getCarByBrand', { Brand: brand })
    const carsByBrand: Record<string, any>[] = result.recordset ?? []

    if (carsByBrand.length === 0) {
      return res.status(404).json({ success: false, message: 'No cars found' })
    }

    return res.status(200).json({ success: true, message: 'Cars fetched', data: carsByBrand })
  } catch (error) {
    console.error('[getCarBrand] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch cars' })
  }
}

// GET /products/getonecar/:carId
export const getOneCarProduct = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { carId } = req.params

    if (!carId) {
      return res.status(400).json({ success: false, message: 'Car id is required' })
    }

    const result = await db.exec('getOneCar', { CarId: carId })
    const oneCar: Record<string, any>[] = result.recordset ?? []

    if (oneCar.length === 0) {
      return res.status(404).json({ success: false, message: 'No cars found' })
    }

    return res.status(200).json({ success: true, message: 'Car fetched', data: oneCar })
  } catch (error) {
    console.error('[getOneCarProduct] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch car' })
  }
}

// POST /products/softdeletecar/:carId (admin) — flag a car as deleted
export const softDeleteProduct = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { carId } = req.params

    if (!carId) {
      return res.status(400).json({ success: false, message: 'Car id is required' })
    }

    await db.exec('softDeleteProduct', { CarId: carId })

    return res.status(200).json({ success: true, message: 'Product removed' })
  } catch (error) {
    console.error('[softDeleteProduct] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to remove product' })
  }
}
