// E-Mail-Eingang per POP3 (Alternative zum SMTP-Empfänger): eigener Prozess,
// fragt regelmäßig die Postfächer der dafür aktivierten Mandanten ab.
// Start:  npm run mailin-pop3   (Produktion: als pm2-Prozess)
import { readFileSync } from 'fs'

try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  /* optional */
}

/* eslint-disable import/first */
import { runPop3MailinPoll } from '../src/lib/pop3Mailin'

// Fester, feiner Grundtakt (siehe graph-mailin-poller.ts) — das eigentliche
// Poll-Intervall ist jetzt JE MANDANT einstellbar, siehe lib/mailinSchedule.ts.
const BASE_TICK_MS = 30_000

async function tick() {
  const stamp = new Date().toISOString()
  try {
    const log = await runPop3MailinPoll()
    log.forEach((l) => console.log(`[${stamp}] ${l}`))
  } catch (e) {
    console.error(`[${stamp}] POP3-Mail-Eingang fehlgeschlagen:`, e)
  }
}

async function main() {
  console.log('E-Invoice POP3-Mail-Eingang-Poller läuft.')
  await tick()
  setInterval(tick, BASE_TICK_MS)
}

main()
