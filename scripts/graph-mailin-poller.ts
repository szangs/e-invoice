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
import { getSettings } from '../src/lib/settings'

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
  const s = await getSettings()
  const intervalMs = Math.max(30, Number(s.MAIL_IN_GRAPH_POLL_SECONDS) || 120) * 1000
  setInterval(tick, intervalMs)
}

main()
