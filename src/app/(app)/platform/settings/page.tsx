'use client'

// Betreiber-Systemeinstellungen (§24) — SMTP, Mail-Eingang, KI-Anbieter,
// Fernwartungs-Relay, Datensicherung (§17), Schalter
import { useEffect, useState } from 'react'
import { BackupOps } from './BackupOps'

type Settings = Record<string, string>

export default function SystemSettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [aiTest, setAiTest] = useState('')

  useEffect(() => {
    fetch('/api/platform/settings')
      .then((r) => r.json())
      .then((d) => setS(d.settings))
      .catch(() => setMsg('Einstellungen konnten nicht geladen werden.'))
  }, [])

  if (!s) return <p className="text-sm text-gray-400">Lade …</p>

  const set = (key: string, value: string) => setS((p) => ({ ...(p as Settings), [key]: value }))

  async function save() {
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/platform/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    })
    setBusy(false)
    setMsg(res.ok ? 'Gespeichert.' : 'Speichern fehlgeschlagen.')
  }

  async function testAi() {
    setAiTest('Teste …')
    await save()
    const res = await fetch('/api/platform/settings/test-ai', { method: 'POST' })
    const data = await res.json()
    setAiTest(data.message ?? 'Unbekanntes Ergebnis')
  }

  const input = (key: string, label: string, type = 'text', hint?: string) => (
    <div>
      <label className="dp-label">{label}</label>
      <input className="dp-input mt-1" type={type} value={s[key] ?? ''}
        onChange={(e) => set(key, e.target.value)} />
      {hint && <p className="mt-0.5 text-[10px] text-gray-400">{hint}</p>}
    </div>
  )
  const toggle = (key: string, label: string, warn?: string) => (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input type="checkbox" className="mt-0.5" checked={s[key] === '1'}
        onChange={(e) => set(key, e.target.checked ? '1' : '')} />
      <span>
        {label}
        {warn && <span className="block text-[11px] text-[var(--warn-strong)]">{warn}</span>}
      </span>
    </label>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <section className="dp-card space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Mail-Versand (SMTP)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('SMTP_HOST', 'Host')}
          {input('SMTP_PORT', 'Port', 'number')}
          {input('SMTP_USER', 'Benutzer')}
          {input('SMTP_PASS', 'Passwort (maskiert)', 'text', 'Nur ändern, wenn neu gesetzt werden soll')}
          {input('SMTP_FROM', 'Absender', 'text', 'z. B. E-Invoice <noreply@deltaplus.de>')}
        </div>
        {toggle('SMTP_SECURE', 'TLS/SSL (secure) verwenden')}
        {toggle('WELCOME_MAIL_ENABLED', 'Willkommens-Mail mit Zugangsdaten automatisch versenden')}
      </section>

      <section className="dp-card space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Mail-Eingang (Einlieferungs-Postfach)</h2>
        <p className="text-[11px] text-gray-400">
          Adressmuster: <span className="font-mono">beliebig@&lt;kurzname&gt;.&lt;basis-domain&gt;</span> —
          der Kurzname des Mandanten ist die Subdomain, die Basis-Domain gilt für alle Mandanten.
          Der Verlauf erscheint im Cockpit (alle Mandanten) und beim Mandanten (RE03).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('MAIL_IN_DOMAIN', 'Basis-Domain (für alle Mandanten)', 'text', 'z. B. einvoice.de → firmaxy.einvoice.de')}
          {input('MAIL_IN_HOST', 'IMAP-Host (Postfach-Variante)')}
          {input('MAIL_IN_PORT', 'IMAP-Port', 'number', 'Standard 993')}
          {input('MAIL_IN_USER', 'IMAP-Benutzer', 'text', 'Catch-All- oder bestimmtes Postfach')}
          {input('MAIL_IN_PASS', 'IMAP-Passwort (maskiert)')}
        </div>
        {toggle('MAIL_IN_SECURE', 'TLS/SSL (secure) verwenden')}
        {toggle('MAIL_IN_ENABLED', 'Mail-Eingang aktiv (IMAP-Abruf erlaubt)')}
        <div className="border-t border-[var(--line)] pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Alternative: eigener SMTP-Empfänger (Catch-All über die Subdomain)
          </p>
          <p className="mb-3 text-[11px] text-gray-400">
            Läuft als eigener Prozess (<span className="font-mono">npm run smtp</span>). Der Server
            wartet auf weitergeleitete Mails und nimmt jede Adresse nach dem Muster
            Präfix+Kurzname@Domain aktiver Mandanten an — MX-Eintrag der Subdomain nötig.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {input('MAIL_SMTP_PORT', 'SMTP-Port', 'number', 'Standard 2525; Produktion: Port 25 weiterleiten')}
            {input('MAIL_IN_ALLOWED_DOMAINS', 'Nur Absender dieser Domänen (global)', 'text', 'kommagetrennt, leer = alle — gilt für IMAP und SMTP')}
          </div>
          {toggle('MAIL_SMTP_ENABLED', 'SMTP-Empfänger aktiv')}
        </div>
      </section>

      <section className="dp-card space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">KI-Anbieter (frei wählbar)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('AI_PROVIDER', 'Anbieter', 'text', 'z. B. openai-kompatibel, anthropic, selbst gehostet')}
          {input('AI_MODEL', 'Modell')}
          {input('AI_BASE_URL', 'Endpunkt-/Basis-URL', 'text', 'z. B. https://api.example.com/v1')}
          {input('AI_API_KEY', 'Zugangsschlüssel (maskiert)')}
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-secondary" onClick={testAi} disabled={busy}>Verbindungs-Test</button>
          {aiTest && <span className="text-xs text-gray-600">{aiTest}</span>}
        </div>
        <p className="text-[11px] text-gray-400">
          Die Nutzung ist zusätzlich je Mandant abschaltbar (§19) und wird serverseitig erzwungen.
        </p>
      </section>

      <section className="dp-card space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Fernwartungs-Relay (§14B)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('REMOTE_RELAY_URL', 'Serveradresse')}
          {input('REMOTE_RELAY_KEY', 'Schlüssel (maskiert)')}
        </div>
        <p className="text-[11px] text-gray-400">Der In-App-Client-Download folgt in Runde 2 — die Werte werden hier bereits zentral gepflegt.</p>
      </section>

      <section className="dp-card space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Datensicherung Gesamtsystem (§17)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('BACKUP_TARGET_DIR', 'Sicherungsziel (Verzeichnis auf dem Server)', 'text', 'z. B. D:\\Backups\\einvoice oder \\\\NAS\\backup')}
          {input('BACKUP_SYSTEM_FREQ', 'Häufigkeit', 'text', 'DAILY, WEEKLY, MONTHLY oder YEARLY')}
          {input('BACKUP_SYSTEM_EMAIL', 'Zusätzlich per E-Mail an (optional)', 'email')}
        </div>
        {toggle('BACKUP_SYSTEM_ENABLED', 'Automatische System-Sicherung aktiv (Prozess: npm run backup)')}
        <p className="text-[11px] text-gray-400">
          Der Zeitplan-Prozess prüft stündlich die Fälligkeit (auch für alle Mandanten-Sicherungen)
          und stellt in das Verzeichnis und/oder per E-Mail zu. Einstellungen oben mit „Speichern" sichern.
        </p>
        <BackupOps />
      </section>

      <section className="dp-card space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Schalter</h2>
        {toggle('FEEDBACK_ENABLED', 'Nutzer-Feedback global aktiv (§26 — UI folgt in Runde 2)')}
        {toggle('DEV_MODE', 'Entwicklermodus', 'Nur für Testzwecke — vor Produktiveinsatz deaktivieren! (§24)')}
      </section>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Speichere …' : 'Speichern'}</button>
        {msg && <span className={`text-sm ${msg === 'Gespeichert.' ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>{msg}</span>}
      </div>
    </div>
  )
}
