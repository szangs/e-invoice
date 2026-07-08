// Sicherungs- und Berichts-Zeitplan (§17 + revisionssicherer Hash-Bericht):
// eigener Prozess, prüft stündlich, welche Mandanten-/System-Sicherungen UND
// welche Hash-Berichte fällig sind (Tage/Wochen/Monate/Jahre), und stellt sie
// zu (E-Mail und/oder Sicherungsziel-Verzeichnis).
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
import { runBackupReminders } from '../src/lib/backupPackage'
import { runDueBasketNotifications } from '../src/lib/baskets'
import { runDueReports } from '../src/lib/report'

const INTERVAL_MS = 60 * 60 * 1000 // stündliche Fälligkeitsprüfung

async function tick() {
  const stamp = new Date().toISOString()
  try {
    const log = await runDueBackups(false)
    if (log.length === 0) console.log(`[${stamp}] Keine Sicherung fällig.`)
    else log.forEach((l) => console.log(`[${stamp}] ${l}`))
  } catch (e) {
    console.error('Sicherungslauf fehlgeschlagen:', e)
  }
  try {
    const log = await runDueReports(false)
    if (log.length === 0) console.log(`[${stamp}] Kein Bericht fällig.`)
    else log.forEach((l) => console.log(`[${stamp}] ${l}`))
  } catch (e) {
    console.error('Berichtslauf fehlgeschlagen:', e)
  }
  try {
    const log = await runDueBasketNotifications(false)
    if (log.length === 0) console.log(`[${stamp}] Keine Korb-Benachrichtigung fällig.`)
    else log.forEach((l) => console.log(`[${stamp}] ${l}`))
  } catch (e) {
    console.error('Korb-Benachrichtigungslauf fehlgeschlagen:', e)
  }
  try {
    const log = await runBackupReminders(false)
    if (log.length === 0) console.log(`[${stamp}] Keine Sicherungs-Erinnerung fällig.`)
    else log.forEach((l) => console.log(`[${stamp}] ${l}`))
  } catch (e) {
    console.error('Sicherungs-Erinnerungslauf fehlgeschlagen:', e)
  }
}

console.log('E-Invoice Sicherungs-, Berichts- und Korb-Zeitplan läuft (Prüfung stündlich).')
tick()
setInterval(tick, INTERVAL_MS)
