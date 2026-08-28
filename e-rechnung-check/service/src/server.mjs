// KoSIT-Prüfdienst für die öffentliche E-Rechnungs-Teaser-Seite.
// Läuft auf dem vServer hinter einem TLS-Reverse-Proxy (siehe deploy/).
//
// Endpunkte:
//   GET  /healthz        → { ok, kosit: { configured, reason? } }
//   POST /api/analyze    → Rohbytes der Datei im Body,
//                          Dateiname im Header  X-File-Name,
//                          Typ im  Content-Type (application/pdf | application/xml).
//                          Antwort: JSON { format, data, formal, kosit, ... }
//
// Missbrauchsschutz (damit nicht jeder die API frei nutzt):
//   • strenge Origin/Referer-Prüfung  (nur Aufrufe von deltaplus.de)
//   • Rate-Limit je IP                (RATE_MAX / RATE_WINDOW_MS)
//   • globale Parallelitätsgrenze     (MAX_CONCURRENT — KoSIT ist CPU-intensiv)
//   • optional Cloudflare Turnstile   (TURNSTILE_SECRET gesetzt ⇒ Pflicht)
//   • optional statisches API-Token   (API_TOKEN gesetzt ⇒ Header X-Api-Token)
//
// Keine Speicherung: die Datei existiert nur als Buffer im Arbeitsspeicher.
import { createServer } from 'node:http'
import { analyzeInvoiceFile, FORMAT_LABELS } from './erechnung.mjs'
import { kositConfig, validateWithKosit } from './kosit.mjs'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const MAX_BYTES = Number(process.env.MAX_BYTES || 15 * 1024 * 1024)
const ALLOWED_ORIGINS = list(
  process.env.ALLOWED_ORIGINS ||
    'https://e-rechnung-api.deltaplus.de,https://e-rechnung.deltaplus.de,https://www.deltaplus.de,https://deltaplus.de',
)
const REQUIRE_ORIGIN = process.env.REQUIRE_ORIGIN !== 'false'
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false'
const RATE_MAX = Number(process.env.RATE_MAX || 15)
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 10 * 60 * 1000)
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 3)
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET?.trim() || null
const API_TOKEN = process.env.API_TOKEN?.trim() || null

function list(s) {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function setCors(req, res) {
  const origin = req.headers.origin
  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes('*') ? '*' : origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-File-Name, X-Turnstile-Token, X-Api-Token',
  )
  res.setHeader('Access-Control-Max-Age', '86400')
}

function json(res, status, body) {
  if (res.headersSent || !res.writable) return
  try {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(payload)
  } catch {
    /* Socket bereits geschlossen (z.B. nach Abbruch bei Überschreitung) */
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error('Datei zu groß.'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function looksAllowed(contentType, fileName) {
  const t = (contentType || '').split(';')[0].trim().toLowerCase()
  return (
    t === 'application/pdf' ||
    t === 'application/xml' ||
    t === 'text/xml' ||
    t === 'application/octet-stream' ||
    /\.(pdf|xml)$/i.test(fileName || '')
  )
}

// ── Missbrauchsschutz ─────────────────────────────────────────────────────
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for']
    if (xff) return String(xff).split(',')[0].trim()
  }
  return req.socket.remoteAddress || 'unknown'
}

/** true ⇒ Aufruf ist erlaubt (kommt von einer zugelassenen Domain). */
function originAllowed(req) {
  if (!REQUIRE_ORIGIN) return true
  const origin = req.headers.origin
  if (origin) return ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')
  // Kein Origin-Header (z.B. curl, serverseitige Clients): Referer verlangen.
  const ref = req.headers.referer || ''
  return ALLOWED_ORIGINS.some((o) => o !== '*' && ref.startsWith(o + '/'))
}

const hits = new Map() // ip → number[] (Zeitstempel)
function rateLimited(ip) {
  const now = Date.now()
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  arr.push(now)
  hits.set(ip, arr)
  return arr.length > RATE_MAX
}
setInterval(() => {
  const now = Date.now()
  for (const [ip, arr] of hits) {
    const keep = arr.filter((t) => now - t < RATE_WINDOW_MS)
    if (keep.length) hits.set(ip, keep)
    else hits.delete(ip)
  }
}, RATE_WINDOW_MS).unref?.()

let running = 0

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return true
  if (!token) return false
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token })
    if (ip && ip !== 'unknown') body.set('remoteip', ip)
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    })
    const j = await r.json()
    return j.success === true
  } catch {
    return false
  }
}

