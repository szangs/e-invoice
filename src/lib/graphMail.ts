// Mailversand über die Microsoft Graph API (/users/{mailbox}/sendMail) — Alternative zu SMTP,
// funktioniert auch wenn der Tenant SMTP AUTH (Basic wie OAuth2) für Exchange Online gesperrt hat.
// Benötigt eine Azure-AD-App-Registrierung mit Anwendungsberechtigung "Mail.Send" (Admin-Consent).
import { getMsAccessToken } from '@/lib/msGraphAuth'
import type { MailAttachment } from '@/lib/mail'

export async function sendViaGraph(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  senderMailbox: string,
  to: string,
  subject: string,
  text: string,
  attachments?: MailAttachment[],
  html?: string,
): Promise<void> {
  const token = await getMsAccessToken(tenantId, clientId, clientSecret, 'https://graph.microsoft.com/.default')

  const message = {
    subject,
    body: html ? { contentType: 'HTML', content: html } : { contentType: 'Text', content: text },
    toRecipients: [{ emailAddress: { address: to } }],
    attachments: (attachments ?? []).map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentBytes: (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content)).toString('base64'),
    })),
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderMailbox)}/sendMail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, saveToSentItems: false }),
  })
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Graph sendMail fehlgeschlagen (${res.status}): ${errBody.slice(0, 300)}`)
  }
}
