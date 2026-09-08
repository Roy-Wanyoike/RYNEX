import { Router } from 'express'

/**
 * RYNEX Platform Module Registry
 * ------------------------------
 * Every RYNEX platform module (Trust, Passport, Intelligence, Parts,
 * Service, Fleet, Finance, Data) mounts its router here, under the
 * versioned gateway:  /api/v1/<module>
 *
 * CONVENTION FOR MODULE OWNERS:
 *  - Create your module in src/Modules/<Name>/ with:
 *      <name>.router.ts     (default export: Router)
 *      <name>.controller.ts
 *      README.md
 *  - Ship SQL in /database/extensions/<name>.sql (idempotent) and
 *    uncomment ONLY your own :r include line in /database/master.sql.
 *  - Uncomment EXACTLY your own single line below. Never touch other lines.
 */
const router = Router()

// --- RYNEX MODULE REGISTRY (one line per module — uncomment to activate) ---

// import trustRouter from '../Modules/Trust/trust.router'; router.use('/trust', trustRouter);
// import passportRouter from '../Modules/Passport/passport.router'; router.use('/passport', passportRouter);
// import intelligenceRouter from '../Modules/Intelligence/intelligence.router'; router.use('/intelligence', intelligenceRouter);
// import partsRouter from '../Modules/Parts/parts.router'; router.use('/parts', partsRouter);
import serviceRouter from '../Modules/Service/service.router'; router.use('/service', serviceRouter);
// import fleetRouter from '../Modules/Fleet/fleet.router'; router.use('/fleet', fleetRouter);
// import financeRouter from '../Modules/Finance/finance.router'; router.use('/finance', financeRouter);
// import dataRouter from '../Modules/Data/data.router'; router.use('/data', dataRouter);

export default router
