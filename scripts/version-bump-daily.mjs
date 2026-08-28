// Erhöht die Anwendungsversion an jedem Entwicklungstag automatisch um 0.0.1.
//
// Läuft über die npm-Hooks "predev" / "prebuild" (also bei jedem
// "npm run dev" bzw. "npm run build"). Manuell: "npm run version:daily".
//
// Wahrheitsort der Version: src/lib/config.ts  (APP_VERSION).
// Zusätzlich synchron gehalten: package.json.
// Letzter Bump-Tag: .version-date  (eingecheckt, damit alle Maschinen gleich zählen).
//
// Regel: Beim ersten Aufruf an einem neuen Kalendertag wird die Patch-Stelle
// um 1 erhöht. Mehrere Aufrufe am selben Tag ändern nichts. Übersprungene
// Tage werden NICHT nachgeholt ("jeden Tag Entwicklung + 0.0.1").
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(ROOT, 'src/lib/config.ts')
const PKG = join(ROOT, 'package.json')
const STAMP = join(ROOT, '.version-date')

const today = new Date().toISOString().slice(0, 10)
const last = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : ''

if (last === today) process.exit(0)

const configSrc = readFileSync(CONFIG, 'utf8')
const m = configSrc.match(/APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'/)
if (!m) {
  console.error('version-bump-daily: APP_VERSION in src/lib/config.ts nicht gefunden — übersprungen.')
  process.exit(0)
}

const [maj, min, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
// Erster Lauf ohne Stempel: aktuelle Version als Startpunkt festschreiben,
// nicht sofort erhöhen.
const next = last === '' ? `${maj}.${min}.${patch}` : `${maj}.${min}.${patch + 1}`

if (next !== `${maj}.${min}.${patch}`) {
  writeFileSync(CONFIG, configSrc.replace(m[0], `APP_VERSION = '${next}'`), 'utf8')
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
  pkg.version = next
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log(`version-bump-daily: ${maj}.${min}.${patch} → ${next}`)
}

writeFileSync(STAMP, today + '\n', 'utf8')
