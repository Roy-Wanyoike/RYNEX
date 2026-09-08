import nodemailer from 'nodemailer'

/**
 * SMTP transporter for the Background-Services email worker.
 *
 * - The transporter is a module-level LAZY singleton: created on first use,
 *   reused for every subsequent message.
 * - All configuration comes from environment variables (no secrets logged).
 * - TLS certificate validation is ON by default; explicitly opt out by
 *   setting SMTP_TLS_REJECT_UNAUTHORIZED=false (NOT recommended).
 * - sendMail uses the promise API (no callback), so send failures REJECT and
 *   propagate to the caller's try/catch.
 */

let transporter: nodemailer.Transporter | null = null
let verifyAttempted = false

function buildTransporter(): nodemailer.Transporter {
  const port = Number(process.env.SMTP_PORT || 587)

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASSWORD
    },
    tls: {
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false'
    }
  })
}

function getTransporter(): nodemailer.Transporter {
  if (transporter === null) {
    transporter = buildTransporter()
  }
  return transporter
}

/**
 * One-time, non-fatal SMTP connection verification.
 * A verification failure never throws — it only logs a warning, and the
 * actual sendMail attempt still gets to run (and report) any real error.
 */
async function verifyOnce(): Promise<void> {
  if (verifyAttempted) {
    return
  }
  verifyAttempted = true
  try {
    await getTransporter().verify()
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
    const reason = code ? String(code) : 'verify-failed'
    console.warn(`[email] SMTP connection could not be verified upfront (${reason}); will rely on sendMail errors`)
  }
}

/**
 * Send an email through the shared transporter.
 *
 * Uses the promise API only (NO callback argument), so any failure is
 * returned as a rejected promise — callers can rely on try/catch around
 * this function before marking anything (e.g. emailSent) as done.
 */
export default async function sendMail(
  messageOptions: nodemailer.SendMailOptions
): Promise<nodemailer.SentMessageInfo> {
  const client = getTransporter()
  await verifyOnce()
  return client.sendMail(messageOptions)
}
