import path from 'path'
import dotenv from 'dotenv'
import express from 'express'
import cron from 'node-cron'

// Load .env FIRST, before anything that reads process.env (the config module
// loads the same file at import time — dotenv does not overwrite existing
// values, so this stays idempotent regardless of import order).
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import { ensureConnection } from './config'
import sendWelcomeEmail from './emailService/email'

const app = express()

// Health probe only — this service's real work is the cron job below.
app.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Email worker healthy' })
})

// Connect to the database without blocking startup: the worker keeps serving
// /health and cron keeps ticking even if the DB is briefly unreachable.
ensureConnection()
  .then(() => console.log('[server] Database connection ready'))
  .catch(() => console.error('[server] Database connection failed — cron runs will retry via mssql pool'))

// Guard against overlapping runs: cron fires every 30 seconds but a run may
// take longer (slow SMTP/DB). Skip the tick if the previous run is in flight.
let isRunning = false

// Check for newly registered users every 30 seconds
cron.schedule('*/30 * * * * *', async () => {
  if (isRunning) {
    console.log('[server] Previous welcome-email run still in flight — skipping tick')
    return
  }
  isRunning = true
  try {
    await sendWelcomeEmail()
    console.log('[server] Welcome-email run finished')
  } catch (error) {
    console.error('[server] Welcome-email run failed:', error)
  } finally {
    isRunning = false
  }
})

const PORT = process.env.PORT || 4002

app.listen(PORT, () => {
  console.log(`[server] Email worker listening on port ${PORT}`)
})
