// System-Mails über die zentralen Mail-Einstellungen (§24).
// Drei Anbieter (MAIL_PROVIDER): klassisches SMTP mit Benutzer/Passwort, Office-365-SMTP
// mit OAuth2/XOAUTH2 (App-Registrierung), oder Versand über die Microsoft Graph API —
// Letztere zwei nötig, weil Microsoft SMTP AUTH mit Basic Auth für Exchange Online
// tenant-weit deaktiviert (Ausnahmen laufen aus).
import nodemailer from 'nodemailer'
import { getSettings } from '@/lib/settings'
import { getMsAccessToken } from '@/lib/msGraphAuth'
import { sendViaGraph } from '@/lib/graphMail'

export type MailResult = { sent: boolean; reason?: string }
export type MailAttachment = { filename: string; content: Buffer | string }

export async function sendSystemMail(
  to: string,
  subject: string,
  text: string,
  attachments?: MailAttachment[],
  html?: string,
): Promise<MailResult> {
  const s = await getSettings()
  const provider = s.MAIL_PROVIDER || 'SMTP'

  try {
    if (provider === 'GRAPH') {
      if (!s.MS_TENANT_ID || !s.MS_CLIENT_ID || !s.MS_CLIENT_SECRET || !s.MS_SENDER_EMAIL) {
        return { sent: false, reason: 'Microsoft-Graph-Zugangsdaten nicht vollständig konfiguriert (Systemeinstellungen)' }
      }
      await sendViaGraph(s.MS_TENANT_ID, s.MS_CLIENT_ID, s.MS_CLIENT_SECRET, s.MS_SENDER_EMAIL, to, subject, text, attachments, html)
      return { sent: true }
    }

    if (provider === 'SMTP_OAUTH2') {
      if (!s.MS_TENANT_ID || !s.MS_CLIENT_ID || !s.MS_CLIENT_SECRET || !s.MS_SENDER_EMAIL) {
        return { sent: false, reason: 'Microsoft-OAuth2-Zugangsdaten nicht vollständig konfiguriert (Systemeinstellungen)' }
      }
      const accessToken = await getMsAccessToken(
        s.MS_TENANT_ID,
        s.MS_CLIENT_ID,
        s.MS_CLIENT_SECRET,
        'https://outlook.office365.com/.default',
      )
      const transporter = nodemailer.createTransport({
        host: s.SMTP_HOST || 'smtp.office365.com',
        port: Number(s.SMTP_PORT || 587),
        secure: false,
        requireTLS: true,
        auth: { type: 'OAuth2', user: s.MS_SENDER_EMAIL, accessToken },
      })
      await transporter.sendMail({ from: s.SMTP_FROM || s.MS_SENDER_EMAIL, to, subject, text, html, attachments })
      return { sent: true }
    }

    // Standard: klassisches SMTP mit Benutzername/Passwort
    if (!s.SMTP_HOST || !s.SMTP_FROM) {
      return { sent: false, reason: 'SMTP nicht konfiguriert (Systemeinstellungen)' }
    }
    const transporter = nodemailer.createTransport({
      host: s.SMTP_HOST,
      port: Number(s.SMTP_PORT || 587),
      secure: s.SMTP_SECURE === '1',
      auth: s.SMTP_USER ? { user: s.SMTP_USER, pass: s.SMTP_PASS } : undefined,
    })
    await transporter.sendMail({ from: s.SMTP_FROM, to, subject, text, html, attachments })
    return { sent: true }
  } catch (e) {
    console.error('Mailversand fehlgeschlagen:', e)
    // Im Dev-Modus die echte Fehlermeldung durchreichen (z. B. falsches
    // Passwort, Host nicht erreichbar, fehlende Graph-Berechtigung) — in
    // Produktion bewusst generisch, um keine Infrastrukturdetails preiszugeben.
    const detail = e instanceof Error ? e.message : String(e)
    return {
      sent: false,
      reason: process.env.NODE_ENV === 'development' ? `Mailversand fehlgeschlagen: ${detail}` : 'Mailversand fehlgeschlagen',
    }
  }
}
