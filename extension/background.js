// Rechnungs-Catcher — Service Worker:
// lädt die gefangene Datei über die Browser-Sitzung des Nutzers (Portal-Logins
// bleiben beim Kunden), verschlüsselt bei Bedarf und überträgt an E-Invoice.
import { b64decode, encryptBytes, importDek } from './crypto.js'

const MAX_BYTES = 10 * 1024 * 1024

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNsaGj4DwAFhAJ/l6oGvQAAAABJRU5ErkJggg==',
    title,
    message,
  })
}

function filenameFromUrl(url, fallback) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    if (last && last.includes('.')) return last.slice(0, 100)
  } catch {
    /* ignore */
  }
  return fallback || 'beleg.pdf'
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'catch') return
  handleCatch(msg).catch((e) => notify('E-Invoice: Fehler', String(e?.message || e)))
})

async function handleCatch(msg) {
  const { serverUrl, token } = await chrome.storage.local.get(['serverUrl', 'token'])
  if (!serverUrl || !token) {
    notify('E-Invoice: nicht eingerichtet', 'Bitte Server-Adresse und API-Token im Plugin-Popup eintragen.')
    return
  }
  const base = serverUrl.replace(/\/$/, '')

  // 1. Mandanten-Konfiguration (inkl. Verschlüsselung) abrufen
  const cfgRes = await fetch(`${base}/api/ingest/extension`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!cfgRes.ok) {
    notify('E-Invoice: Token ungültig', 'Bitte API-Token im Plugin-Popup prüfen.')
    return
  }
  const cfg = await cfgRes.json()

  // 2. Datei über die Sitzung des Nutzers laden (Portal-Login bleibt beim Kunden)
  const fileRes = await fetch(msg.url, { credentials: 'include' })
  if (!fileRes.ok) throw new Error(`Download fehlgeschlagen (${fileRes.status})`)
  const buffer = await fileRes.arrayBuffer()
  if (buffer.byteLength === 0) throw new Error('Leere Datei erhalten')
  if (buffer.byteLength > MAX_BYTES) throw new Error('Datei größer als 10 MB')
  const mime = (fileRes.headers.get('content-type') || 'application/pdf').split(';')[0]
  const filename = filenameFromUrl(msg.url, msg.filename)

  // 3. Optional verschlüsseln — Pflicht, wenn der Mandant Verschlüsselung aktiv hat
  const fd = new FormData()
  fd.append('sourceUrl', msg.url)
  if (cfg.encryption?.enabled) {
    const { dekRaw } = await chrome.storage.session.get('dekRaw')
    if (!dekRaw) {
      notify('E-Invoice: gesperrt', 'Verschlüsselung aktiv — bitte im Plugin-Popup mit der Passphrase entsperren.')
      return
    }
    const dek = await importDek(b64decode(dekRaw))
    const cipher = await encryptBytes(dek, buffer)
    fd.append('file', new Blob([cipher]), `${filename}.enc`)
    fd.append('filename', `${filename}.enc`)
    fd.append('encrypted', '1')
    fd.append('encOrigMime', mime)
  } else {
    fd.append('file', new Blob([buffer], { type: mime }), filename)
    fd.append('filename', filename)
  }

  // 4. Übertragen
  const upRes = await fetch(`${base}/api/ingest/extension`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  const data = await upRes.json().catch(() => ({}))
  if (!upRes.ok) throw new Error(data.error || `Upload fehlgeschlagen (${upRes.status})`)

  notify(
    'E-Invoice: Rechnung gefangen',
    `${data.vendor} · ${filename}${cfg.encryption?.enabled ? ' · verschlüsselt übertragen' : ''}`,
  )
}
