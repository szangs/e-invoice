// System-Mails über die zentralen SMTP-Einstellungen (§24)
import nodemailer from 'nodemailer'
import { getSettings } from '@/lib/settings'

export type MailResult = { sent: boolean; reason?: string }

export async function sendSystemMail(to: string, subject: string, text: string): Promise<MailResult> {
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
    await transporter.sendMail({ from: s.SMTP_FROM, to, subject, text })
    return { sent: true }
  } catch (e) {
    console.error('Mailversand fehlgeschlagen:', e)
    return { sent: false, reason: 'SMTP-Versand fehlgeschlagen' }
  }
}
