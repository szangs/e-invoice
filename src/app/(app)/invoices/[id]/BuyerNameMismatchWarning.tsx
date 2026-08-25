'use client'

// Warnung "Rechnungsempfänger weicht ab" (Stefan 2026-08-25): der auf der
// E-Rechnung angegebene Rechnungsempfänger (buyerName) stimmt nicht mit der
// in den Firmenstammdaten hinterlegten exakten Firmenbezeichnung überein —
// z. B. bei einer versehentlich falsch adressierten Rechnung. Nach dem
// bestehenden Dubletten-Muster: akzeptieren statt löschen/verstecken, bleibt
// als bewusste Entscheidung nachvollziehbar.
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function BuyerNameMismatchWarning({
  invoiceId, expected, actual, acknowledged, locked,
}: {
  invoiceId: string
  expected: string
  actual: string
  acknowledged: boolean
  locked: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function accept() {
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerNameMismatchAcknowledged: true }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
  }

  if (acknowledged) {
    return (
      <p className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-gray-500">
        ⚠ Rechnungsempfänger „{actual}" weicht von der Firmenbezeichnung „{expected}" ab — als geprüft akzeptiert.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2">
      <p className="text-xs font-semibold text-[var(--warn-strong)]">
        ⚠ Rechnungsempfänger „{actual}" weicht von der hinterlegten Firmenbezeichnung „{expected}" ab —
        bitte prüfen, ob die Rechnung tatsächlich an uns adressiert ist.
      </p>
      {!locked && (
        <button type="button" className="btn-secondary !px-2 !py-1 text-xs shrink-0" onClick={accept} disabled={busy}
          title="Abweichung akzeptieren — z. B. wenn eine Kurzform oder Konzernschreibweise verwendet wurde">
          {busy ? '…' : 'Passt trotzdem'}
        </button>
      )}
    </div>
  )
}
