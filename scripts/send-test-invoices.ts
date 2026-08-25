// Test-Rechnungen per Kommandozeile verschicken — dünner Wrapper um
// lib/testInvoices.ts (dieselbe Logik nutzt auch der "Testrechnungen senden"-
// Knopf im Betreiber-Cockpit, siehe api/platform/tenants/[id]/test-invoices).
//
// Aufruf:  npx tsx scripts/send-test-invoices.ts [Anzahl] [Ziel-E-Mail]
// Beispiel: npx tsx scripts/send-test-invoices.ts 10 stefan.zangs@deltaplus.de
// Ohne Angabe: 10 Rechnungen an das in den Systemeinstellungen hinterlegte
// sendende Postfach (MS_SENDER_EMAIL).
import { readFileSync } from 'fs'
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
/* eslint-disable import/first */
import { getSettings } from '../src/lib/settings'
import { sendTestInvoices } from '../src/lib/testInvoices'

async function main() {
  const count = Number(process.argv[2]) || 10
  const to = process.argv[3] || (await getSettings()).MS_SENDER_EMAIL || (await getSettings()).SMTP_FROM
  if (!to) {
    console.error('Keine Ziel-E-Mail angegeben und kein Postfach in den Systemeinstellungen konfiguriert.')
    console.error('Aufruf: npx tsx scripts/send-test-invoices.ts [Anzahl] [Ziel-E-Mail]')
    process.exit(1)
  }
  const { sent, failed, log } = await sendTestInvoices(to, count)
  log.forEach((l) => console.log(l))
  console.log(`Fertig. Gesendet: ${sent}, fehlgeschlagen: ${failed}. Ziel: ${to}`)
}

main()
