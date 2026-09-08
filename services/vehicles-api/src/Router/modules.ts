import { Router } from 'express'

/**
 * RYNEX Platform Module Registry
 * ------------------------------
 * Every RYNEX platform module (Trust, Passport, Intelligence, Parts,
 * Service, Fleet, Finance, Data) mounts its router here, under
 * the versioned gateway:  /api/v1/<module>
 *
 * CONVENTION FOR MODULE OWNERS:
 *  - Create your module in src/Modules/<Name>/ with:
 *      <name>.router.ts   (default export: Router)
 *      <name>.controller.ts
 *      README.md
 *  - Uncomment EXACTLY your own line below. Never touch other lines.
 *  - Ship SQL in /database/extensions/<name>.sql and uncomment your
 *    include line in /database/master.sql.
 */
const router = Router()

// --- RYNEX MODULE REGISTRY (one line per module — no other edits) ---

// register:trust        → router.use('/trust', trustRouter)
// register:passport     → router.use('/passport', passportRouter)
// register:intelligence → router.use('/intelligence', intelligenceRouter)
// register:parts        → router.use('/parts', partsRouter)
// register:service      → router.use('/service', serviceRouter)
// register:fleet        → router.use('/fleet', fleetRouter)
// register:finance      → router.use('/finance', financeRouter)
// register:data         → router.use('/data', dataRouter)

export default router
