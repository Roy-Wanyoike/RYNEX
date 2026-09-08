import { Router } from 'express'
import { getBrandStats, getMarketOverview, getValuation } from './intelligence.controller'

const intelligenceRouter = Router()

// Read-only analytics: every route below is public (no verifyToken /
// requireAdmin) because the module never mutates data.
intelligenceRouter.get('/market/overview', getMarketOverview)
intelligenceRouter.get('/brands', getBrandStats)
intelligenceRouter.get('/valuation/:carId', getValuation)

export default intelligenceRouter
