'use client'

// Aktionen je Mandant (§6): bearbeiten, sperren/entsperren, Killswitch,
// Identitätsübernahme, Zugangsdaten neu senden.
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

  async function call(url: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(url, {
        method: body === undefined ? 'POST' : 'PATCH',
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
      <Link href={`/platform/tenants/${tenantId}`} className="btn-secondary !px-2 !py-1 text-xs">
        Bearbeiten
      </Link>
      <button
        disabled={busy}
        className="btn-secondary !px-2 !py-1 text-xs"
        onClick={() => call(`/api/platform/tenants/${tenantId}`, { active: !active })}
      >
        {active ? 'Sperren' : 'Entsperren'}
      </button>
      <button
        disabled={busy}
        className="btn-danger !px-2 !py-1 text-xs"
        onClick={() =>
          call(
            `/api/platform/tenants/${tenantId}/killswitch`,
            undefined,
            `Killswitch für "${tenantName}"?\nAlle Nutzer werden sofort abgemeldet, der Mandant wird gesperrt.`,
          )
        }
      >
        Killswitch
      </button>
      <button disabled={busy || !active} className="btn-secondary !px-2 !py-1 text-xs" onClick={impersonate}>
        Übernehmen
      </button>
      <button
        disabled={busy}
        className="btn-secondary !px-2 !py-1 text-xs"
        onClick={() =>
          call(
            `/api/platform/tenants/${tenantId}/credentials`,
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
