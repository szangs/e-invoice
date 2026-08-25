'use client'

// Mandanten-Einstellungen (Stefan 2026-07-08): oben eine symbolische
// Kachelleiste je Themenbereich (wie bei der Körbe-Verwaltung) — anklicken
// öffnet darunter genau diesen Bereich, statt vorher alle Abschnitte
// ununterschieden untereinander zu stapeln.
import { useRouter } from 'next/navigation'
import { useRef, useState, type ReactNode } from 'react'
import { CostCodesPanel } from './CostCodesPanel'
import { DatevAccountsPanel } from './DatevAccountsPanel'
import { EncryptionSetup } from './EncryptionSetup'
import { TokenManager } from './TokenManager'

type Switches = {
  aiAllowed: boolean
  ipLoggingAllowed: boolean
  backupEnabled: boolean
  defaultLanguage: string
  mailAllowedDomains: string
  mailInGraphEnabled: boolean
  mailInGraphMailbox: string
  mailInGraphFolder: string
  mailInGraphMoveToFolder: string
  spamReplyEnabled: boolean
  mailInGraphTenantId: string
  mailInGraphClientId: string
  mailInGraphClientSecret: string
  backupFrequency: string
  backupEmail: string
  backupReminderDays: number
  backupWebdavUrl: string
  backupWebdavUser: string
  backupWebdavPass: string
  reportEnabled: boolean
  reportFrequency: string
  reportEmail: string
  datevBeraternr: string
  datevMandantnr: string
  datevSkr: string
  datevSachkontenlaenge: number
  datevKreditorenkonto: string
  datevGegenkonto: string
  datevWjBeginn: string
  datevFibuEmail: string
  costCentersEnabled: boolean
  dueReminderDaysAfterReceipt: number | null
  dueReminderDaysBeforeDue: number | null
}

const FREQUENCIES = [
  { value: 'DAILY', label: 'täglich' },
  { value: 'WEEKLY', label: 'wöchentlich' },
  { value: 'MONTHLY', label: 'monatlich' },
  { value: 'YEARLY', label: 'jährlich' },
]

type TabKey = 'general' | 'backup' | 'report' | 'datev' | 'encryption' | 'tokens'

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'general', label: 'Allgemein', hint: 'KI-Nutzung, IP-Protokollierung, Sprache, E-Mail-Eingang' },
  { key: 'backup', label: 'Datensicherung', hint: 'Zeitplan, Download-Link, Erinnerung, externes Ziel, Rücksicherung (§17)' },
  { key: 'report', label: 'Bericht', hint: 'Revisionssicherer Hash-Bericht (Rechnungsliste + Prüfsummen)' },
  { key: 'datev', label: 'DATEV-Export', hint: 'Konten, Wirtschaftsjahr, Fibu-E-Mail, Lieferanten-Konten' },
  { key: 'encryption', label: 'Verschlüsselung', hint: 'Zero-Knowledge Beleg-Verschlüsselung' },
  { key: 'tokens', label: 'API-Token', hint: 'Rechnungs-Catcher — Browser-Plugin' },
]

function TabIcon({ tab }: { tab: TabKey }) {
  const common = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (tab) {
    case 'general':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 17.34a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 13a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 6.96a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.04-1.56V1a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.04 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.96z" />
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
    case 'report':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M6 3h9l3 3v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      )
    case 'datev':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 8c0-2 3-3 7-3s7 1 7 3-3 3-7 3-7-1-7-3z" />
          <path d="M5 8v8c0 2 3 3 7 3s7-1 7-3V8" />
          <path d="M5 12c0 2 3 3 7 3s7-1 7-3" />
        </svg>
      )
    case 'encryption':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="1.5" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      )
    case 'tokens':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="8" cy="12" r="4" />
          <path d="M12 12h9M17 12v4M20 12v3" />
        </svg>
      )
  }
}

