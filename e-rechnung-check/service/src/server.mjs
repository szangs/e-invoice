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
// Keine Speicherung: die Datei existiert nur als Buffer im Arbeitsspeicher.
import { createServer } from 'node:http'
import { analyzeInvoiceFile, FORMAT_LABELS } from './erechnung.mjs'
import { kositConfig, validateWithKosit } from './kosit.mjs'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const MAX_BYTES = Number(process.env.MAX_BYTES || 15 * 1024 * 1024)
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 'https://www.deltaplus.de,https://deltaplus.de'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function setCors(req, res) {
  const origin = req.headers.origin
  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes('*') ? '*' : origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name')
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

const server = createServer(async (req, res) => {
  setCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/healthz') {
    const cfg = await kositConfig()
    json(res, 200, {
      ok: true,
      kosit: cfg.ok ? { configured: true } : { configured: false, reason: cfg.reason },
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    try {
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
    } catch (e) {
      const status = e && e.statusCode ? e.statusCode : 500
      if (status === 500) console.error('analyze-Fehler:', e)
      json(res, status, { error: status === 413 ? 'Datei zu groß (max. 15 MB).' : 'Interner Fehler bei der Prüfung.' })
    }
    return
  }

  json(res, 404, { error: 'Nicht gefunden.' })
})

server.listen(PORT, HOST, () => {
  console.log(`E-Rechnung-Check-Dienst läuft auf http://${HOST}:${PORT}`)
  console.log(`Erlaubte Origins: ${ALLOWED_ORIGINS.join(', ')}`)
  kositConfig().then((c) =>
    console.log(c.ok ? 'KoSIT-Validator: konfiguriert ✓' : `KoSIT-Validator: NICHT konfiguriert — ${c.reason}`),
  )
})
