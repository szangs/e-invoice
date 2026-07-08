// System-Mails über die zentralen SMTP-Einstellungen (§24)
import nodemailer from 'nodemailer'
import { getSettings } from '@/lib/settings'

export type MailResult = { sent: boolean; reason?: string }
export type MailAttachment = { filename: string; content: Buffer | string }

export async function sendSystemMail(
  to: string,
  subject: string,
  text: string,
  attachments?: MailAttachment[],
): Promise<MailResult> {
  const s = await getSettings()
  if (!s.SMTP_HOST || !s.SMTP_FROM) {
    return { sent: false, reason: 'SMTP nicht konfiguriert (Systemeinstellungen)' }
  }
  try {
    const transporter = nodemailer.createTransport({
      host: s.SMTP_HOST,
      port: Number(s.SMTP_PORT || 587),
      secure: s.SMTP_SECURE === '1',
      auth: s.SMTP_USER ? { user: s.SMTP_USER, pass: s.SMTP_PASS } : undefined,
    })
    await transporter.sendMail({ from: s.SMTP_FROM, to, subject, text, attachments })
    return { sent: true }
  } catch (e) {
    console.error('Mailversand fehlgeschlagen:', e)
    // Im Dev-Modus die echte SMTP-Fehlermeldung durchreichen (z. B. falsches
    // Passwort, Host nicht erreichbar) — in Produktion bewusst generisch,
    // um keine Infrastrukturdetails nach außen zu geben.
    const detail = e instanceof Error ? e.message : String(e)
    return {
      sent: false,
      reason: process.env.NODE_ENV === 'development' ? `SMTP-Versand fehlgeschlagen: ${detail}` : 'SMTP-Versand fehlgeschlagen',
    }
  }
}