export function SettingsHub({
  initial,
  encryptionEnabled,
  lastBackupAt,
}: {
  initial: Switches
  encryptionEnabled: boolean
  lastBackupAt: string | null
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('general')
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [backupMsg, setBackupMsg] = useState('')
  const [reportMsg, setReportMsg] = useState('')
  const [graphMailinMsg, setGraphMailinMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function save() {
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/admin/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    })
    setBusy(false)
    setMsg(res.ok ? 'Gespeichert.' : 'Speichern fehlgeschlagen.')
    router.refresh()
  }

  async function sendBackupNow() {
    setBusy(true)
    setBackupMsg('')
    const res = await fetch('/api/admin/backup', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setBackupMsg(res.ok ? data.message : data.error ?? 'Versand fehlgeschlagen.')
  }

  async function sendReportNow() {
    setBusy(true)
    setReportMsg('')
    const res = await fetch('/api/admin/report', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setReportMsg(res.ok ? data.message : data.error ?? 'Versand fehlgeschlagen.')
  }

  async function restore() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setBackupMsg('Bitte zuerst eine Sicherungsdatei auswählen.')
      return
    }
    if (!window.confirm('Rücksicherung einspielen? Vorhandene Daten werden mit dem Sicherungsstand überschrieben/ergänzt.')) return
    setBusy(true)
    setBackupMsg('Spiele Sicherung ein …')
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/admin/backup/restore', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setBackupMsg(res.ok ? `Wiederhergestellt: ${data.message}` : data.error ?? 'Rücksicherung fehlgeschlagen.')
    router.refresh()
  }

  async function testGraphMailin() {
    setBusy(true)
    setGraphMailinMsg('Prüfe …')
    await save()
    const res = await fetch('/api/admin/tenant/mailin-graph-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox: s.mailInGraphMailbox, folder: s.mailInGraphFolder, moveToFolder: s.mailInGraphMoveToFolder }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setGraphMailinMsg(res.ok ? data.message : (data.error ?? 'Test fehlgeschlagen.'))
  }

  async function sendTestInvoicesGraph() {
    if (!window.confirm('10 Test-Rechnungen (PDF/XRechnung/ZUGFeRD gemischt) an Ihr Mail-Eingang-Postfach senden?')) return
    setBusy(true)
    setGraphMailinMsg('Sende Testrechnungen …')
    await save()
    const res = await fetch('/api/admin/tenant/test-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 10 }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setGraphMailinMsg(res.ok ? data.message : (data.error ?? 'Senden fehlgeschlagen.'))
  }

  const helpBox = (summary: string, steps: ReactNode[]) => (
    <details className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 open:pb-3">
      <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--accent)]">
        {summary}
      </summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-gray-600">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </details>
  )

  const toggle = (key: 'aiAllowed' | 'ipLoggingAllowed' | 'mailInGraphEnabled', label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input type="checkbox" className="mt-0.5" checked={s[key]}
        onChange={(e) => setS((p) => ({ ...p, [key]: e.target.checked }))} />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-gray-400">{hint}</span>}
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
    <>
      <div className="dp-card">
        <p className="dp-label mb-3" title="Themenbereich anklicken, um seine Einstellungen darunter zu bearbeiten">
          Einstellungen
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
                  {t.key === 'backup' && s.backupEnabled && (
                    <span className="block text-[11px] text-gray-500">aktiv</span>
                  )}
                  {t.key === 'encryption' && encryptionEnabled && (
                    <span className="block text-[11px] text-gray-500">aktiv</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'general' && (
        <section className="dp-card space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Allgemein</h2>
          {toggle('aiAllowed', 'KI-Funktionen erlauben', 'Bei "aus" werden keine Daten an eine KI übergeben — serverseitig erzwungen.')}
          {toggle('ipLoggingAllowed', 'IP-Protokollierung erlauben', 'Speichert IP-Adressen der Benutzer im Audit-Protokoll (§18) — nur möglich, wenn der Betreiber es für Ihren Mandanten freigeschaltet hat.')}
          <div>
            <label className="dp-label">E-Mail-Eingang: nur Absender dieser Domänen</label>
            <input className="dp-input mt-1" value={s.mailAllowedDomains}
              placeholder="z. B. meinefirma.de, lieferant.de — leer = alle"
              onChange={(e) => setS((p) => ({ ...p, mailAllowedDomains: e.target.value }))} />
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 space-y-2">
            {toggle('mailInGraphEnabled', 'E-Mail-Eingang per Microsoft Graph (Alternative)',
              'Statt einer Weiterleitung auf unsere Einlieferungs-Adresse: ein Postfach + Ordner wird direkt bei Office 365 abgefragt. Der Betreiber muss den Abrufprozess global aktiviert haben (Systemeinstellungen) — Zugangsdaten unten sind Ihre eigenen.')}
            {s.mailInGraphEnabled && (
              <>
                <p className="text-[11px] text-gray-500">
                  Wichtig: Das ist <strong>Ihre eigene</strong> Azure-App-Registrierung in Ihrem
                  eigenen Microsoft-365-Tenant — der Betreiber kann mit seinen Zugangsdaten nicht
                  auf Ihr Postfach zugreifen, das braucht zwingend Ihre eigene App.
                </p>
                {helpBox('Anleitung: eigene Azure-AD-App-Registrierung einrichten (braucht Ihren Microsoft-365-Admin, einmalig)', [
                  <>
                    Ihr Admin meldet sich auf <span className="font-mono">portal.azure.com</span> an (im
                    Microsoft-365-Tenant Ihrer Firma!) → <strong>Azure Active Directory</strong> →{' '}
                    <strong>App-Registrierungen</strong> → <strong>„Neue Registrierung"</strong>. Name frei
                    wählbar (z. B. „E-Invoice Mail-Eingang").
                  </>,
                  <>Auf der Übersichtsseite <strong>Tenant-ID</strong> und <strong>Client-ID</strong> notieren — beide unten eintragen.</>,
                  <>
                    <strong>„Zertifikate &amp; Geheimnisse"</strong> → <strong>„Neuer geheimer Clientschlüssel"</strong> →
                    den angezeigten <strong>Wert</strong> sofort kopieren (nicht die Geheimnis-ID) — das ist das Client-Secret unten.
                  </>,
                  <>
                    <strong>„API-Berechtigungen"</strong> → <strong>„Berechtigung hinzufügen"</strong> → Microsoft Graph →{' '}
                    <strong>„Anwendungsberechtigungen"</strong> (nicht „Delegiert") → <span className="font-mono">Mail.Read</span> hinzufügen.
                  </>,
                  <><strong>„Administratorzustimmung erteilen"</strong> klicken und bestätigen.</>,
                  <>
                    Optional, falls Sie unten auch „Verarbeitete Mails verschieben nach" nutzen: zusätzlich{' '}
                    <span className="font-mono">Mail.ReadWrite</span> statt nur <span className="font-mono">Mail.Read</span> hinzufügen
                    (Verschieben braucht Schreibzugriff) — sonst reicht <span className="font-mono">Mail.Read</span>.
                  </>,
                  <>Postfach + Ordner unten eintragen (das Postfach muss in Ihrem eigenen Tenant existieren), speichern, „Ordner testen".</>,
                ])}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="dp-label">Postfach</label>
                    <input className="dp-input mt-1" type="email" value={s.mailInGraphMailbox}
                      placeholder="z. B. rechnungen@mandant.de"
                      onChange={(e) => setS((p) => ({ ...p, mailInGraphMailbox: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Ordner</label>
                    <input className="dp-input mt-1" value={s.mailInGraphFolder}
                      placeholder="leer = Posteingang, sonst Ordnername (Hauptverzeichnis oder Posteingang/Unterordner)"
                      onChange={(e) => setS((p) => ({ ...p, mailInGraphFolder: e.target.value }))} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="dp-label">Verarbeitete Mails verschieben nach (optional)</label>
                    <input className="dp-input mt-1" value={s.mailInGraphMoveToFolder}
                      placeholder="leer = im Postfach nicht verändern, sonst z. B. Verarbeitet"
                      onChange={(e) => setS((p) => ({ ...p, mailInGraphMoveToFolder: e.target.value }))} />
                    <p className="mt-0.5 text-[10px] text-gray-400">
                      Jede abgerufene Mail wird nach der Verarbeitung automatisch in diesen Ordner
                      verschoben (angelegte Rechnung bleibt davon unberührt) — braucht „Mail.ReadWrite"
                      statt nur „Mail.Read" in der App-Registrierung, siehe Anleitung oben.
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="accent-[var(--accent)]" checked={s.spamReplyEnabled}
                        onChange={(e) => setS((p) => ({ ...p, spamReplyEnabled: e.target.checked }))} />
                      Automatische Antwort an den Absender bei Spam-Verdacht
                    </label>
                    <p className="mt-1 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-[10px] text-[var(--warn-strong)]">
                      Schickt eine kurze automatische Info, wenn eine Mail eindeutig NICHT als Rechnung
                      erkannt wird ("Spam-Verdacht"-Korb) — mit dem Hinweis, sich bei echtem
                      Rechnungsbezug direkt zu melden. <strong>Zu bedenken:</strong> echter Spam hat
                      fast immer eine gefälschte Absenderadresse — die Antwort geht dann an eine
                      unbeteiligte dritte Person (kein technischer Schutz davor möglich), und eine
                      Auto-Antwort bestätigt Spam-Versendern eine aktive Mailbox. Nur einschalten, wenn
                      Ihnen dieses Risiko bewusst ist. Je Beleg wird höchstens einmal geantwortet. Im
                      Entwicklermodus (Systemeinstellungen) wird nie versendet — dort laufen Test-/Demo-Mails,
                      oft mit echten Absenderadressen.
                    </p>
                  </div>
                  <div>
                    <label className="dp-label">Tenant-ID (Ihr Azure AD)</label>
                    <input className="dp-input mt-1" value={s.mailInGraphTenantId}
                      onChange={(e) => setS((p) => ({ ...p, mailInGraphTenantId: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Client-ID (Ihre App-Registrierung)</label>
                    <input className="dp-input mt-1" value={s.mailInGraphClientId}
                      onChange={(e) => setS((p) => ({ ...p, mailInGraphClientId: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Client-Secret</label>
                    <input className="dp-input mt-1" value={s.mailInGraphClientSecret}
                      placeholder="Nur ändern, wenn neu gesetzt werden soll"
                      onChange={(e) => setS((p) => ({ ...p, mailInGraphClientSecret: e.target.value }))} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-secondary" onClick={testGraphMailin}
                    disabled={busy || !s.mailInGraphMailbox}
                    title="Speichert die obigen Angaben und prüft, ob Postfach/Ordner mit Ihren Zugangsdaten bei Office 365 gefunden werden">
                    Ordner testen
                  </button>
                  <button type="button" className="btn-secondary" onClick={sendTestInvoicesGraph}
                    disabled={busy || !s.mailInGraphMailbox}
                    title="Verschickt 10 echte Beispielrechnungen (PDF/XRechnung/ZUGFeRD) an Ihr Postfach — zum vollständigen Testen von Mail-Eingang, KI-Erkennung und E-Rechnungs-Visualisierung">
                    Testrechnungen senden
                  </button>
                  {graphMailinMsg && <span className="text-xs text-gray-600">{graphMailinMsg}</span>}
                </div>
              </>
            )}
          </div>

          <div>
            <label className="dp-label">Standardsprache</label>
            <select className="dp-input mt-1 !w-auto" value={s.defaultLanguage}
              onChange={(e) => setS((p) => ({ ...p, defaultLanguage: e.target.value }))}>
              <option value="de">Deutsch</option>
              <option value="en">Englisch</option>
            </select>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 space-y-3">
            <p className="dp-label">Fälligkeits-Benachrichtigung ("Bearbeitungswarnung")</p>
            <p className="text-[11px] text-gray-500">
              Verschickt automatisch eine Mail an die für den jeweiligen Korb hinterlegten Mitarbeiter
              (Korb-Einstellungen → Benachrichtigung), sobald eine Rechnung fällig wird oder — falls die
              Fälligkeit unbekannt ist — seit dem Eingang zu lange unbearbeitet liegt. Jeweils leer lassen,
              um die Benachrichtigung auszuschalten.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="dp-label" title="Betrifft Rechnungen ohne bekannte Fälligkeit (weder E-Rechnung noch KI-Erkennung hatte ein Datum)">
                  Ohne bekannte Fälligkeit: Tage nach Eingang
                </label>
                <input className="dp-input mt-1" type="number" min={1} max={365}
                  value={s.dueReminderDaysAfterReceipt ?? ''}
                  placeholder="z. B. 14"
                  onChange={(e) => setS((p) => ({ ...p, dueReminderDaysAfterReceipt: e.target.value === '' ? null : Number(e.target.value) }))} />
              </div>
              <div>
                <label className="dp-label" title="Betrifft Rechnungen mit bekannter Fälligkeit — E-Rechnung oder von der KI erkanntes Datum werden hier gleich behandelt">
                  Mit bekannter Fälligkeit: Tage davor
                </label>
                <input className="dp-input mt-1" type="number" min={1} max={365}
                  value={s.dueReminderDaysBeforeDue ?? ''}
                  placeholder="z. B. 5"
                  onChange={(e) => setS((p) => ({ ...p, dueReminderDaysBeforeDue: e.target.value === '' ? null : Number(e.target.value) }))} />
              </div>
            </div>
          </div>
          <SaveBar />
        </section>
      )}

      {tab === 'backup' && (
        <section className="dp-card space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Datensicherung (§17)</h2>
          <label className="flex items-start gap-2 text-sm text-gray-700"
            title="Erstellt automatisch nach dem unten gewählten Zeitplan eine Sicherung dieses Mandanten">
            <input type="checkbox" className="mt-0.5" checked={s.backupEnabled}
              onChange={(e) => setS((p) => ({ ...p, backupEnabled: e.target.checked }))} />
            <span>Regelmäßige Sicherung aktiv</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="dp-label">Häufigkeit</label>
              <select className="dp-input mt-1" value={s.backupFrequency}
                onChange={(e) => setS((p) => ({ ...p, backupFrequency: e.target.value }))}>
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="dp-label">Ziel-E-Mail (erhält den Download-Link)</label>
              <input type="email" className="dp-input mt-1" value={s.backupEmail}
                placeholder="z. B. backup@meinefirma.de"
                onChange={(e) => setS((p) => ({ ...p, backupEmail: e.target.value }))} />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            Die Sicherung wird als ZIP-Paket (mit SHA-256-Prüfsumme und allen Belegdateien) auf dem
            Server abgelegt — die E-Mail enthält nur noch einen Download-Link, nicht mehr das Paket
            selbst als Anhang. Verschlüsselte Belege bleiben im Paket verschlüsselt.
          </p>

          <div className="border-t border-[var(--line)] pt-3">
            <label className="dp-label" title="Solange das Paket nicht heruntergeladen wurde, wird alle paar Tage per E-Mail erinnert — bis zu dieser Anzahl Tage nach Erstellung">
              Erinnerung, solange nicht heruntergeladen (Tage)
            </label>
            <input type="number" min={0} max={90} className="dp-input mt-1 !w-32" value={s.backupReminderDays}
              onChange={(e) => setS((p) => ({ ...p, backupReminderDays: Math.max(0, Number(e.target.value) || 0) }))} />
            <p className="mt-0.5 text-[10px] text-gray-400">0 = keine Erinnerung. Download-Links sind unabhängig davon 90 Tage gültig.</p>
          </div>

          <div className="border-t border-[var(--line)] pt-3">
            <label className="dp-label" title="Zusätzlich zum Download-Link: das Paket automatisch auf ein eigenes WebDAV-Ziel hochladen">
              Optionales externes Ziel (WebDAV)
            </label>
            <div className="mt-1 grid gap-3 sm:grid-cols-3">
              <input className="dp-input sm:col-span-3" value={s.backupWebdavUrl}
                placeholder="https://ihre-cloud.example.com/remote.php/dav/files/benutzer/Sicherungen"
                onChange={(e) => setS((p) => ({ ...p, backupWebdavUrl: e.target.value }))} />
              <input className="dp-input" value={s.backupWebdavUser} placeholder="Benutzername"
                onChange={(e) => setS((p) => ({ ...p, backupWebdavUser: e.target.value }))} />
              <input type="password" className="dp-input sm:col-span-2" value={s.backupWebdavPass}
                placeholder="Passwort / App-Passwort"
                onChange={(e) => setS((p) => ({ ...p, backupWebdavPass: e.target.value }))} />
            </div>
            <p className="mt-1 rounded-lg bg-[var(--accent-bg)] px-2.5 py-1.5 text-[11px] text-gray-600">
              Funktioniert direkt mit Nextcloud/ownCloud und den meisten anderen Cloud-Speichern mit
              WebDAV-Zugang. <strong>OneDrive (privat) bietet seit einigen Jahren kein WebDAV mehr an</strong> —
              für OneDrive/SharePoint entweder eine WebDAV-fähige Business-Variante verwenden, oder den
              lokalen OneDrive-Sync-Client auf einen Ordner zeigen lassen, den Ihr Betreiber als
              System-Sicherungsziel einträgt (Plattform-Einstellung, nicht hier). Sagen Sie Bescheid,
              falls eine direkte OneDrive-Anbindung (Microsoft-Konto-Anmeldung) gewünscht ist — das ist
              eine größere Erweiterung, die eigene Azure-App-Zugangsdaten von Ihnen braucht.
            </p>
          </div>

          <p className="text-xs text-gray-600">
            Letzte Sicherung:{' '}
            <span className={lastBackupAt ? '' : 'text-[var(--warn-strong)]'}>
              {lastBackupAt ? new Date(lastBackupAt).toLocaleString('de-DE') : 'noch nie'}
            </span>
          </p>
          {s.backupEnabled && (
            <p className="rounded-lg bg-[var(--warn-bg)] px-2.5 py-1.5 text-[11px] text-[var(--warn-strong)]">
              Hinweis: die regelmäßige Sicherung läuft in einem eigenen Hintergrund-Prozess
              (<span className="font-mono">npm run backup</span>), der dauerhaft laufen muss (z. B. als
              pm2-/Windows-Dienst) — läuft er nicht, wird nie automatisch gesichert, auch wenn hier
              alles aktiviert ist. Mit „Jetzt senden" unten lässt sich der Ablauf unabhängig davon testen.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn-secondary" href="/api/admin/backup">ZIP jetzt herunterladen</a>
            <button className="btn-secondary" onClick={sendBackupNow} disabled={busy}>
              Jetzt senden (Paket + Download-Link per E-Mail)
            </button>
          </div>
          <div className="border-t border-[var(--line)] pt-3">
            <label className="dp-label">Rücksicherung (Sicherungsdatei einspielen)</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".zip,application/zip,application/json,.json" className="dp-input !w-auto" />
              <button className="btn-danger" onClick={restore} disabled={busy}
                title="Ausgewählte Sicherungsdatei einspielen — überschreibt/ergänzt vorhandene Daten dieses Mandanten unwiderruflich">Wiederherstellen</button>
            </div>
            <p className="mt-0.5 text-[10px] text-gray-400">Akzeptiert die neuen .zip-Pakete sowie ältere, bereits heruntergeladene .json-Sicherungen.</p>
          </div>
          {backupMsg && <p className="text-sm text-gray-700">{backupMsg}</p>}
          <SaveBar />
        </section>
      )}

      {tab === 'report' && (
        <section className="dp-card space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Revisionssicherer Bericht</h2>
          <p className="text-[11px] text-gray-400">
            Schlankes Protokoll (CSV) mit Ihrer Rechnungsliste und den Beleg-Prüfsummen — zur
            eigenen Ablage/Dokumentation, unabhängig von E-Invoice. Anders als die Sicherung
            kein voller Datenexport, sondern nur die Liste + Hashes, verkettet mit dem letzten Bericht.
          </p>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5" checked={s.reportEnabled}
              onChange={(e) => setS((p) => ({ ...p, reportEnabled: e.target.checked }))} />
            <span>Regelmäßiger Bericht aktiv — wird automatisch per E-Mail zugestellt</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="dp-label">Häufigkeit</label>
              <select className="dp-input mt-1" value={s.reportFrequency}
                onChange={(e) => setS((p) => ({ ...p, reportFrequency: e.target.value }))}>
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="dp-label">Ziel-E-Mail</label>
              <input type="email" className="dp-input mt-1" value={s.reportEmail}
                placeholder="z. B. ablage@meinefirma.de"
                onChange={(e) => setS((p) => ({ ...p, reportEmail: e.target.value }))} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn-secondary" href="/api/admin/report">Bericht herunterladen</a>
            <button className="btn-secondary" onClick={sendReportNow} disabled={busy}>
              Jetzt per E-Mail senden
            </button>
          </div>
          {reportMsg && <p className="text-sm text-gray-700">{reportMsg}</p>}
          <SaveBar />
        </section>
      )}

      {tab === 'datev' && (
        <>
          <section className="dp-card space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">DATEV-Export (Übergabekorb → Fibu)</h2>
            <p className="text-[11px] text-gray-400">
              Wird beim „An Fibu übergeben"-Button im Übergabekorb verwendet. Erster Entwurf mit einem
              Sammelkonto für alle Lieferanten — die genaue Kontierung je Lieferant erfolgt weiterhin
              in DATEV durch die Fibu. Bitte diese Angaben mit Ihrem Steuerberater abstimmen.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="dp-label" title="DATEV-Beraternummer, von Ihrem Steuerberater vergeben">Beraternummer</label>
                <input className="dp-input mt-1" value={s.datevBeraternr}
                  onChange={(e) => setS((p) => ({ ...p, datevBeraternr: e.target.value }))} />
              </div>
              <div>
                <label className="dp-label" title="DATEV-Mandantennummer bei Ihrem Steuerberater">Mandantennummer</label>
                <input className="dp-input mt-1" value={s.datevMandantnr}
                  onChange={(e) => setS((p) => ({ ...p, datevMandantnr: e.target.value }))} />
              </div>
              <div>
                <label className="dp-label" title="Nur zur Dokumentation — beeinflusst den Export selbst nicht">Kontenrahmen</label>
                <select className="dp-input mt-1" value={s.datevSkr}
                  onChange={(e) => setS((p) => ({ ...p, datevSkr: e.target.value }))}>
                  <option value="SKR03">SKR03</option>
                  <option value="SKR04">SKR04</option>
                </select>
              </div>
              <div>
                <label className="dp-label" title="Länge der Sachkontonummern in Ihrem Kontenrahmen, meist 4">Sachkontenlänge</label>
                <input type="number" min={4} max={8} className="dp-input mt-1" value={s.datevSachkontenlaenge}
                  onChange={(e) => setS((p) => ({ ...p, datevSachkontenlaenge: Number(e.target.value) || 4 }))} />
              </div>
              <div>
                <label className="dp-label" title="Sammelkonto, auf das alle Kreditoren-Beträge gebucht werden (z. B. 70000 bei SKR04, 1600 bei SKR03)">
                  Sammel-Kreditorenkonto
                </label>
                <input className="dp-input mt-1" value={s.datevKreditorenkonto}
                  placeholder="z. B. 70000"
                  onChange={(e) => setS((p) => ({ ...p, datevKreditorenkonto: e.target.value }))} />
              </div>
              <div>
                <label className="dp-label" title="Sammel-Gegenkonto (z. B. ein Zwischen-/Kostenkonto) — die Fibu sortiert in DATEV weiter zu">
                  Sammel-Gegenkonto
                </label>
                <input className="dp-input mt-1" value={s.datevGegenkonto}
                  onChange={(e) => setS((p) => ({ ...p, datevGegenkonto: e.target.value }))} />
              </div>
              <div>
                <label className="dp-label" title="Beginn Ihres Wirtschaftsjahres als Tag+Monat, z. B. 0101 für 1. Januar">
                  Wirtschaftsjahr-Beginn (TTMM)
                </label>
                <input className="dp-input mt-1" value={s.datevWjBeginn} placeholder="0101"
                  onChange={(e) => setS((p) => ({ ...p, datevWjBeginn: e.target.value }))} />
              </div>
            </div>
            <div className="border-t border-[var(--line)] pt-3">
              <label className="dp-label" title="Optional zusätzlich zum CSV-Sammel-Export: eine einzelne E-Mail je Beleg mit dem Original-Dokument im Anhang">
                Fibu-E-Mail für Einzel-Belege (optional)
              </label>
              <input type="email" className="dp-input mt-1" value={s.datevFibuEmail}
                placeholder="z. B. fibu@meinefirma.de"
                onChange={(e) => setS((p) => ({ ...p, datevFibuEmail: e.target.value }))} />
              <p className="mt-0.5 text-[10px] text-gray-400">
                Wenn gesetzt, kann beim „An Fibu übergeben"-Export zusätzlich eine einzelne E-Mail je
                Beleg mit dem Original-Dokument im Anhang an diese Adresse verschickt werden — der
                DATEV-CSV-Export enthält nur Buchungsdaten, keine Dokumente.
              </p>
              {encryptionEnabled && (
                <p className="mt-1.5 rounded-lg bg-[var(--warn-bg)] px-2.5 py-1.5 text-[11px] text-[var(--warn-strong)]">
                  🔒 Beleg-Verschlüsselung ist für diesen Mandanten aktiv (Zero-Knowledge) — der Server
                  kann verschlüsselte Belege nicht entschlüsseln, um sie an eine E-Mail anzuhängen.
                  Einzel-Mails enthalten für solche Belege nur die Daten, ohne Dokumenten-Anhang.
                </p>
              )}
            </div>
            <div className="border-t border-[var(--line)] pt-3">
              <label className="flex items-start gap-2 text-sm text-gray-700"
                title="Blendet je Rechnung eine Kostenstellen-/Kostenträger-Auswahl ein, befüllt aus den beiden Listen unten">
                <input type="checkbox" className="mt-0.5" checked={s.costCentersEnabled}
                  onChange={(e) => setS((p) => ({ ...p, costCentersEnabled: e.target.checked }))} />
                <span>
                  Kostenstellen/Kostenträger verwenden
                  <span className="block text-[11px] text-gray-400">
                    Bei „aus" bleibt die Auswahl auf der Rechnung ausgeblendet — bereits zugeordnete
                    Werte gehen dabei nicht verloren.
                  </span>
                </span>
              </label>
            </div>
            <SaveBar />
          </section>
          <DatevAccountsPanel />
          {s.costCentersEnabled && (
            <>
              <CostCodesPanel kind="KOSTENSTELLE" label="Kostenstellen" />
              <CostCodesPanel kind="KOSTENTRAEGER" label="Kostenträger" />
            </>
          )}
        </>
      )}

      {tab === 'encryption' && <EncryptionSetup />}
      {tab === 'tokens' && <TokenManager />}
    </>
  )
}
