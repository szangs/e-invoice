'use client'

// Kompakte Anzeige der 4 Rechnungsprüfung-Schritte in der Rechnungsliste
// (Stefan 2026-07-07: Häkchen sollen auch ohne Öffnen der Detailseite
// sichtbar sein). "Elektronische Vorprüfung" und "Formal richtig" sind hier
// nur Lesestatus (Bearbeitung bleibt auf der Detailseite) — "Sachlich
// richtig" und "An Buchhaltung übergeben" sind Buchhaltungs-Schritte und
// direkt in der Liste togglebar, ohne die Rechnung einzeln öffnen zu müssen.
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Props = {
  invoiceId: string
  electronicAt: string | null
  electronicBy: string | null
  formalAt: string | null
  formalBy: string | null
  substantiveAt: string | null
  substantiveBy: string | null
  accountingAt: string | null
  accountingBy: string | null
}

function fmt(at: string | null, by: string | null): string {
  if (!at) return 'offen'
  return `${by ?? '—'} am ${new Date(at).toLocaleString('de-DE')}`
}

export function CheckBadges({
  invoiceId, electronicAt, electronicBy, formalAt, formalBy,
  substantiveAt, substantiveBy, accountingAt, accountingBy,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function toggle(key: 'checkSubstantive' | 'checkAccounting', value: boolean) {
    setBusy(true)
    await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    setBusy(false)
    router.refresh()
  }

  const base = 'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold'
  const on = 'bg-green-50 text-green-600'
  const off = 'bg-[var(--surface-muted)] text-gray-400'
  // Erledigt = grünes Häkchen, offen = Buchstabe (damit man auch im offenen
  // Zustand noch sieht, welcher Schritt gemeint ist).
  const label = (at: string | null, letter: string) => (at ? '✓' : letter)

  return (
    <div className="flex items-center gap-1">
      <span className={`${base} ${electronicAt ? on : off}`} title={`Elektronische Vorprüfung — ${fmt(electronicAt, electronicBy)}`}>{label(electronicAt, 'E')}</span>
      <span className={`${base} ${formalAt ? on : off}`} title={`Formal richtig — ${fmt(formalAt, formalBy)}`}>{label(formalAt, 'F')}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => toggle('checkSubstantive', !substantiveAt)}
        className={`${base} ${substantiveAt ? on : off} cursor-pointer hover:opacity-75`}
        title={`Sachlich richtig — ${fmt(substantiveAt, substantiveBy)} (klicken zum Umschalten)`}
      >
        {label(substantiveAt, 'S')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => toggle('checkAccounting', !accountingAt)}
        className={`${base} ${accountingAt ? on : off} cursor-pointer hover:opacity-75`}
        title={`An Buchhaltung übergeben — ${fmt(accountingAt, accountingBy)} (klicken zum Umschalten)`}
      >
        {label(accountingAt, 'B')}
      </button>
    </div>
  )
}
