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
}: {
  tenantId: string
  tenantName: string
  active: boolean
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

  return (
    <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
      <Link href={`/platform/tenants/${tenantId}`} className="btn-secondary !px-2 !py-1 text-xs"
        title="Mandanten-Stammdaten und Limits bearbeiten">
        Bearbeiten
      </Link>
      <button
        disabled={busy}
        className="btn-secondary !px-2 !py-1 text-xs"
        title={active ? 'Mandant sperren — Nutzer können sich nicht mehr anmelden' : 'Mandant wieder freischalten'}
        onClick={() => call(`/api/platform/tenants/${tenantId}`, 'PATCH', { active: !active })}
      >
        {active ? 'Sperren' : 'Entsperren'}
      </button>
      <button
        disabled={busy}
        className="btn-secondary !px-2 !py-1 text-xs"
        title="Alle Nutzer dieses Mandanten sofort abmelden und den Mandanten sperren (Fernwartungs-Sitzungen bleiben unberührt, §11)"
        onClick={() =>
          call(
            `/api/platform/tenants/${tenantId}/killswitch`,
            'POST',
            undefined,
            `Alle Nutzer von "${tenantName}" abmelden und den Mandanten sperren?\n(Fernwartungs-Sitzungen sind davon getrennt, §11.)`,
          )
        }
      >
        Abmelden
      </button>
      <button disabled={busy || !active} className="btn-secondary !px-2 !py-1 text-xs" onClick={impersonate}
        title="Impersonation: als Administrator dieses Mandanten anmelden (Einmal-Ticket, §12)">
        Impersonation
      </button>
      <button
        disabled={busy || !active}
        className="btn-secondary !px-2 !py-1 text-xs"
        title="Fernwartungssitzung anfragen — Nutzer muss aktiv zustimmen (§14A)"
        onClick={() =>
          call(
            '/api/platform/support',
            'POST',
            { tenantId },
            `Fernwartung bei "${tenantName}" anfragen?\nDer Nutzer muss aktiv einwilligen (§14A).`,
          )
        }
      >
        Fernwartung
      </button>
      <a className="btn-secondary !px-2 !py-1 text-xs" href={`/api/platform/backup?tenantId=${tenantId}`}
        title="Sicherung dieses Mandanten sofort herunterladen">
        Backup
      </a>
      <button
        disabled={busy}
        className="btn-secondary !px-2 !py-1 text-xs"
        title="Neues Passwort für den Mandanten-Administrator erzeugen und per Mail zusenden"
        onClick={() =>
          call(
            `/api/platform/tenants/${tenantId}/credentials`,
            'POST',
            undefined,
            `Passwort des Administrators von "${tenantName}" zurücksetzen und zusenden?`,
          )
        }
      >
        Zugangsdaten
      </button>
      {msg && <span className="text-xs text-[var(--danger)]">{msg}</span>}
    </div>
  )
}
