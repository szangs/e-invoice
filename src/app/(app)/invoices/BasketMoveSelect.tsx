'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type BasketOption = { id: string; name: string }

export function BasketMoveSelect({
  invoiceId,
  currentBasketId,
  baskets,
  pending,
  disabled,
}: {
  invoiceId: string
  currentBasketId: string | null
  baskets: BasketOption[]
  pending: { targetName: string; approvedBy: string[]; needed: number } | null
  /** Kein Verschieben-Recht auf dem aktuellen Korb (Stefan 2026-07-08) — Auswahl ausgeblendet. */
  disabled?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function move(targetBasketId: string) {
    if (!targetBasketId || targetBasketId === currentBasketId) return
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoiceId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetBasketId }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      window.alert(data.error ?? 'Fehler beim Verschieben')
      return
    }
    if (data.moved === false) {
      window.alert(`Freigabe erfasst — noch ${data.approvalsNeeded} weitere Freigabe(n) nötig (Vier-Augen-Korb).`)
    }
    router.refresh()
  }

  if (disabled) {
    return <span className="text-[10px] text-gray-400" title="Kein Recht zum Verschieben aus diesem Korb">kein Zugriff</span>
  }

  return (
    <div className="space-y-0.5">
      <select
        className="dp-input !w-auto !py-1 text-xs"
        value=""
        disabled={busy}
        onChange={(e) => move(e.target.value)}
      >
        <option value="">→ verschieben…</option>
        {baskets.filter((b) => b.id !== currentBasketId).map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      {pending && (
        <p className="text-[10px] text-[var(--warn-strong)]">
          Freigabe für „{pending.targetName}“ ausstehend ({pending.approvedBy.length}/2)
        </p>
      )}
    </div>
  )
}
