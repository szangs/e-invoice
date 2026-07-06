'use client'

// Betreiber-Aktionen je Fernwartungs-Sitzung (§14A)
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SupportOps({
  sessionId,
  status,
  initiatedBy,
}: {
  sessionId: string
  status: string
  initiatedBy: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function act(action: 'accept' | 'end') {
    setBusy(true)
    await fetch(`/api/support/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <span className="flex gap-1.5">
      {status === 'REQUESTED' && initiatedBy === 'TENANT' && (
        <button className="btn-primary !px-2 !py-1 text-xs" disabled={busy} onClick={() => act('accept')}>
          Annehmen
        </button>
      )}
      {status === 'ACTIVE' && (
        <Link className="btn-primary !px-2 !py-1 text-xs" href={`/platform/support/${sessionId}`}>
          Ansehen
        </Link>
      )}
      <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => act('end')}>
        Beenden
      </button>
    </span>
  )
}