// ── HTTP ──────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  setCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/healthz') {
    const cfg = await kositConfig()
    json(res, 200, {
      ok: true,
      kosit: cfg.ok ? { configured: true } : { configured: false, reason: cfg.reason },
      turnstile: Boolean(TURNSTILE_SECRET),
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    const ip = clientIp(req)
    try {
      if (!originAllowed(req)) {
        json(res, 403, { error: 'Zugriff nur über die Delta-Plus-Website möglich.' })
        return
      }
      if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) {
        json(res, 401, { error: 'Kein gültiges API-Token.' })
        return
      }
      if (rateLimited(ip)) {
        res.setHeader('Retry-After', String(Math.ceil(RATE_WINDOW_MS / 1000)))
        json(res, 429, { error: 'Zu viele Anfragen. Bitte etwas später erneut versuchen.' })
        return
      }
      if (!(await verifyTurnstile(req.headers['x-turnstile-token'], ip))) {
        json(res, 403, { error: 'Bot-Prüfung fehlgeschlagen. Bitte Seite neu laden.' })
        return
      }
      if (running >= MAX_CONCURRENT) {
        res.setHeader('Retry-After', '20')
        json(res, 503, { error: 'Der Prüfdienst ist gerade ausgelastet. Bitte in einer Minute erneut versuchen.' })
        return
      }

      const fileName = req.headers['x-file-name']
        ? decodeURIComponent(String(req.headers['x-file-name']))
        : 'rechnung'
      const contentType = String(req.headers['content-type'] || '')
      if (!looksAllowed(contentType, fileName)) {
        json(res, 400, { error: 'Bitte eine PDF- (ZUGFeRD/Factur-X) oder XML-Rechnung (XRechnung) senden.' })
        return
      }

      const buffer = await readBody(req, MAX_BYTES)
      if (buffer.length === 0) {
        json(res, 400, { error: 'Keine Datei empfangen.' })
        return
      }

      running++
      try {
        const analysis = await analyzeInvoiceFile(buffer, contentType.split(';')[0].trim(), fileName)

        let kosit
        if (analysis.xml) {
          kosit = await validateWithKosit(analysis.xml)
        } else {
          kosit = {
            available: false,
            reason:
              analysis.format === 'PDF'
                ? 'Diese PDF enthält kein eingebettetes E-Rechnungs-XML (kein ZUGFeRD/Factur-X) — es gibt nichts, was nach KoSIT geprüft werden könnte.'
                : 'Kein E-Rechnungs-XML erkannt.',
          }
        }

        json(res, 200, {
          fileName,
          format: analysis.format,
          formatLabel: FORMAT_LABELS[analysis.format] || analysis.format,
          data: analysis.data,
          xml: analysis.xml,
          formal: analysis.validation,
          kosit,
        })
      } finally {
        running--
      }
    } catch (e) {
      const status = e && e.statusCode ? e.statusCode : 500
      if (status === 500) console.error('analyze-Fehler:', e)
      json(res, status, {
        error: status === 413 ? 'Datei zu groß (max. 15 MB).' : 'Interner Fehler bei der Prüfung.',
      })
    }
    return
  }

  json(res, 404, { error: 'Nicht gefunden.' })
})

server.listen(PORT, HOST, () => {
  console.log(`E-Rechnung-Check-Dienst läuft auf http://${HOST}:${PORT}`)
  console.log(`Erlaubte Origins: ${ALLOWED_ORIGINS.join(', ')}`)
  console.log(
    `Schutz: Rate-Limit ${RATE_MAX}/${Math.round(RATE_WINDOW_MS / 60000)}min · ` +
      `max ${MAX_CONCURRENT} parallel · Turnstile ${TURNSTILE_SECRET ? 'an' : 'aus'} · ` +
      `API-Token ${API_TOKEN ? 'an' : 'aus'}`,
  )
  kositConfig().then((c) =>
    console.log(c.ok ? 'KoSIT-Validator: konfiguriert ✓' : `KoSIT-Validator: NICHT konfiguriert — ${c.reason}`),
  )
})
