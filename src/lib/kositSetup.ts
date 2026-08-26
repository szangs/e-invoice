// KoSIT-Validator: Installation/Update (Stefan 2026-08-26) — lädt die
// offizielle Prüf-Software der Koordinierungsstelle für IT-Standards (KoSIT)
// herunter: eine portable JRE (kein Java auf dem Server vorausgesetzt), das
// validator.jar und das aktuelle Schematron-Regelwerk für XRechnung. Landet
// in tools/kosit/ (gitignored, siehe .gitignore) — bewusst NICHT im Repo,
// da groß/binär und über diese Funktion ohnehin austauschbar. Getrennt von
// lib/kositValidator.ts (das nur noch die bereits installierten Dateien
// AUSFÜHRT, keine Netzwerkzugriffe).
import AdmZip from 'adm-zip'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const KOSIT_DIR = path.join(process.cwd(), 'tools', 'kosit')
const VERSION_FILE = path.join(KOSIT_DIR, 'version.json')
const JRE_DIR = path.join(KOSIT_DIR, 'jre')
export const JAVA_BIN = path.join(JRE_DIR, 'bin', 'java')
export const VALIDATOR_JAR = path.join(KOSIT_DIR, 'validator.jar')
export const CONFIG_DIR = path.join(KOSIT_DIR, 'config')
export const SCENARIOS_FILE = path.join(CONFIG_DIR, 'scenarios.xml')

const TEMURIN_JRE_URL =
  'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_linux_hotspot_17.0.20.1_1.tar.gz'

export type KositVersions = {
  validatorVersion: string
  configVersion: string
  configTitle: string
  installedAt: string
}

export async function readInstalledVersions(): Promise<KositVersions | null> {
  try {
    return JSON.parse(await readFile(VERSION_FILE, 'utf8'))
  } catch {
    return null
  }
}

export function isKositInstalled(): boolean {
  return existsSync(JAVA_BIN) && existsSync(VALIDATOR_JAR) && existsSync(SCENARIOS_FILE)
}

type GithubAsset = { name: string; size: number; browser_download_url: string }
type GithubRelease = { tag_name: string; name: string; assets: GithubAsset[] }

async function fetchLatestRelease(repo: string): Promise<GithubRelease> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub-API für ${repo} nicht erreichbar (${res.status}).`)
  return res.json()
}

/** Neuste Validator-/Regelwerk-Version auf GitHub ermitteln, ohne etwas herunterzuladen. */
export async function checkForKositUpdates(): Promise<{
  installed: KositVersions | null
  latestValidatorVersion: string
  latestConfigVersion: string
  latestConfigTitle: string
  updateAvailable: boolean
}> {
  const [validatorRelease, configRelease] = await Promise.all([
    fetchLatestRelease('itplr-kosit/validator'),
    fetchLatestRelease('itplr-kosit/validator-configuration-xrechnung'),
  ])
  const installed = await readInstalledVersions()
  const updateAvailable =
    !installed ||
    installed.validatorVersion !== validatorRelease.tag_name ||
    installed.configVersion !== configRelease.tag_name
  return {
    installed,
    latestValidatorVersion: validatorRelease.tag_name,
    latestConfigVersion: configRelease.tag_name,
    latestConfigTitle: configRelease.name,
    updateAvailable,
  }
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(destPath, buf)
}

/** JRE nur EINMAL installieren (Java-Runtime selbst braucht praktisch nie ein Update). */
async function ensureJre(): Promise<void> {
  if (existsSync(JAVA_BIN)) return
  await mkdir(KOSIT_DIR, { recursive: true })
  const tarPath = path.join(KOSIT_DIR, 'jre.tar.gz')
  await downloadToFile(TEMURIN_JRE_URL, tarPath)
  await mkdir(JRE_DIR, { recursive: true })
  // --strip-components=1: das Tarball-Root-Verzeichnis (z. B. "jdk-17.../")
  // überspringen, direkt jre/bin/java statt jre/jdk-17.../bin/java.
  await execFileAsync('tar', ['xzf', tarPath, '-C', JRE_DIR, '--strip-components=1'])
  await rm(tarPath)
}

/**
 * Validator.jar + Regelwerk auf die neuste GitHub-Version bringen (Stefan
 * 2026-08-26) — von einem Admin im Betreiber-Cockpit ausgelöst (siehe
 * api/admin/kosit/update/route.ts), kein automatischer Hintergrund-Download.
 * JRE wird bei Bedarf mitinstalliert (einmalig).
 */
export async function installOrUpdateKositValidator(): Promise<KositVersions> {
  await mkdir(KOSIT_DIR, { recursive: true })
  await ensureJre()

  const [validatorRelease, configRelease] = await Promise.all([
    fetchLatestRelease('itplr-kosit/validator'),
    fetchLatestRelease('itplr-kosit/validator-configuration-xrechnung'),
  ])
  const jarAsset = validatorRelease.assets.find((a) => a.name.endsWith('-standalone.jar'))
  if (!jarAsset) throw new Error('Kein standalone.jar in der neusten Validator-Release gefunden.')
  const configAsset = configRelease.assets.find((a) => a.name.endsWith('.zip'))
  if (!configAsset) throw new Error('Kein .zip-Regelwerk in der neusten Konfigurations-Release gefunden.')

  // In temporäre Dateien laden und erst nach Erfolg umbenennen/entpacken —
  // ein fehlgeschlagener Download soll die noch funktionierende alte
  // Installation nicht kaputt machen.
  const jarTmp = path.join(KOSIT_DIR, 'validator.jar.download')
  await downloadToFile(jarAsset.browser_download_url, jarTmp)
  await rename(jarTmp, VALIDATOR_JAR)

  const configZipPath = path.join(KOSIT_DIR, 'config.zip.download')
  await downloadToFile(configAsset.browser_download_url, configZipPath)
  const configTmpDir = path.join(KOSIT_DIR, 'config.new')
  await rm(configTmpDir, { recursive: true, force: true })
  await mkdir(configTmpDir, { recursive: true })
  new AdmZip(configZipPath).extractAllTo(configTmpDir, true)
  await rm(configZipPath)
  await rm(CONFIG_DIR, { recursive: true, force: true })
  await rename(configTmpDir, CONFIG_DIR)

  const versions: KositVersions = {
    validatorVersion: validatorRelease.tag_name,
    configVersion: configRelease.tag_name,
    configTitle: configRelease.name,
    installedAt: new Date().toISOString(),
  }
  await writeFile(VERSION_FILE, JSON.stringify(versions, null, 2))
  return versions
}
