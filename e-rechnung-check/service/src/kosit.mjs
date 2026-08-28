// KoSIT-Validierung: ruft den offiziellen KoSIT-Validator
// (itplr-kosit/validator) mit der XRechnung-Konfiguration
// (itplr-kosit/validator-configuration-xrechnung) als Java-Subprozess auf und
// wertet den Prüfbericht (VARL + eingebettetes SVRL) aus.
//
// Einrichtung: node setup-kosit.mjs  (lädt JAR + Konfiguration nach ./kosit/)
// Laufzeit:    Java 11+ im PATH (oder JAVA_BIN setzen)
//
// Umgebungsvariablen:
//   KOSIT_VALIDATOR_JAR  Pfad zur validationtool-*-standalone.jar
//   KOSIT_SCENARIOS      Pfad zur scenarios.xml der XRechnung-Konfiguration
//   JAVA_BIN             optional, Default "java"
//   KOSIT_TIMEOUT_MS     optional, Default 120000
//
// Ohne gültige Konfiguration liefert validateWithKosit() { available: false }.
import { spawn } from 'node:child_process'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'

const LEVEL_ORDER = ['fatal', 'error', 'warning', 'information']

function javaBin() {
  return process.env.JAVA_BIN?.trim() || 'java'
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function kositConfig() {
  const jar = process.env.KOSIT_VALIDATOR_JAR?.trim()
  const scenarios = process.env.KOSIT_SCENARIOS?.trim()
  if (!jar || !scenarios) {
    return {
      ok: false,
      reason:
        'KoSIT-Validator ist nicht eingerichtet (KOSIT_VALIDATOR_JAR / KOSIT_SCENARIOS fehlen). Einmalig "node setup-kosit.mjs" ausführen.',
    }
  }
  if (!(await exists(jar))) return { ok: false, reason: `Validator-JAR nicht gefunden: ${jar}` }
  if (!(await exists(scenarios)))
    return { ok: false, reason: `scenarios.xml nicht gefunden: ${scenarios}` }
  return { ok: true, jar, scenarios }
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`KoSIT-Validator: Zeitüberschreitung (${Math.round(timeoutMs / 1000)} s).`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/** Führt den KoSIT-Validator für ein XRechnung-/CII-/UBL-XML aus. */
export async function validateWithKosit(xml) {
  const cfg = await kositConfig()
  if (!cfg.ok) return { available: false, reason: cfg.reason }

  const timeoutMs = Number(process.env.KOSIT_TIMEOUT_MS || 120_000)
  const dir = await mkdtemp(join(tmpdir(), 'kosit-'))
  try {
    const inputPath = join(dir, 'invoice.xml')
    await writeFile(inputPath, xml, 'utf8')
    const repository = dirname(cfg.scenarios)
    const args = ['-jar', cfg.jar, '-s', cfg.scenarios, '-r', repository, '-h', '-o', dir, inputPath]

    let res
    try {
      res = await run(javaBin(), args, timeoutMs)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/ENOENT/.test(msg)) {
        return {
          available: false,
          reason: `Java wurde nicht gefunden ("${javaBin()}"). Bitte Java 11+ installieren oder JAVA_BIN setzen.`,
        }
      }
      return { available: false, reason: `KoSIT-Validator konnte nicht gestartet werden: ${msg}` }
    }

    const files = await readdir(dir)
    const xmlName =
      files.find((f) => /-report\.xml$/i.test(f)) ??
      files.find((f) => f.endsWith('.xml') && f !== 'invoice.xml')
    const htmlName = files.find((f) => /\.html?$/i.test(f))
    if (!xmlName) {
      const detail = (res.stderr || res.stdout || '').trim().slice(0, 600)
      return {
        available: false,
        reason: `Der KoSIT-Validator hat keinen Prüfbericht erzeugt (Exit ${res.code}). ${detail}`.trim(),
      }
    }
    const reportXml = await readFile(join(dir, xmlName), 'utf8')
    const reportHtml = htmlName ? await readFile(join(dir, htmlName), 'utf8') : null
    return parseKositReport(reportXml, reportHtml)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ── Report-Auswertung ─────────────────────────────────────────────────────
function walk(node, visit) {
  if (node == null || typeof node !== 'object') return
  for (const [key, raw] of Object.entries(node)) {
    const items = Array.isArray(raw) ? raw : [raw]
    for (const item of items) {
      visit(key, item)
      if (item && typeof item === 'object') walk(item, visit)
    }
  }
}

function textOf(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    if ('#text' in v) return String(v['#text'])
    if ('text' in v) return textOf(v.text)
    return Object.entries(v)
      .filter(([k]) => !k.startsWith('@_'))
      .map(([, val]) => textOf(val))
      .join(' ')
  }
  return String(v)
}

function clean(s) {
  return s.replace(/\s+/g, ' ').trim()
}

function mapSvrl(kind, v) {
  const flag = String(v?.['@_flag'] ?? '').toLowerCase()
  const text = clean(textOf(v?.text ?? v))
  let ruleId = v?.['@_id'] ?? null
  if (!ruleId) {
    const m = text.match(/\[([A-Z]{2,}[A-Z0-9-]*)\]/)
    ruleId = m?.[1] ?? null
  }
  let level
  if (flag === 'fatal') level = 'fatal'
  else if (flag === 'warning' || flag === 'warn') level = 'warning'
  else if (flag === 'info' || flag === 'information') level = 'information'
  else level = kind === 'successful-report' ? 'information' : 'error'
  return {
    level,
    ruleId,
    text,
    location: v?.['@_location'] ?? null,
    test: v?.['@_test'] ?? null,
    kind,
  }
}

function mapReportMessage(v) {
  const lvl = String(v?.['@_level'] ?? '').toLowerCase()
  const level =
    lvl === 'error' ? 'error' : lvl === 'warning' ? 'warning' : lvl === 'fatal' ? 'fatal' : 'information'
  return {
    level,
    ruleId: v?.['@_code'] ?? null,
    text: clean(textOf(v)),
    location: v?.['@_xpathLocation'] ?? v?.['@_location'] ?? null,
    test: null,
    kind: 'message',
  }
}

export function parseKositReport(reportXml, reportHtml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    textNodeName: '#text',
  })
  let obj
  try {
    obj = parser.parse(reportXml)
  } catch (e) {
    return { available: false, reason: `Prüfbericht konnte nicht gelesen werden: ${String(e)}` }
  }

  const messages = []
  let recommendation = null
  let scenario = null
  let engine = null
  let timestamp = null

  walk(obj, (key, value) => {
    if (key === 'failed-assert' || key === 'successful-report') {
      messages.push(mapSvrl(key, value))
    } else if (
      key === 'message' &&
      value &&
      typeof value === 'object' &&
      ('@_level' in value || '@_code' in value)
    ) {
      messages.push(mapReportMessage(value))
    } else if (key === 'acceptRecommendation' || key === 'accept') {
      const t = clean(textOf(value))
      if (t) recommendation = t
    } else if (key === 'scenario' && value && typeof value === 'object' && 'name' in value) {
      scenario = clean(textOf(value.name)) || scenario
    } else if (
      key === 'name' &&
      scenario == null &&
      typeof value === 'string' &&
      /xrechnung|zugferd|cii|ubl/i.test(value)
    ) {
      scenario = clean(value)
    } else if (key === 'engine' && !engine) {
      engine = clean(textOf(value)) || null
    } else if (key === 'timestamp' && !timestamp) {
      timestamp = clean(textOf(value)) || null
    }
  })

  const seen = new Set()
  const deduped = messages.filter((m) => {
    const k = `${m.level}|${m.ruleId}|${m.text}|${m.location}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const counts = { fatal: 0, error: 0, warning: 0, information: 0 }
  for (const m of deduped) counts[m.level]++

  // KoSIT lehnt bei fatalen/fehlerhaften Schematron-Assertions ab; Warnungen
  // allein führen nicht zur Ablehnung. Die Text-Empfehlung wird zusätzlich
  // ausgewertet ("reject" / "unacceptable"), aber Fehler zählen immer.
  const rec = (recommendation || '').toLowerCase()
  const rejected =
    counts.fatal > 0 || counts.error > 0 || /reject|unacceptable|not.?acceptable/.test(rec)

  return {
    available: true,
    accepted: !rejected,
    recommendation,
    scenario,
    engine,
    timestamp,
    counts,
    messages: deduped.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)),
    reportXml,
    reportHtml,
  }
}
