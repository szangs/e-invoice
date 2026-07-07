'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RestoreButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function restore() {
    setBusy(true)
    await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore: true }),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={restore} disabled={busy}>
      {busy ? '…' : 'Wiederherstellen'}
    </button>
  )
}
