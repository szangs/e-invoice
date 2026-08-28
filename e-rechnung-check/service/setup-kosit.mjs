// Einmalige Einrichtung des offiziellen KoSIT-Validators für den Prüfdienst.
//
//   node setup-kosit.mjs
//
// Lädt nach ./kosit/ :
//   • validator ................. itplr-kosit/validator (validationtool-*-standalone.jar)
//   • validator-configuration ... itplr-kosit/validator-configuration-xrechnung (scenarios.xml + Ressourcen)
// und schreibt KOSIT_VALIDATOR_JAR / KOSIT_SCENARIOS nach ./.env.
//
// Laufzeit-Voraussetzung (nicht für dieses Skript): Java 11+ im PATH.
// Optionale Umgebungsvariablen:
//   KOSIT_VALIDATOR_TAG  Release-Tag des Validators        (Default: latest)
//   KOSIT_CONFIG_TAG     Release-Tag der XRechnung-Config   (Default: latest)
//   GITHUB_TOKEN         hebt das GitHub-API-Ratelimit an   (optional)
import AdmZip from 'adm-zip'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const KOSIT_DIR = join(ROOT, 'kosit')
const ENV_FILE = join(ROOT, '.env')

async function ghRelease(repo, tag) {
  const url = tag
    ? `https://api.github.com/repos/${repo}/releases/tags/${tag}`
    : `https://api.github.com/repos/${repo}/releases/latest`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'e-rechnung-check-setup',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status} für ${repo} (${url})`)
  return res.json()
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'e-rechnung-check-setup' } })
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function findFile(dir, match) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = await findFile(full, match)
      if (hit) return hit
    } else if (match(entry.name)) {
      return full
    }
  }
  return null
}

async function upsertEnv(vars) {
  let content = existsSync(ENV_FILE) ? await readFile(ENV_FILE, 'utf8') : ''
  if (content && !content.endsWith('\n')) content += '\n'
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`
    const re = new RegExp(`^${key}=.*$`, 'm')
    content = re.test(content) ? content.replace(re, line) : content + line + '\n'
  }
  await writeFile(ENV_FILE, content, 'utf8')
}

async function main() {
  console.log('KoSIT-Validator wird eingerichtet …\n')
  await mkdir(KOSIT_DIR, { recursive: true })

  // 1) Validator (JAR)
  const validatorRel = await ghRelease('itplr-kosit/validator', process.env.KOSIT_VALIDATOR_TAG)
  console.log(`• Validator-Release: ${validatorRel.tag_name}`)
  const jarAsset =
    validatorRel.assets.find((a) => /standalone\.jar$/i.test(a.name)) ??
    validatorRel.assets.find((a) => /distribution\.zip$/i.test(a.name)) ??
    validatorRel.assets.find((a) => /\.zip$/i.test(a.name))
  if (!jarAsset) throw new Error('Kein passendes Validator-Asset gefunden.')

  const validatorDir = join(KOSIT_DIR, 'validator')
  await mkdir(validatorDir, { recursive: true })
  console.log(`  ↓ ${jarAsset.name}`)
  const jarBuf = await download(jarAsset.browser_download_url)
  if (/\.zip$/i.test(jarAsset.name)) {
    new AdmZip(jarBuf).extractAllTo(validatorDir, true)
  } else {
    await writeFile(join(validatorDir, jarAsset.name), jarBuf)
  }
  const jarPath = await findFile(validatorDir, (n) => /standalone\.jar$/i.test(n))
  if (!jarPath) throw new Error('validationtool-*-standalone.jar nach dem Entpacken nicht gefunden.')

  // 2) XRechnung-Konfiguration
  const configRel = await ghRelease(
    'itplr-kosit/validator-configuration-xrechnung',
    process.env.KOSIT_CONFIG_TAG,
  )
  console.log(`• Konfigurations-Release: ${configRel.tag_name}`)
  const cfgAsset =
    configRel.assets.find((a) => /^validator-configuration-xrechnung.*\.zip$/i.test(a.name)) ??
    configRel.assets.find((a) => /\.zip$/i.test(a.name))
  if (!cfgAsset) throw new Error('Kein ZIP-Asset der XRechnung-Konfiguration gefunden.')

  const configDir = join(KOSIT_DIR, 'configuration')
  await mkdir(configDir, { recursive: true })
  console.log(`  ↓ ${cfgAsset.name}`)
  new AdmZip(await download(cfgAsset.browser_download_url)).extractAllTo(configDir, true)
  const scenariosPath = await findFile(configDir, (n) => n === 'scenarios.xml')
  if (!scenariosPath) throw new Error('scenarios.xml nach dem Entpacken nicht gefunden.')

  await upsertEnv({ KOSIT_VALIDATOR_JAR: jarPath, KOSIT_SCENARIOS: scenariosPath })

  const jarSize = (await stat(jarPath)).size
  console.log('\n✓ Fertig.')
  console.log(`  KOSIT_VALIDATOR_JAR=${relative(ROOT, jarPath)}  (${(jarSize / 1_048_576).toFixed(1)} MB)`)
  console.log(`  KOSIT_SCENARIOS=${relative(ROOT, scenariosPath)}`)
  console.log('\n  → in ./.env eingetragen. Dienst neu starten (systemctl restart e-rechnung-check).')
  console.log('  → Laufzeit braucht Java 11+ (java -version).')
}

main().catch((e) => {
  console.error('\n✗ Einrichtung fehlgeschlagen:', e instanceof Error ? e.message : e)
  process.exit(1)
})
