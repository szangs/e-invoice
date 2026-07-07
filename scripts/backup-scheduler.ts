// Sicherungs-Zeitplan (§17): eigener Prozess, prüft stündlich, welche
// Mandanten-/System-Sicherungen fällig sind (Tage/Wochen/Monate/Jahre)
// und stellt sie zu (E-Mail und/oder Sicherungsziel-Verzeichnis).
// Start:  npm run backup   (Produktion: als pm2-Prozess)
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
import { runDueBackups } from '../src/lib/backup'

const INTERVAL_MS = 60 * 60 * 1000 // stündliche Fälligkeitsprüfung

async function tick() {
  try {
    const log = await runDueBackups(false)
    const stamp = new Date().toISOString()
    if (log.length === 0) console.log(`[${stamp}] Keine Sicherung fällig.`)
    else log.forEach((l) => console.log(`[${stamp}] ${l}`))
  } catch (e) {
    console.error('Sicherungslauf fehlgeschlagen:', e)
  }
}

console.log('E-Invoice Sicherungs-Zeitplan läuft (Prüfung stündlich).')
tick()
setInterval(tick, INTERVAL_MS)
