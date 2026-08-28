// E-Mail-Eingang per Microsoft Graph (Alternative zum SMTP-Empfänger): eigener
// Prozess, fragt regelmäßig die Postfächer/Ordner der dafür aktivierten Mandanten ab.
// Start:  npm run mailin-graph   (Produktion: als pm2-Prozess)
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
import { runGraphMailinPoll } from '../src/lib/graphMailin'

// Fester, feiner Grundtakt statt des früheren MAIL_IN_GRAPH_POLL_SECONDS-
// Intervalls (Stefan 2026-08-27, "bei Mailabholung müssen wir die Pollrate
// einstellen können"): das Poll-Intervall ist jetzt JE MANDANT einstellbar
// (Tenant.mailInPollSeconds, sonst der globale Standard) — runGraphMailinPoll
// selbst entscheidet pro Tick, welche Mandanten schon fällig sind (siehe
// lib/mailinSchedule.ts). Der Prozess muss deshalb nur noch feiner ticken
// als das kürzeste sinnvolle Mandanten-Intervall.
const BASE_TICK_MS = 30_000

async function tick() {
  const stamp = new Date().toISOString()
  try {
    const log = await runGraphMailinPoll()
    log.forEach((l) => console.log(`[${stamp}] ${l}`))
  } catch (e) {
    console.error(`[${stamp}] Graph-Mail-Eingang fehlgeschlagen:`, e)
  }
}

async function main() {
  console.log('E-Invoice Graph-Mail-Eingang-Poller läuft.')
  await tick()
  setInterval(tick, BASE_TICK_MS)
}

main()
