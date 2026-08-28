'use client'

// Mandanten-Einstellungen (Stefan 2026-07-08): oben eine symbolische
// Kachelleiste je Themenbereich (wie bei der Körbe-Verwaltung) — anklicken
// öffnet darunter genau diesen Bereich, statt vorher alle Abschnitte
// ununterschieden untereinander zu stapeln.
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { AzureGraphCredentialsFields, AzureGraphCredentialsGuide } from '@/components/settings/AzureGraphCredentials'
import { ColorThemePicker } from './ColorThemePicker'
import { CostCodesPanel } from './CostCodesPanel'
import { DatevAccountsPanel } from './DatevAccountsPanel'
import { VendorAddressesPanel } from './VendorAddressesPanel'
import { EncryptionSetup } from './EncryptionSetup'
import { TokenManager } from './TokenManager'

type Switches = {
  legalName: string
  buyerNameMismatchBlocksHandover: boolean
  aiAllowed: boolean
  ipLoggingAllowed: boolean
  backupEnabled: boolean
  defaultLanguage: string
  colorTheme: string
  mailAllowedDomains: string
  mailInGraphEnabled: boolean
  mailInGraphMailbox: string
  mailInGraphFolder: string
  mailInGraphMoveToFolder: string
  spamReplyEnabled: boolean
  autoDeleteExactDuplicates: boolean
  autoSupersedeInvoiceVersions: boolean
  mailInGraphTenantId: string
  mailInGraphClientId: string
  mailInGraphClientSecret: string
  mailInPop3Enabled: boolean
  mailInPop3Host: string
  mailInPop3Port: number
  mailInPop3Secure: boolean
  mailInPop3User: string
  mailInPop3Pass: string
  mailInImapEnabled: boolean
  mailInImapHost: string
  mailInImapPort: number
  mailInImapSecure: boolean
  mailInImapUser: string
  mailInImapPass: string
  mailInImapFolder: string
  mailInImapMoveToFolder: string
  mailInPollSeconds: number
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
  sepaOwnName: string
  sepaOwnIban: string
  sepaOwnBic: string
  costCenterEnabled: boolean
  costCarrierEnabled: boolean
}

const FREQUENCIES = [
  { value: 'DAILY', label: 'täglich' },
  { value: 'WEEKLY', label: 'wöchentlich' },
  { value: 'MONTHLY', label: 'monatlich' },
  { value: 'YEARLY', label: 'jährlich' },
]

// 'mailin' (Stefan 2026-08-27, "die Email Abholung soll ein eigener
// Menüpunkt sein unter Einstellungen") — vorher als Unterabschnitt im Tab
// "Allgemein" versteckt, jetzt eigener Themenbereich (Weiterleitung/Graph/
// POP3/IMAP, Poll-Intervall, Dubletten & Versionen).
type TabKey = 'tenant' | 'general' | 'mailin' | 'backup' | 'report' | 'datev' | 'encryption' | 'tokens'

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'tenant', label: 'Mandant', hint: 'Name, Kurzname, Lizenz, Einlieferungs-Adresse' },
  { key: 'general', label: 'Allgemein', hint: 'KI-Nutzung, IP-Protokollierung, Sprache' },
  { key: 'mailin', label: 'Mail-Eingang', hint: 'Weiterleitung, Microsoft Graph, POP3, IMAP, Poll-Intervall, Dubletten & Versionen' },
  { key: 'backup', label: 'Datensicherung', hint: 'Zeitplan, Download-Link, Erinnerung, externes Ziel, Rücksicherung (§17)' },
  { key: 'report', label: 'Bericht', hint: 'Revisionssicherer Hash-Bericht (Rechnungsliste + Prüfsummen)' },
  { key: 'datev', label: 'DATEV-Export', hint: 'Konten, Wirtschaftsjahr, Fibu-E-Mail, Lieferanten-Konten, SEPA-Zahlungsverkehr' },
  { key: 'encryption', label: 'Verschlüsselung', hint: 'Zero-Knowledge Beleg-Verschlüsselung' },
  { key: 'tokens', label: 'API-Token', hint: 'Rechnungs-Catcher — Browser-Plugin' },
]

