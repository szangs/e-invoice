'use client'

// Betreiber-Systemeinstellungen (§24) — SMTP, Mail-Eingang, KI-Anbieter,
// Fernwartungs-Relay, Datensicherung (§17), Schalter
import { useEffect, useState } from 'react'
import { BackupOps } from './BackupOps'

type Settings = Record<string, string>

const FREQUENCIES = [
  { value: 'DAILY', label: 'täglich' },
  { value: 'WEEKLY', label: 'wöchentlich' },
  { value: 'MONTHLY', label: 'monatlich' },
  { value: 'YEARLY', label: 'jährlich' },
]

export default function SystemSettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [aiTest, setAiTest] = useState('')
  const [aiModels, setAiModels] = useState<string[]>([])
  const [smtpTest, setSmtpTest] = useState('')
  const [smtpTo, setSmtpTo] = useState('')

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
    setAiModels([])
    await save()
    const res = await fetch('/api/platform/settings/test-ai', { method: 'POST' })
    const data = await res.json()
    setAiTest(data.message ?? 'Unbekanntes Ergebnis')
    setAiModels(data.models ?? [])
  }

  async function testSmtp() {
    setSmtpTest('Sende …')
    await save()
    const res = await fetch('/api/platform/settings/test-smtp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: smtpTo }),
    })
    const data = await res.json()
    setSmtpTest(data.message ?? 'Unbekanntes Ergebnis')
  }

  const input = (key: string, label: string, type = 'text', hint?: string) => (
    <div>
      <label className="dp-label">{label}</label>
      <input className="dp-input mt-1" type={type} value={s[key] ?? ''}
        onChange={(e) => set(key, e.target.value)} />
      {hint && <p className="mt-0.5 text-[10px] text-gray-400">{hint}</p>}
    </div>
  )
  const select = (key: string, label: string, options: { value: string; label: string }[], hint?: string) => (
    <div>
      <label className="dp-label">{label}</label>
      <select className="dp-input mt-1" value={s[key] ?? options[0]?.value ?? ''}
        onChange={(e) => set(key, e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
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
        <div className="border-t border-[var(--line)] pt-3">
          <label className="dp-label">Test-Mail senden an</label>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <input className="dp-input max-w-xs" type="email" value={smtpTo} placeholder="ihre@adresse.de"
              onChange={(e) => setSmtpTo(e.target.value)} />
            <button className="btn-secondary" onClick={testSmtp} disabled={busy || !smtpTo}
              title="Speichert die obigen SMTP-Einstellungen und verschickt eine Testmail">
              Test-Mail senden
            </button>
            {smtpTest && <span className="text-xs text-gray-600">{smtpTest}</span>}
          </div>
        </div>
      </section>

      <section className="dp-card space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Mail-Eingang (eigener SMTP-Empfänger)</h2>
        <p className="text-[11px] text-gray-400">
          Adressmuster: <span className="font-mono">beliebig@&lt;kurzname&gt;.&lt;basis-domain&gt;</span> —
          der Kurzname des Mandanten ist die Subdomain, die Basis-Domain gilt für alle Mandanten.
          Der Verlauf erscheint im Cockpit (alle Mandanten) und beim Mandanten (RE03).
        </p>
        <p className="text-[11px] text-gray-400">
          Läuft als eigener Prozess (<span className="font-mono">npm run smtp</span>). Der Server
          wartet auf weitergeleitete Mails und nimmt jede Adresse nach dem Muster
          Präfix+Kurzname@Domain aktiver Mandanten an — MX-Eintrag der Subdomain nötig.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('MAIL_IN_DOMAIN', 'Basis-Domain (für alle Mandanten)', 'text', 'z. B. einvoice.de → firmaxy.einvoice.de')}
          {input('MAIL_SMTP_PORT', 'SMTP-Port', 'number', 'Standard 2525; Produktion: Port 25 weiterleiten')}
          {input('MAIL_IN_ALLOWED_DOMAINS', 'Nur Absender dieser Domänen (global)', 'text', 'kommagetrennt, leer = alle')}
        </div>
        <div>
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
          <button className="btn-secondary" onClick={testAi} disabled={busy} title="Speichert die obigen Einstellungen und prüft die Verbindung zum KI-Anbieter">
            Verbindungs-Test
          </button>
          {aiTest && <span className="text-xs text-gray-600">{aiTest}</span>}
        </div>
        {aiModels.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] text-gray-400">
              Beim Anbieter verfügbare Modelle (anklicken zum Übernehmen — für die KI-Bilderkennung
              gescannter Rechnungen muss es ein Vision-/Multimodal-Modell sein):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {aiModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    m === s.AI_MODEL
                      ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'border-[var(--line)] text-gray-600 hover:bg-[var(--surface-muted)]'
                  }`}
                  onClick={() => set('AI_MODEL', m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
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
          {select('BACKUP_SYSTEM_FREQ', 'Häufigkeit', FREQUENCIES)}
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
