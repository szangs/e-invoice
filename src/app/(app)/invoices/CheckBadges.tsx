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
  /** Korb-Recht APPROVE ("Sachlich freigeben") auf dem aktuellen Korb der Rechnung (Stefan 2026-07-08). */
  canApprove?: boolean
  /** Korb-Recht HANDOVER ("Übergabe an den Übergabekorb") auf dem aktuellen Korb der Rechnung. */
  canAccounting?: boolean
}

function fmt(at: string | null, by: string | null): string {
  if (!at) return 'offen'
  return `${by ?? '—'} am ${new Date(at).toLocaleString('de-DE')}`
}

export function CheckBadges({
  invoiceId, electronicAt, electronicBy, formalAt, formalBy,
  substantiveAt, substantiveBy, accountingAt, accountingBy,
  canApprove = true, canAccounting = true,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  // Sichtbare Rückmeldung beim automatischen Wechsel (Stefan 2026-07-09): die
  // Zeile verschwindet sonst kommentarlos aus der Liste beim router.refresh()
  // — kurzer, nicht-blockierender Hinweis statt window.alert, damit man
  // direkt weiterarbeiten kann.
  const [autoMoveNotice, setAutoMoveNotice] = useState<string | null>(null)

  async function toggle(key: 'checkSubstantive' | 'checkAccounting', value: boolean) {
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    // Vier-Augen-Korb (Stefan 2026-07-09): wenn alle drei Häkchen stehen,
    // versucht die Rechnung automatisch in den Übergabekorb zu wechseln — ist
    // der Ausgangskorb Vier-Augen-gesperrt, zählt das nur als eine von zwei
    // nötigen Freigaben.
    if (data?.autoMoveApprovalPending) {
      window.alert(
        `Freigabe für automatischen Wechsel in den Übergabekorb erfasst — noch ${data.autoMoveApprovalPending.approvalsNeeded} weitere Freigabe(n) durch einen anderen Mitarbeiter nötig (Vier-Augen-Korb).`,
      )
      router.refresh()
      return
    }
    if (data?.autoMoved) {
      setAutoMoveNotice(`✓ Vollständig geprüft → automatisch in „${data.autoMoved.targetBasketName}“ verschoben`)
      // Zeile bleibt kurz sichtbar, damit die Meldung gelesen werden kann,
      // statt sofort aus der Liste zu verschwinden.
      setTimeout(() => router.refresh(), 1800)
      return
    }
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
        disabled={busy || !canApprove}
        onClick={() => toggle('checkSubstantive', !substantiveAt)}
        className={`${base} ${substantiveAt ? on : off} ${canApprove ? 'cursor-pointer hover:opacity-75' : 'cursor-not-allowed opacity-50'}`}
        title={canApprove ? `Sachlich richtig — ${fmt(substantiveAt, substantiveBy)} (klicken zum Umschalten)` : 'Kein Recht, „Sachlich richtig" freizugeben'}
      >
        {label(substantiveAt, 'S')}
      </button>
      <button
        type="button"
        disabled={busy || !canAccounting}
        onClick={() => toggle('checkAccounting', !accountingAt)}
        className={`${base} ${accountingAt ? on : off} ${canAccounting ? 'cursor-pointer hover:opacity-75' : 'cursor-not-allowed opacity-50'}`}
        title={canAccounting ? `An Buchhaltung übergeben — ${fmt(accountingAt, accountingBy)} (klicken zum Umschalten)` : 'Nur im Übergabekorb möglich (und nur mit dem passenden Recht)'}
      >
        {label(accountingAt, 'B')}
      </button>
    </div>
  )
}