function TabIcon({ tab }: { tab: TabKey }) {
  const common = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (tab) {
    case 'tenant':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 21V7l8-4 8 4v14" />
          <path d="M9 21v-6h6v6" />
          <path d="M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
        </svg>
      )
    case 'general':
      // Vereinfacht (Stefan 2026-08-27, "Icons wirken unaufgeräumt") — das
      // vorherige, sehr detailreiche Zahnrad wirkte bei 19px deutlich
      // unruhiger/dichter als die übrigen, bewusst schlichten Icons daneben.
      // Schild passt inhaltlich auch besser: der Tab ist jetzt nur noch
      // KI-Nutzung + Datenschutz (Mail-Eingang hat einen eigenen Tab).
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
          <path d="M9.5 12l2 2 3.5-4" />
        </svg>
      )
    case 'mailin':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
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
  tenant,
  globalPollDefaults,
}: {
  initial: Switches
  encryptionEnabled: boolean
  lastBackupAt: string | null
  // Globale Betreiber-Standard-Poll-Intervalle (Stefan 2026-08-27, "bei
  // Mailabholung müssen wir die Pollrate einstellen können") — nur zur
  // Anzeige, was ohne eigenen Wert gilt (Systemeinstellungen, siehe
  // lib/mailinSchedule.ts).
  globalPollDefaults: { graph: number; pop3: number; imap: number }
  // Mandanten-Stammdaten (Stefan 2026-08-25) — eigener Tab statt einer
  // separaten, immer sichtbaren Karte über den Einstellungen (gehört genauso
  // zu den Mandanten-Einstellungen wie die übrigen Tabs).
  tenant: {
    name: string
    slug: string
    licensePlan: string | null
    licenseExpiresAt: string | null
    mailInAddress: string | null
    mailInDomain: string
    mailInSmtpEnabled: boolean
    mailInGraphActive: boolean
    mailInGraphMailbox: string | null
    mailInGraphFolder: string | null
    mailInPop3Active: boolean
    mailInPop3Host: string | null
    mailInImapActive: boolean
    mailInImapHost: string | null
    mailInImapFolder: string | null
  }
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('tenant')
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [backupMsg, setBackupMsg] = useState('')
  const [reportMsg, setReportMsg] = useState('')
  const [graphMailinMsg, setGraphMailinMsg] = useState('')
  const [pop3MailinMsg, setPop3MailinMsg] = useState('')
  const [imapMailinMsg, setImapMailinMsg] = useState('')
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

  async function testPop3Mailin() {
    setBusy(true)
    setPop3MailinMsg('Prüfe …')
    await save()
    const res = await fetch('/api/admin/tenant/mailin-pop3-test', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setPop3MailinMsg(res.ok ? data.message : (data.error ?? 'Test fehlgeschlagen.'))
  }

  async function testImapMailin() {
    setBusy(true)
    setImapMailinMsg('Prüfe …')
    await save()
    const res = await fetch('/api/admin/tenant/mailin-imap-test', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setImapMailinMsg(res.ok ? data.message : (data.error ?? 'Test fehlgeschlagen.'))
  }

  // E-Mail-Verfahren-Auswahl (Stefan 2026-08-27): eine Radio-Gruppe statt
  // dreier unabhängiger Schalter — schaltet beim Wechsel die jeweils anderen
  // beiden Wege aus (serverseitig zusätzlich erzwungen, siehe api/admin/tenant).
  type MailMethod = 'FORWARDING' | 'GRAPH' | 'POP3' | 'IMAP'
  const mailMethod: MailMethod = s.mailInGraphEnabled ? 'GRAPH' : s.mailInPop3Enabled ? 'POP3' : s.mailInImapEnabled ? 'IMAP' : 'FORWARDING'
  // Eigenes Poll-Intervall je Mandant (Stefan 2026-08-27) — Standard-Wert je
  // nach gewähltem Verfahren, nur zur Anzeige im Platzhalter.
  const pollDefaultForMethod =
    mailMethod === 'GRAPH' ? globalPollDefaults.graph : mailMethod === 'POP3' ? globalPollDefaults.pop3 : globalPollDefaults.imap
  function setMailMethod(method: MailMethod) {
    setS((p) => ({
      ...p,
      mailInGraphEnabled: method === 'GRAPH',
      mailInPop3Enabled: method === 'POP3',
      mailInImapEnabled: method === 'IMAP',
    }))
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

  const toggle = (key: 'aiAllowed' | 'ipLoggingAllowed' | 'mailInGraphEnabled' | 'buyerNameMismatchBlocksHandover', label: string, hint?: string) => (
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

      {tab === 'tenant' && (
        <section className="dp-card space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Ihr Mandant</h2>
          <div>
            <p className="text-sm text-gray-700">{tenant.name}</p>
            <p className="text-xs text-gray-400">
              Kurzname: <span className="font-mono">{tenant.slug}</span> · Lizenz:{' '}
              {tenant.licensePlan ?? '—'} ·{' '}
              {tenant.licenseExpiresAt
                ? `bis ${new Date(tenant.licenseExpiresAt).toLocaleDateString('de-DE')}`
                : 'unbegrenzt'}
            </p>
          </div>

          <div className="border-t border-[var(--line)] pt-4">
            <p className="dp-label mb-2">Erscheinungsbild</p>
            <ColorThemePicker value={s.colorTheme} onChange={(colorTheme) => setS((p) => ({ ...p, colorTheme }))} />
            <p className="mt-1.5 text-[10px] text-gray-400">
              Sofort als Vorschau sichtbar — dauerhaft gespeichert wird die Wahl erst mit „Speichern" unten.
            </p>
          </div>

          <div className="border-t border-[var(--line)] pt-4 space-y-3">
            <div>
              <label className="dp-label" title="Exakte Firmenbezeichnung wie auf Ihren Rechnungen adressiert — wird mit dem Rechnungsempfänger jeder eingehenden E-Rechnung verglichen (Warnung bei Abweichung, z. B. bei einer versehentlich falsch adressierten Rechnung). Leer = keine Prüfung.">
                Firmenbezeichnung (für den Rechnungsempfänger-Abgleich)
              </label>
              <input className="dp-input mt-1" value={s.legalName}
                placeholder="z. B. Delta Plus Systemhaus GmbH"
                onChange={(e) => setS((p) => ({ ...p, legalName: e.target.value }))} />
            </div>
            {toggle('buyerNameMismatchBlocksHandover', 'Bei abweichendem Rechnungsempfänger die Übergabe an die Fibu sperren',
              'Solange die Abweichung nicht per „Passt trotzdem" akzeptiert wurde, lässt sich die Rechnung nicht in den Übergabekorb verschieben (manuell wie automatisch). Ohne Firmenbezeichnung oben wirkungslos.')}
          </div>

          <div className="border-t border-[var(--line)] pt-4">
            <p className="dp-label mb-1">E-Mail-Eingang</p>
            {tenant.mailInAddress ? (
              <>
                <p className="font-mono text-sm text-[var(--accent)]">{tenant.mailInAddress}</p>
                <p className="mt-1 text-xs text-gray-400">
                  beliebiger Lokalteil möglich, z. B. auch{' '}
                  <span className="font-mono">irgendwas@{tenant.slug}.{tenant.mailInDomain}</span>
                </p>
                <p className="mt-2 text-xs text-gray-500">
                  Richten Sie in Ihrem E-Mail-Programm eine Weiterleitung eingehender Rechnungen an
                  diese Adresse ein — alles Weitere passiert automatisch. Rechnungen als PDF- oder
                  Bild-Anhang werden als Beleg angelegt. Der Verlauf eingehender E-Mails steht im{' '}
                  <a className="underline" href="/audit">Audit-Protokoll</a>.
                </p>
                <p className="mt-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
                  Bitte geben Sie diese Adresse nicht direkt an Lieferanten oder sonstige Dritte weiter
                  — richten Sie stattdessen eine einfache Weiterleitung in Ihrem E-Mail-Programm bzw.
                  bei Ihrem E-Mail-Provider dorthin ein. So behalten Sie die alleinige Kontrolle über
                  Ihr Rechnungspostfach.
                </p>
                {!tenant.mailInSmtpEnabled && !tenant.mailInGraphActive && !tenant.mailInPop3Active && !tenant.mailInImapActive && (
                  <p className="mt-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
                    Der automatische Abruf ist derzeit deaktiviert — eingehende Mails werden gesammelt
                    und nach Aktivierung verarbeitet.
                  </p>
                )}
                {tenant.mailInGraphActive && (
                  <p className="mt-2 rounded-lg bg-[var(--accent-bg)] px-3 py-2 text-xs text-[var(--accent)]">
                    Zusätzlich aktiv: automatischer Abruf per Microsoft Graph aus Postfach{' '}
                    <span className="font-mono">{tenant.mailInGraphMailbox}</span>
                    {tenant.mailInGraphFolder ? <>, Ordner <span className="font-mono">{tenant.mailInGraphFolder}</span></> : null}.
                  </p>
                )}
                {tenant.mailInPop3Active && (
                  <p className="mt-2 rounded-lg bg-[var(--accent-bg)] px-3 py-2 text-xs text-[var(--accent)]">
                    Zusätzlich aktiv: automatischer Abruf per POP3 von <span className="font-mono">{tenant.mailInPop3Host}</span>.
                  </p>
                )}
                {tenant.mailInImapActive && (
                  <p className="mt-2 rounded-lg bg-[var(--accent-bg)] px-3 py-2 text-xs text-[var(--accent)]">
                    Zusätzlich aktiv: automatischer Abruf per IMAP von <span className="font-mono">{tenant.mailInImapHost}</span>
                    {tenant.mailInImapFolder ? <>, Ordner <span className="font-mono">{tenant.mailInImapFolder}</span></> : null}.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400">
                noch nicht eingerichtet — der Betreiber muss unter Systemeinstellungen → Mail-Eingang eine Basis-Domain hinterlegen
              </p>
            )}
          </div>
          <SaveBar />
        </section>
      )}

      {tab === 'general' && (
        <section className="dp-card space-y-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Allgemein</h2>

          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">KI & Datenschutz</p>
            {toggle('aiAllowed', 'KI-Funktionen erlauben', 'Bei "aus" werden keine Daten an eine KI übergeben — serverseitig erzwungen.')}
            {toggle('ipLoggingAllowed', 'IP-Protokollierung erlauben', 'Speichert IP-Adressen der Benutzer im Audit-Protokoll (§18) — nur möglich, wenn der Betreiber es für Ihren Mandanten freigeschaltet hat.')}
          </div>

          <div className="space-y-3 border-t border-[var(--line)] pt-5">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Sonstiges</p>
            <div>
              <label className="dp-label">Standardsprache</label>
              <select className="dp-input mt-1 !w-auto" value={s.defaultLanguage}
                onChange={(e) => setS((p) => ({ ...p, defaultLanguage: e.target.value }))}>
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
              </select>
            </div>

            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 space-y-1">
              <p className="dp-label">Fälligkeits-Hervorhebung</p>
              <p className="text-[11px] text-gray-500">
                Überfällige und bald fällige Rechnungen (Zahlungsziel in den nächsten 7 Tagen bzw. bereits
                verstrichen) werden automatisch in der periodischen Korb-Sammelmail hervorgehoben — siehe
                Korb-Einstellungen → Benachrichtigung für Ein/Aus und Intervall. Keine gesonderte Einstellung
                nötig.
              </p>
            </div>
          </div>
          <SaveBar />
        </section>
      )}

      {tab === 'mailin' && (
        <section className="dp-card space-y-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Mail-Eingang</h2>
          <div>
            <label className="dp-label">Nur Absender dieser Domänen</label>
            <input className="dp-input mt-1" value={s.mailAllowedDomains}
              placeholder="z. B. meinefirma.de, lieferant.de — leer = alle"
              onChange={(e) => setS((p) => ({ ...p, mailAllowedDomains: e.target.value }))} />
          </div>

          {/* E-Mail-Verfahren-Auswahl (Stefan 2026-08-27, Review-Fund "unter Mail
              noch eine Unterkategorie zur Auswahl des Email-Verfahrens — SMTP
              Input und Office 365 API gibt es schon, jetzt fehlt noch POP und
              IMAP") — vorher ein einzelner Ein/Aus-Schalter nur für Graph,
              SMTP-Weiterleitung lief implizit parallel dazu; jetzt eine klare
              Auswahl zwischen genau einem der vier Wege. */}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 space-y-3">
            <p className="dp-label">E-Mail-Verfahren</p>
            <div className="flex flex-col gap-1.5 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input type="radio" name="mailMethod" className="accent-[var(--accent)]" checked={mailMethod === 'FORWARDING'}
                  onChange={() => setMailMethod('FORWARDING')} />
                Weiterleitung (Standard) — Einlieferungs-Adresse oben, keine weitere Einrichtung nötig
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mailMethod" className="accent-[var(--accent)]" checked={mailMethod === 'GRAPH'}
                  onChange={() => setMailMethod('GRAPH')} />
                Microsoft Graph API — eigene Azure-App-Registrierung, Postfach wird direkt bei Office 365 abgefragt
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mailMethod" className="accent-[var(--accent)]" checked={mailMethod === 'POP3'}
                  onChange={() => setMailMethod('POP3')} />
                POP3 — klassischer Postfach-Abruf, abgerufene Mails werden anschließend gelöscht
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mailMethod" className="accent-[var(--accent)]" checked={mailMethod === 'IMAP'}
                  onChange={() => setMailMethod('IMAP')} />
                IMAP — Postfach-Abruf, verarbeitete Mails bleiben erhalten (werden als gelesen markiert)
              </label>
            </div>
            <p className="text-[11px] text-gray-400">
              Der Betreiber muss den jeweiligen Abrufprozess global aktiviert haben (Systemeinstellungen) —
              Zugangsdaten unten sind immer Ihre eigenen.
            </p>
            {mailMethod !== 'FORWARDING' && (
              <div className="border-t border-[var(--line)] pt-3">
                <label className="dp-label" title="Wie oft Ihr Postfach abgefragt wird — leer/0 = Standard des Betreibers">
                  Poll-Intervall (Sekunden)
                </label>
                <input className="dp-input mt-1 !w-32" type="number" min={30} value={s.mailInPollSeconds || ''}
                  placeholder={String(pollDefaultForMethod)}
                  onChange={(e) => setS((p) => ({ ...p, mailInPollSeconds: e.target.value === '' ? 0 : Math.max(30, Number(e.target.value) || 0) }))} />
                <p className="mt-0.5 text-[10px] text-gray-400">
                  Leer = Standard des Betreibers (aktuell {pollDefaultForMethod} Sekunden). Mindestens 30 Sekunden.
                </p>
              </div>
            )}
            {mailMethod === 'GRAPH' && (
              <>
                <p className="text-[11px] text-gray-500">
                  Wichtig: Das ist <strong>Ihre eigene</strong> Azure-App-Registrierung in Ihrem
                  eigenen Microsoft-365-Tenant — der Betreiber kann mit seinen Zugangsdaten nicht
                  auf Ihr Postfach zugreifen, das braucht zwingend Ihre eigene App.
                </p>
                <AzureGraphCredentialsGuide
                  registrationNameHint="E-Invoice Mail-Eingang"
                  permission="Mail.Read"
                  extraSteps={[
                    <>
                      Optional, falls Sie unten auch „Verarbeitete Mails verschieben nach" nutzen: zusätzlich{' '}
                      <span className="font-mono">Mail.ReadWrite</span> statt nur <span className="font-mono">Mail.Read</span> hinzufügen
                      (Verschieben braucht Schreibzugriff) — sonst reicht <span className="font-mono">Mail.Read</span>.
                    </>,
                    <>Postfach + Ordner unten eintragen (das Postfach muss in Ihrem eigenen Tenant existieren), speichern, „Ordner testen".</>,
                  ]}
                />
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
                </div>
                <AzureGraphCredentialsFields
                  values={{ tenantId: s.mailInGraphTenantId, clientId: s.mailInGraphClientId, clientSecret: s.mailInGraphClientSecret }}
                  onChange={(patch) => setS((p) => ({
                    ...p,
                    ...(patch.tenantId !== undefined ? { mailInGraphTenantId: patch.tenantId } : {}),
                    ...(patch.clientId !== undefined ? { mailInGraphClientId: patch.clientId } : {}),
                    ...(patch.clientSecret !== undefined ? { mailInGraphClientSecret: patch.clientSecret } : {}),
                  }))}
                />
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
            {mailMethod === 'POP3' && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="dp-label">Server</label>
                    <input className="dp-input mt-1" value={s.mailInPop3Host}
                      placeholder="z. B. pop.mandant-provider.de"
                      onChange={(e) => setS((p) => ({ ...p, mailInPop3Host: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Port</label>
                    <input className="dp-input mt-1" type="number" value={s.mailInPop3Port}
                      onChange={(e) => setS((p) => ({ ...p, mailInPop3Port: Number(e.target.value) || 995 }))} />
                  </div>
                  <div>
                    <label className="dp-label">Benutzer</label>
                    <input className="dp-input mt-1" value={s.mailInPop3User}
                      onChange={(e) => setS((p) => ({ ...p, mailInPop3User: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Passwort</label>
                    <input className="dp-input mt-1" type="password" value={s.mailInPop3Pass}
                      placeholder="Nur ändern, wenn neu gesetzt werden soll"
                      onChange={(e) => setS((p) => ({ ...p, mailInPop3Pass: e.target.value }))} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="accent-[var(--accent)]" checked={s.mailInPop3Secure}
                        onChange={(e) => setS((p) => ({ ...p, mailInPop3Secure: e.target.checked }))} />
                      Verschlüsselte Verbindung (TLS, Port 995) — nur implizites TLS unterstützt, kein STARTTLS auf Port 110
                    </label>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">
                  Abgerufene Nachrichten werden nach erfolgreicher Verarbeitung vom Server gelöscht (POP3-üblich) —
                  richten Sie dafür am besten ein eigenes, ausschließlich für den Rechnungseingang genutztes Postfach ein.
                </p>
                <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-[11px] text-[var(--warn-strong)]">
                  ⚠ Bei einem Microsoft-365/Outlook-Postfach schlägt die Anmeldung meist mit
                  „Basic authentication is disabled" fehl — Microsoft hat Benutzername+Passwort-Anmeldung
                  für POP3/IMAP seit 2022 standardmäßig abgeschaltet. Nutzen Sie für solche Postfächer
                  stattdessen „Microsoft Graph API" oben.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-secondary" onClick={testPop3Mailin}
                    disabled={busy || !s.mailInPop3Host}
                    title="Speichert die obigen Angaben und prüft die Anmeldung am POP3-Server">
                    Verbindung testen
                  </button>
                  {pop3MailinMsg && <span className="text-xs text-gray-600">{pop3MailinMsg}</span>}
                </div>
              </>
            )}
            {mailMethod === 'IMAP' && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="dp-label">Server</label>
                    <input className="dp-input mt-1" value={s.mailInImapHost}
                      placeholder="z. B. imap.mandant-provider.de"
                      onChange={(e) => setS((p) => ({ ...p, mailInImapHost: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Port</label>
                    <input className="dp-input mt-1" type="number" value={s.mailInImapPort}
                      onChange={(e) => setS((p) => ({ ...p, mailInImapPort: Number(e.target.value) || 993 }))} />
                  </div>
                  <div>
                    <label className="dp-label">Benutzer</label>
                    <input className="dp-input mt-1" value={s.mailInImapUser}
                      onChange={(e) => setS((p) => ({ ...p, mailInImapUser: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Passwort</label>
                    <input className="dp-input mt-1" type="password" value={s.mailInImapPass}
                      placeholder="Nur ändern, wenn neu gesetzt werden soll"
                      onChange={(e) => setS((p) => ({ ...p, mailInImapPass: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Ordner</label>
                    <input className="dp-input mt-1" value={s.mailInImapFolder}
                      placeholder="leer = INBOX" onChange={(e) => setS((p) => ({ ...p, mailInImapFolder: e.target.value }))} />
                  </div>
                  <div>
                    <label className="dp-label">Verarbeitete Mails verschieben nach (optional)</label>
                    <input className="dp-input mt-1" value={s.mailInImapMoveToFolder}
                      placeholder="leer = nicht verschieben, nur als gelesen markieren"
                      onChange={(e) => setS((p) => ({ ...p, mailInImapMoveToFolder: e.target.value }))} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="accent-[var(--accent)]" checked={s.mailInImapSecure}
                        onChange={(e) => setS((p) => ({ ...p, mailInImapSecure: e.target.checked }))} />
                      Verschlüsselte Verbindung (TLS, Port 993) — nur implizites TLS unterstützt, kein STARTTLS auf Port 143
                    </label>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">
                  Verarbeitete Nachrichten werden als gelesen markiert (nicht gelöscht) — optional zusätzlich in
                  einen Zielordner verschoben.
                </p>
                <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-[11px] text-[var(--warn-strong)]">
                  ⚠ Bei einem Microsoft-365/Outlook-Postfach schlägt die Anmeldung meist mit
                  „Basic authentication is disabled" fehl — Microsoft hat Benutzername+Passwort-Anmeldung
                  für POP3/IMAP seit 2022 standardmäßig abgeschaltet. Nutzen Sie für solche Postfächer
                  stattdessen „Microsoft Graph API" oben.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-secondary" onClick={testImapMailin}
                    disabled={busy || !s.mailInImapHost}
                    title="Speichert die obigen Angaben und prüft, ob Postfach/Ordner mit Ihren Zugangsdaten erreichbar sind">
                    Verbindung testen
                  </button>
                  {imapMailinMsg && <span className="text-xs text-gray-600">{imapMailinMsg}</span>}
                </div>
              </>
            )}
          </div>

          {/* Dubletten & Spam-Antwort (Stefan 2026-08-25): vorher nur sichtbar,
              wenn oben "Mail-Eingang per Microsoft Graph" aktiv war — obwohl
              das genauso für den normalen SMTP-Mail-Eingang gilt. Jetzt immer
              sichtbar, unabhängig vom gewählten Mail-Eingang-Weg. */}
          <div className="space-y-3 border-t border-[var(--line)] pt-5">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Dubletten & Versionen</p>
            <div>
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
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="accent-[var(--accent)]" checked={s.autoDeleteExactDuplicates}
                  onChange={(e) => setS((p) => ({ ...p, autoDeleteExactDuplicates: e.target.checked }))} />
                Erkannte Dubletten automatisch löschen
              </label>
              <p className="mt-1 text-[10px] text-gray-400">
                Nur bei 100 % sicherem Treffer — eine bereits eingegangene, byte-identische Beleg-Datei
                wird automatisch in den Papierkorb verschoben (nichts geht endgültig verloren). Der
                schwächere Abgleich über Rechnungsnummer + Lieferant (z. B. bei einem Korrektur-/
                Ersatzbeleg mit derselben Nummer) bleibt immer nur eine Markierung mit
                Nachprüfung durch einen Menschen — der wird nie automatisch gelöscht.
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="accent-[var(--accent)]" checked={s.autoSupersedeInvoiceVersions}
                  onChange={(e) => setS((p) => ({ ...p, autoSupersedeInvoiceVersions: e.target.checked }))} />
                Bei mehrfach gesendeter Rechnung nur die neueste Version aktiv halten
              </label>
              <p className="mt-1 text-[10px] text-gray-400">
                Eigenständig von der Dubletten-Erkennung oben: greift, wenn dieselbe Rechnungsnummer +
                derselbe Lieferant erneut eingeht, aber mit ANDEREM Dateiinhalt (z. B. eine korrigierte
                oder erneut gesendete Fassung) — die neueste Version bleibt normal bearbeitbar, ältere
                Versionen werden automatisch schreibgeschützt und in der Liste ausgegraut, aber nichts
                wird gelöscht. Ohne diese Einstellung landet ein solcher Treffer stattdessen als
                normale Dubletten-Markierung zur manuellen Entscheidung.
              </p>
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
              <p className="dp-label mb-1">Zahlungsverkehr (SEPA-Sammelüberweisung)</p>
              <p className="mb-2 text-[10px] text-gray-400">
                Ihr eigenes Auftraggeberkonto — daraus werden die Zahlungen im{' '}
                <a href="/invoices" className="underline">SEPA-Export</a> im Übergabekorb ausgeführt.
                Lieferanten-Kontoverbindungen werden getrennt im Lieferanten-Register unten gepflegt.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="dp-label">Kontoinhaber</label>
                  <input className="dp-input mt-1" value={s.sepaOwnName} placeholder="z. B. Delta Plus Systemhaus GmbH"
                    onChange={(e) => setS((p) => ({ ...p, sepaOwnName: e.target.value }))} />
                </div>
                <div>
                  <label className="dp-label">IBAN</label>
                  <input className="dp-input mt-1 font-mono" value={s.sepaOwnIban} placeholder="DE…"
                    onChange={(e) => setS((p) => ({ ...p, sepaOwnIban: e.target.value }))} />
                </div>
                <div>
                  <label className="dp-label">BIC</label>
                  <input className="dp-input mt-1 font-mono" value={s.sepaOwnBic}
                    onChange={(e) => setS((p) => ({ ...p, sepaOwnBic: e.target.value }))} />
                </div>
              </div>
              {encryptionEnabled && (
                <p className="mt-1.5 rounded-lg bg-[var(--warn-bg)] px-2.5 py-1.5 text-[11px] text-[var(--warn-strong)]">
                  🔒 SEPA-Export ist für verschlüsselte Mandanten noch nicht verfügbar.
                </p>
              )}
            </div>
            <div className="border-t border-[var(--line)] pt-3 space-y-2">
              {/* Stefan 2026-08-26: vorher ein gemeinsamer Schalter für beide —
                  in der Praxis nutzt nicht jeder Mandant Kostenstellen UND
                  Kostenträger zusammen, deshalb jetzt unabhängig abschaltbar. */}
              <label className="flex items-start gap-2 text-sm text-gray-700"
                title="Blendet je Rechnung eine Kostenstellen-Auswahl ein, befüllt aus der Liste unten">
                <input type="checkbox" className="mt-0.5" checked={s.costCenterEnabled}
                  onChange={(e) => setS((p) => ({ ...p, costCenterEnabled: e.target.checked }))} />
                <span>
                  Kostenstellen verwenden
                  <span className="block text-[11px] text-gray-400">
                    Bei „aus" bleibt die Auswahl auf der Rechnung ausgeblendet — bereits zugeordnete
                    Werte gehen dabei nicht verloren.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-700"
                title="Blendet je Rechnung eine Kostenträger-Auswahl ein, befüllt aus der Liste unten">
                <input type="checkbox" className="mt-0.5" checked={s.costCarrierEnabled}
                  onChange={(e) => setS((p) => ({ ...p, costCarrierEnabled: e.target.checked }))} />
                <span>
                  Kostenträger verwenden
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
          <VendorAddressesPanel />
          {s.costCenterEnabled && <CostCodesPanel kind="KOSTENSTELLE" label="Kostenstellen" />}
          {s.costCarrierEnabled && <CostCodesPanel kind="KOSTENTRAEGER" label="Kostenträger" />}
        </>
      )}

      {tab === 'encryption' && <EncryptionSetup />}
      {tab === 'tokens' && <TokenManager />}
    </>
  )
}
