import { Request, Response } from 'express'
import { db } from '../../DatabaseHelper'

/**
 * Intelligence controller — read-only market analytics & valuation.
 *
 * Every handler answers with the global envelope:
 *   success -> 2xx { success: true, message, data? }
 *   failure -> { success: false, message }
 *
 * All endpoints are PUBLIC: this module is strictly read-only (no INSERT,
 * UPDATE or DELETE anywhere in its SQL), so no auth middleware applies.
 *
 * Raw SQL/driver errors are logged via console.error only — they are never
 * sent to the client. The one exception consumers should know about:
 * uspValuation raises SQL error 50501 ("Car not found") for unknown or
 * soft-deleted cars, which is mapped to HTTP 404 below.
 */

// GET /market/overview — public market stats
// uspMarketOverview returns TWO recordsets:
//   recordsets[0] -> single totals row (activeListings, avgPrice, minPrice, maxPrice)
//   recordsets[1] -> per-brand rows (brand, listingCount, avgPrice, minPrice, maxPrice)
export const getMarketOverview = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await db.exec('uspMarketOverview')

    // @types/mssql types recordsets as a union (array only when
    // request.arrayRowMode is on — it is not). We always want the array form.
    const recordsets = result.recordsets as unknown as Record<string, any>[][]
    const totals = recordsets[0]?.[0] ?? null
    const brands: Record<string, any>[] = recordsets[1] ?? []

    return res.status(200).json({
      success: true,
      message: 'Market overview fetched',
      data: { totals, brands }
    })
  } catch (error) {
    console.error('[getMarketOverview] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch market overview' })
  }
}

// GET /brands — public per-brand listing counts and price stats
export const getBrandStats = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await db.exec('uspBrandStats')
    const brands: Record<string, any>[] = result.recordset ?? []

    return res.status(200).json({ success: true, message: 'Brand stats fetched', data: brands })
  } catch (error) {
    console.error('[getBrandStats] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch brand stats' })
  }
}

// GET /valuation/:carId — public heuristic price estimate for one car
// uspValuation THROWs 50501 ('Car not found') when the id does not match
// a live (isDeleted = 0) car; that SQL error number maps to 404 here.
export const getValuation = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { carId } = req.params

    if (!carId) {
      return res.status(400).json({ success: false, message: 'Car id is required' })
    }

    const result = await db.exec('uspValuation', { CarId: carId })
    const valuation: Record<string, any> | undefined = result.recordset?.[0]

    if (!valuation) {
      return res.status(404).json({ success: false, message: 'Car not found' })
    }

    return res.status(200).json({ success: true, message: 'Valuation fetched', data: valuation })
  } catch (error) {
    const sqlError = error as { number?: number }

    if (sqlError?.number === 50501) {
      return res.status(404).json({ success: false, message: 'Car not found' })
    }

    console.error('[getValuation] failed:', error)
    return res.status(500).json({ success: false, message: 'Failed to compute valuation' })
  }
}
