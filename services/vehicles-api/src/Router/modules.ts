import { Router } from 'express'

/**
 * RYNEX Platform Module Registry
 * ------------------------------
 * Every RYNEX platform module mounts its router here under the versioned
 * gateway: /api/v1/<module>. See docs/ARCHITECTURE.md for the module pattern.
 */

const router = Router()

// --- RYNEX MODULE REGISTRY (activated modules) ---

import trustRouter from '../Modules/Trust/trust.router'; router.use('/trust', trustRouter);
import passportRouter from '../Modules/Passport/passport.router'; router.use('/passport', passportRouter);
import intelligenceRouter from '../Modules/Intelligence/intelligence.router'; router.use('/intelligence', intelligenceRouter);
import partsRouter from '../Modules/Parts/parts.router'; router.use('/parts', partsRouter);
import serviceRouter from '../Modules/Service/service.router'; router.use('/service', serviceRouter);
import fleetRouter from '../Modules/Fleet/fleet.router'; router.use('/fleet', fleetRouter);
import financeRouter from '../Modules/Finance/finance.router'; router.use('/finance', financeRouter);
import dataRouter from '../Modules/Data/data.router'; router.use('/data', dataRouter);

export default router
