// Weg B: eigener SMTP-Empfänger — der Server WARTET auf weitergeleitete E-Mails.
// Catch-All über die Einlieferungs-Subdomain: angenommen wird jede Adresse nach dem
// Muster {präfix}{kurzname}@{domain} eines existierenden, aktiven Mandanten.
// Absender-Beschränkung (global + je Mandant) wird in handleParsedMail erzwungen.
//
// Start (eigener Prozess neben dem Web-Server):   npm run smtp
// Produktion: Port 25 per Firewall/Portweiterleitung auf MAIL_SMTP_PORT lenken,
// MX-Eintrag der Subdomain (MAIL_IN_DOMAIN) auf diesen Server zeigen lassen.
import { readFileSync } from 'fs'

// .env.local selbst laden (eigener Prozess, keine Next.js-Umgebung)
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  /* optional */
}

/* eslint-disable import/first */
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import { handleParsedMail } from '../src/lib/mailin'
import { prisma } from '../src/lib/db'
import { getSettings } from '../src/lib/settings'

const MAX_MESSAGE_BYTES = 15 * 1024 * 1024

async function main() {
  const s = await getSettings()
  if (s.MAIL_SMTP_ENABLED !== '1') {
    console.log('SMTP-Empfänger ist deaktiviert (SP01 → "SMTP-Empfänger aktiv"). Beende.')
    process.exit(0)
  }
  const port = Number(s.MAIL_SMTP_PORT || 2525)
  const domain = (s.MAIL_IN_DOMAIN || '').toLowerCase()
  if (!domain) {
    console.error('MAIL_IN_DOMAIN fehlt (SP01 → Mail-Eingang → Basis-Domain). Beende.')
    process.exit(1)
  }
  // beliebig@<kurzname>.<basis-domain> — Kurzname = Mandanten-Slug als Subdomain
  const pattern = new RegExp(`^[^@\\s]+@([a-z0-9-]+)\\.${domain.replace(/\./g, '\\.')}$`)

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH'],
    size: MAX_MESSAGE_BYTES,
    banner: 'E-Invoice Einlieferung',

    // Empfänger früh prüfen: nur Muster-Adressen existierender, aktiver Mandanten
    async onRcptTo(address, _session, callback) {
      const to = address.address.toLowerCase()
      const m = to.match(pattern)
      if (!m) return callback(new Error('550 Adresse hier nicht vorhanden'))
      const tenant = await prisma.tenant.findUnique({ where: { slug: m[1] } })
      if (!tenant || !tenant.active) return callback(new Error('550 Adresse hier nicht vorhanden'))
      callback()
    },

    onData(stream, session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', async () => {
        try {
          if (stream.sizeExceeded) {
            callback(new Error('552 Nachricht zu groß'))
            return
          }
          const parsed = await simpleParser(Buffer.concat(chunks))
          const rcpts = session.envelope.rcptTo.map((r) => r.address.toLowerCase())
          const result = await handleParsedMail(parsed, rcpts, 'SMTP')
          console.log(
            `[${new Date().toISOString()}] Mail von ${session.envelope.mailFrom && session.envelope.mailFrom.address} → ${rcpts.join(', ')} · ${
              result.ok ? `${result.processed} Beleg(e)` : 'abgewiesen/protokolliert'
            }`,
          )
          callback()
        } catch (e) {
          console.error('Verarbeitung fehlgeschlagen:', e)
          callback(new Error('451 Vorübergehender Fehler, bitte erneut senden'))
        }
      })
    },
  })

  server.on('error', (e) => console.error('SMTP-Fehler:', e.message))
  server.listen(port, () => {
    console.log(`E-Invoice SMTP-Empfänger läuft auf Port ${port}`)
    console.log(`Angenommen wird: beliebig@<kurzname>.${domain} (nur aktive Mandanten)`)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
