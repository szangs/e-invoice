// Rechnungs-Catcher — Popup: Einrichtung, Verbindungstest, Schlüssel entsperren
import { b64encode, deriveKek, unwrapDek } from './crypto.js'

const $ = (id) => document.getElementById(id)
let encConfig = null

function status(text, ok) {
  $('status').textContent = text
  $('status').className = ok ? 'ok' : 'err'
}

async function loadSettings() {
  const { serverUrl, token } = await chrome.storage.local.get(['serverUrl', 'token'])
  if (serverUrl) $('serverUrl').value = serverUrl
  if (token) $('token').value = token
  if (serverUrl && token) testConnection(false)
}

async function testConnection(save = true) {
  const serverUrl = $('serverUrl').value.trim().replace(/\/$/, '')
  const token = $('token').value.trim()
  if (!serverUrl || !token) {
    status('Bitte Server-Adresse und API-Token eintragen.', false)
    return
  }
  if (save) await chrome.storage.local.set({ serverUrl, token })
  try {
    const res = await fetch(`${serverUrl}/api/ingest/extension`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      status(`Verbindung fehlgeschlagen (${res.status}) — Token prüfen.`, false)
      return
    }
    const cfg = await res.json()
    encConfig = cfg.encryption
    if (encConfig?.enabled) {
      $('encBlock').style.display = 'block'
      const { dekRaw } = await chrome.storage.session.get('dekRaw')
      status(
        `Verbunden: ${cfg.tenantName} · Verschlüsselung aktiv${dekRaw ? ' · entsperrt' : ' · GESPERRT'}`,
        Boolean(dekRaw),
      )
    } else {
      $('encBlock').style.display = 'none'
      status(`Verbunden: ${cfg.tenantName}`, true)
    }
  } catch {
    status('Server nicht erreichbar.', false)
  }
}

async function unlock() {
  if (!encConfig?.enabled || !encConfig.salt || !encConfig.wrappedDek) return
  const passphrase = $('passphrase').value
  if (!passphrase) return
  try {
    const kek = await deriveKek(passphrase, encConfig.salt)
    const dekRaw = await unwrapDek(kek, encConfig.wrappedDek)
    await chrome.storage.session.set({ dekRaw: b64encode(dekRaw) })
    $('passphrase').value = ''
    status('Entsperrt — gefangene Rechnungen werden verschlüsselt übertragen.', true)
  } catch {
    status('Passphrase ist falsch.', false)
  }
}

$('save').addEventListener('click', () => testConnection(true))
$('unlock').addEventListener('click', unlock)
loadSettings()
