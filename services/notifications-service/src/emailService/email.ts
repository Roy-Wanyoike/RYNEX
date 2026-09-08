import mssql from 'mssql'
import dotenv from 'dotenv'
import path from 'path'
import ejs from 'ejs'
import util from 'util'
import sendMail from '../helpers'
import { sqlConfig } from '../config'

// __dirname is dist/emailService when compiled -> Background-Services/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

interface User {
  userId: string
  userName: string
  email: string
}

// Promisified once, awaited per user inside the loop (no nested callbacks).
// Explicit type args pin util.promisify to the (path, data) -> Promise<string> shape.
const renderTemplate = util.promisify<string, ejs.Data, string>(ejs.renderFile)

// __dirname is dist/emailService when compiled -> Background-Services/templates/registration.ejs
const TEMPLATE_PATH = path.resolve(__dirname, '../../templates/registration.ejs')

const WELCOME_SUBJECT = 'Welcome to CarShop'

const sendWelcomeEmail = async (): Promise<{ sent: number; failed: number }> => {
  let sent = 0
  let failed = 0

  try {
    // One connection per run.
    const pool = await mssql.connect(sqlConfig)
    const result = await pool.request().execute('SpSendWelcomeEmails')
    const users: User[] = (result.recordset ?? []) as User[]

    for (const user of users) {
      try {
        const html = await renderTemplate(TEMPLATE_PATH, { userName: user.userName })

        const message = {
          from: process.env.EMAIL,
          to: user.email,
          subject: WELCOME_SUBJECT,
          html
        }

        // Await the send: only a resolved promise counts as success.
        await sendMail(message)

        // Mark as sent ONLY after a confirmed successful send.
        await pool.request().input('IdUser', user.userId).execute('SpUpdateUserSentEmail')
        sent++
      } catch (error) {
        failed++
        // Short, PII-free log: userId and a generic error code only.
        const code =
          error instanceof Error && 'code' in error ? String((error as { code?: unknown }).code) : 'unknown'
        console.error(`[welcome-email] failed for userId=${user.userId} (${code})`)
      }
    }
  } catch (error) {
    // Run-level failure (connect or SpSendWelcomeEmails): nothing processed.
    console.error('[welcome-email] run aborted:', error instanceof Error ? error.message : 'unknown error')
  }

  // One-line, PII-free summary per run.
  console.log(`[welcome-email] run complete: sent=${sent} failed=${failed}`)
  return { sent, failed }
}

export default sendWelcomeEmail
