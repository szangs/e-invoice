'use client'

// Aktionen je Mandant (§6): bearbeiten, sperren/entsperren, Killswitch,
// Identitätsübernahme, Zugangsdaten, Fernwartung anfragen.
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function TenantActions({
  tenantId,
  tenantName,
  active,
  devMode,
}: {
  tenantId: string
  tenantName: string
  active: boolean
  /** Nur im Entwicklungsmodus: "Testrechnungen senden" ist eine reine Test-/Demo-Funktion. */
  devMode: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function call(url: string, method: 'POST' | 'PATCH', body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data.error ?? 'Fehler')
        return
      }
      if (data.credentials) {
        window.alert(
          `Neue Zugangsdaten für ${tenantName}:\n\nE-Mail: ${data.credentials.email}\nPasswort: ${data.credentials.password}\n\n${data.mailInfo ?? ''}`,
        )
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function impersonate() {
    setBusy(true)
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/impersonate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setMsg(data.error ?? 'Fehler')
        return
      }
      await signIn('credentials', { ticket: data.ticket, redirect: false })
      window.location.href = '/dashboard'
    } finally {
      setBusy(false)
    }
  }

  async function sendTestInvoices() {
    if (!window.confirm(`10 Test-Rechnungen (PDF/XRechnung/ZUGFeRD gemischt) an das Mail-Eingang-Postfach von "${tenantName}" senden?`)) return
    setBusy(true)
    setMsg('Sende Testrechnungen …')
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/test-invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 10 }),
      })
      const data = await res.json().catch(() => ({}))
      setMsg(data.message ?? data.error ?? 'Unbekanntes Ergebnis')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
      <ActionIcon as={Link} href={`/platform/tenants/${tenantId}`} icon="✏️"
        title="Bearbeiten — Mandanten-Stammdaten und Limits bearbeiten" />
      <ActionIcon
        disabled={busy}
        icon={active ? '🔒' : '🔓'}
        title={active ? 'Sperren — Nutzer können sich nicht mehr anmelden' : 'Entsperren — Mandant wieder freischalten'}
        onClick={() => call(`/api/platform/tenants/${tenantId}`, 'PATCH', { active: !active })}
      />
      <ActionIcon
        disabled={busy}
        icon="🚪"
        title="Abmelden — alle Nutzer dieses Mandanten sofort abmelden und den Mandanten sperren (Fernwartungs-Sitzungen bleiben unberührt, §11)"
        onClick={() =>
          call(
            `/api/platform/tenants/${tenantId}/killswitch`,
            'POST',
            undefined,
            `Alle Nutzer von "${tenantName}" abmelden und den Mandanten sperren?\n(Fernwartungs-Sitzungen sind davon getrennt, §11.)`,
          )
        }
      />
      <ActionIcon disabled={busy || !active} icon="🎭" onClick={impersonate}
        title="Impersonation — als Administrator dieses Mandanten anmelden (Einmal-Ticket, §12)" />
      <ActionIcon
        disabled={busy || !active}
        icon="🛠️"
        title="Fernwartung — Sitzung anfragen, Nutzer muss aktiv zustimmen (§14A)"
        onClick={() =>
          call(
            '/api/platform/support',
            'POST',
            { tenantId },
            `Fernwartung bei "${tenantName}" anfragen?\nDer Nutzer muss aktiv einwilligen (§14A).`,
          )
        }
      />
      <ActionIcon as="a" href={`/api/platform/backup?tenantId=${tenantId}`} icon="💾"
        title="Backup — Sicherung dieses Mandanten sofort herunterladen" />
      {devMode && (
        <ActionIcon
          disabled={busy || !active}
          icon="🧪"
          title="Testrechnungen senden — 10 Beispielrechnungen (PDF/XRechnung/ZUGFeRD) an das Mail-Eingang-Postfach dieses Mandanten senden, zum Testen ohne Kommandozeile. Braucht ein hinterlegtes Postfach (Mandanten-Einstellungen → Allgemein)."
          onClick={sendTestInvoices}
        />
      )}
      <ActionIcon
        disabled={busy}
        icon="🔑"
        title="Zugangsdaten — neues Passwort für den Mandanten-Administrator erzeugen und per Mail zusenden"
        onClick={() =>
          call(
            `/api/platform/tenants/${tenantId}/credentials`,
            'POST',
            undefined,
            `Passwort des Administrators von "${tenantName}" zurücksetzen und zusenden?`,
          )
        }
      />
      {msg && (
        <span className={`text-xs ${msg.startsWith('Sende') || /^\d+ Testrechnung/.test(msg) ? 'text-gray-500' : 'text-[var(--danger)]'}`}>
          {msg}
        </span>
      )}
    </div>
  )
}

// Icon-Button statt Textbutton (Stefan 2026-08-27, "Aktionen sehen bescheiden
// aus, besser Symbole mit Beschreibung") — vorher 7 fast identische
// Text-Buttons in einer engen Tabellenzelle, kaum auf einen Blick
// unterscheidbar. Beschreibung bleibt als Tooltip (title) erhalten, jetzt
// zusätzlich mit vorangestelltem Aktionsnamen statt nur des reinen Zwecks.
function ActionIcon({
  icon, title, onClick, disabled, as: Tag = 'button', href,
}: {
  icon: string
  title: string
  onClick?: () => void
  disabled?: boolean
  as?: 'button' | 'a' | typeof Link
  href?: string
}) {
  const className = `flex h-7 w-7 items-center justify-center rounded-full border text-sm transition ${
    disabled
      ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-50'
      : 'border-[var(--line)] bg-white hover:border-[var(--accent-soft)] hover:bg-[var(--accent-bg)]'
  }`
  if (Tag === Link) {
    return (
      <Link href={href!} className={className} title={title}>
        {icon}
      </Link>
    )
  }
  if (Tag === 'a') {
    return (
      <a href={href} className={className} title={title}>
        {icon}
      </a>
    )
  }
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={className} title={title}>
      {icon}
    </button>
  )
}
