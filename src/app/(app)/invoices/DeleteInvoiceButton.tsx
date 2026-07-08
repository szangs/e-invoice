'use client'

// Löschen aus dem Ablagekorb (Stefan 2026-07-08) — weiches Löschen wie bisher
// schon aus der Rechnungs-Detailseite, jetzt zusätzlich direkt in der Liste.
// Nur sichtbar/aktiv mit dem APPROVE-Recht auf dem aktuellen Korb (siehe
// invoices/page.tsx: canApprove), serverseitig nochmals geprüft in
// DELETE /api/invoices/[id].
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function DeleteInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function del() {
    if (!window.confirm('Rechnung löschen? Sie wandert in den Papierkorb und kann dort wiederhergestellt werden.')) {
      return
    }
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      window.alert(data.error ?? 'Löschen fehlgeschlagen.')
    }
    setBusy(false)
    router.refresh()
  }

  return (
    <button
      type="button"
      className="text-[10px] text-gray-400 hover:text-[var(--danger)]"
      onClick={del}
      disabled={busy}
      title="Rechnung löschen (weich — landet im Papierkorb)"
    >
      {busy ? '…' : '🗑 Löschen'}
    </button>
  )
}
