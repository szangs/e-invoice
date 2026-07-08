'use client'

// Betreiber-Systemeinstellungen (§24) — SMTP, Mail-Eingang, KI-Anbieter,
// Fernwartungs-Relay, Datensicherung (§17), Schalter.
// Kachelleiste + Tabs (Stefan 2026-07-09) — vorher sechs Karten dauerhaft
// untereinander gestapelt, jetzt wie bei den Mandanten-Einstellungen
// (SettingsHub.tsx) ein Themenbereich anklicken, statt alles auf einmal zu
// zeigen. Gleiches Muster/gleiche Icons wie dort für Wiedererkennbarkeit.
import { useEffect, useState } from 'react'
import { BackupOps } from './BackupOps'

type Settings = Record<string, string>

const FREQUENCIES = [
  { value: 'DAILY', label: 'täglich' },
  { value: 'WEEKLY', label: 'wöchentlich' },
  { value: 'MONTHLY', label: 'monatlich' },
  { value: 'YEARLY', label: 'jährlich' },
]

type TabKey = 'smtp' | 'mailin' | 'ai' | 'remote' | 'backup' | 'switches'

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'smtp', label: 'Mail-Versand', hint: 'SMTP-Zugangsdaten, Willkommens-Mail, Test-Mail' },
  { key: 'mailin', label: 'Mail-Eingang', hint: 'Eigener SMTP-Empfänger für die Einlieferungs-Adressen der Mandanten' },
  { key: 'ai', label: 'KI-Anbieter', hint: 'Frei wählbarer, OpenAI-kompatibler Anbieter für die Belegerkennung' },
  { key: 'remote', label: 'Fernwartung', hint: 'Relay-Zugangsdaten (§14B)' },
  { key: 'backup', label: 'Sicherung', hint: 'Gesamtsystem-Sicherung (§17), Zeitplan, Sofort-Aktionen' },
  { key: 'switches', label: 'Schalter', hint: 'Feedback, Entwicklermodus' },
]

function TabIcon({ tab }: { tab: TabKey }) {
  const common = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (tab) {
    case 'smtp':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
      )
    case 'mailin':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
          <path d="M12 13v6M9 16l3 3 3-3" />
        </svg>
      )
    case 'ai':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="4" y="7" width="16" height="12" rx="2" />
          <path d="M8 7V5a4 4 0 0 1 8 0v2" />
          <circle cx="9" cy="13" r="1" />
          <circle cx="15" cy="13" r="1" />
        </svg>
      )
    case 'remote':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="1.5" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      )
    case 'backup':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3v12" />
          <path d="M8 11l4 4 4-4" />
          <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
      )
    case 'switches':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 17.34a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 13a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 6.96a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.04-1.56V1a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.04 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.96z" />
        </svg>
      )
  }
}

export default function SystemSettingsPage() {
  const [tab, setTab] = useState<TabKey>('smtp')
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

  const SaveBar = () => (
    <div className="flex items-center gap-3">
      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Speichere …' : 'Speichern'}</button>
      {msg && <span className={`text-sm ${msg === 'Gespeichert.' ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>{msg}</span>}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="dp-card">
        <p className="dp-label mb-3" title="Themenbereich anklicken, um seine Einstellungen darunter zu bearbeiten">
          Systemeinstellungen
        </p>
        <div className="flex flex-wrap gap-3">
          {TABS.map((t) => {
            const isActive = t.key === tab
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                title={t.hint}
                className={`flex min-w-[170px] items-center gap-2.5 rounded-2xl border-2 bg-white px-4 py-3 text-left shadow-sm transition ${
                  isActive
                    ? 'border-[var(--accent)] bg-[var(--accent-bg)] shadow-md'
                    : 'border-[var(--line)] hover:border-[var(--accent-soft)] hover:shadow-md'
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  isActive ? 'bg-[var(--accent)] text-white' : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                }`}>
                  <TabIcon tab={t.key} />
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-semibold ${isActive ? 'text-[var(--accent)]' : 'text-gray-800'}`}>
                    {t.label}
                  </span>
                  {t.key === 'smtp' && s.SMTP_HOST && <span className="block text-[11px] text-gray-500">eingerichtet</span>}
                  {t.key === 'mailin' && s.MAIL_SMTP_ENABLED === '1' && <span className="block text-[11px] text-gray-500">aktiv</span>}
                  {t.key === 'ai' && s.AI_PROVIDER && <span className="block text-[11px] text-gray-500">{s.AI_PROVIDER}</span>}
                  {t.key === 'backup' && s.BACKUP_SYSTEM_ENABLED === '1' && <span className="block text-[11px] text-gray-500">aktiv</span>}
                  {t.key === 'switches' && s.DEV_MODE === '1' && <span className="block text-[11px] text-[var(--warn-strong)]">Entwicklermodus</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'smtp' && (
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
          <SaveBar />
        </section>
      )}

      {tab === 'mailin' && (
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
          <SaveBar />
        </section>
      )}

      {tab === 'ai' && (
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
          <SaveBar />
        </section>
      )}

      {tab === 'remote' && (
        <section className="dp-card space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Fernwartungs-Relay (§14B)</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {input('REMOTE_RELAY_URL', 'Serveradresse')}
            {input('REMOTE_RELAY_KEY', 'Schlüssel (maskiert)')}
          </div>
          <p className="text-[11px] text-gray-400">Der In-App-Client-Download folgt in Runde 2 — die Werte werden hier bereits zentral gepflegt.</p>
          <SaveBar />
        </section>
      )}

      {tab === 'backup' && (
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
          <SaveBar />
          <BackupOps />
        </section>
      )}

      {tab === 'switches' && (
        <section className="dp-card space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Schalter</h2>
          {toggle('FEEDBACK_ENABLED', 'Nutzer-Feedback global aktiv (§26 — UI folgt in Runde 2)')}
          {toggle('DEV_MODE', 'Entwicklermodus', 'Nur für Testzwecke — vor Produktiveinsatz deaktivieren! (§24)')}
          <SaveBar />
        </section>
      )}
    </div>
  )
}
