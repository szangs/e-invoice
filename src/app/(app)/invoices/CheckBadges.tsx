'use client'

// Kompakte Anzeige der 4 Rechnungsprüfung-Schritte in der Rechnungsliste
// (Stefan 2026-07-07: Häkchen sollen auch ohne Öffnen der Detailseite
// sichtbar sein). "Elektronische Vorprüfung" und "Formal richtig" sind hier
// nur Lesestatus (Bearbeitung bleibt auf der Detailseite) — "Sachlich
// richtig" und "An Buchhaltung übergeben" sind Buchhaltungs-Schritte und
// direkt in der Liste togglebar, ohne die Rechnung einzeln öffnen zu müssen.
// 5. Badge "K" (Stefan 2026-08-26): Ergebnis der automatischen KoSIT-Prüfung
// (lib/kositValidator.ts scheduleKositCheck), reiner Lesestatus wie E/F.
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { EINVOICE_FORMATS } from '@/lib/docFormat'

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
  /** Für die K-Badge (Stefan 2026-08-26) — nur bei echter E-Rechnung relevant. */
  docFormat: string | null
  kositCheckedAt: string | null
  kositAccepted: boolean | null
}

function fmt(at: string | null, by: string | null): string {
  if (!at) return 'offen'
  return `${by ?? '—'} am ${new Date(at).toLocaleString('de-DE')}`
}

export function CheckBadges({
  invoiceId, electronicAt, electronicBy, formalAt, formalBy,
  substantiveAt, substantiveBy, accountingAt, accountingBy,
  canApprove = true, canAccounting = true,
  docFormat, kositCheckedAt, kositAccepted,
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

  const base = 'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold'
  // Stefan 2026-08-26 ("Symbole schwer verständlich"): der Buchstabe bleibt
  // IMMER sichtbar (vorher wurde er im erledigten Zustand durch ein Häkchen
  // ersetzt — dadurch sahen alle vier erledigten Schritte gleich aus, ein
  // grünes ✓ neben dem nächsten). Erledigt = ausgefüllter Kreis mit weißem
  // Buchstaben, offen = umrandeter Kreis mit farbigem Buchstaben — der
  // Unterschied ist so auch ohne Tooltip sofort sichtbar. (Die Icon-statt-
  // Buchstabe-Rückmeldung bezog sich auf die Pflichtangaben-Punkte in
  // ERechnungView.tsx, nicht auf diese Prüfkette — siehe FieldDot dort.)
  const on = 'border-green-600 bg-green-600 text-white'
  const off = 'border-gray-300 bg-white text-gray-400'
  // Stefan 2026-08-26 ("verwirrt das"): "entfällt" (nackte PDF/Scan, kein
  // E-Rechnungs-Format) war grau — sah neben den grünen erledigten Schritten
  // wie ein offener/negativer Punkt aus. Jetzt genauso grün wie "erledigt",
  // nur weiterhin mit "–" statt Haken (kein E-Rechnungs-Format, keine echte Prüfung).
  const na = on
  const fail = 'border-[var(--danger)] bg-[var(--danger)] text-white'
  const unclear = 'border-[var(--warn-strong)] bg-[var(--warn-strong)] text-white'
  // Nicht-E-Rechnung (Stefan 2026-08-25): "Elektronische Vorprüfung" nicht
  // anwendbar — eigenes, blasses "–" statt eines grünen Häkchens, das eine
  // bestandene Prüfung vortäuschen würde (siehe lib/erechnung.ts autoElectronicCheck).
  const electronicNotApplicable = Boolean(electronicAt && electronicBy?.startsWith('System (entfällt'))
  // K = automatische KoSIT-Prüfung (Stefan 2026-08-26) — nicht anwendbar bei
  // Nicht-E-Rechnung, sonst grün/rot/gelb je nach Ergebnis, grau solange der
  // Hintergrund-Check noch nicht durchgelaufen ist.
  const kositApplicable = (EINVOICE_FORMATS as readonly string[]).includes(docFormat ?? '')
  const kositStyle = !kositApplicable ? na
    : !kositCheckedAt ? off
      : kositAccepted === true ? on
        : kositAccepted === false ? fail
          : unclear
  const kositLabel = !kositApplicable ? '–' : 'K'
  const kositTitle = !kositApplicable
    ? 'K = KoSIT-Prüfung — entfällt (kein E-Rechnungs-Format)'
    : !kositCheckedAt
      ? 'K = KoSIT-Prüfung — noch nicht geprüft'
      : `K = KoSIT-Prüfung — ${kositAccepted === true ? 'akzeptabel' : kositAccepted === false ? 'zurückgewiesen' : 'Ergebnis unklar'} (${new Date(kositCheckedAt).toLocaleString('de-DE')})`

  return (
    <div className="flex items-center gap-1">
      <span className={`${base} ${electronicNotApplicable ? na : electronicAt ? on : off}`}
        title={`E = Elektronische Vorprüfung — ${electronicNotApplicable ? 'entfällt (kein E-Rechnungs-Format)' : fmt(electronicAt, electronicBy)}`}>
        {electronicNotApplicable ? '–' : 'E'}
      </span>
      <span className={`${base} ${formalAt ? on : off}`} title={`F = Formal richtig — ${fmt(formalAt, formalBy)}`}>F</span>
      <button
        type="button"
        disabled={busy || !canApprove}
        onClick={() => toggle('checkSubstantive', !substantiveAt)}
        className={`${base} ${substantiveAt ? on : off} ${canApprove ? 'cursor-pointer hover:opacity-75' : 'cursor-not-allowed opacity-50'}`}
        title={canApprove ? `S = Sachlich richtig — ${fmt(substantiveAt, substantiveBy)} (klicken zum Umschalten)` : 'S = Sachlich richtig — kein Recht, dies freizugeben'}
      >
        S
      </button>
      <button
        type="button"
        disabled={busy || !canAccounting}
        onClick={() => toggle('checkAccounting', !accountingAt)}
        className={`${base} ${accountingAt ? on : off} ${canAccounting ? 'cursor-pointer hover:opacity-75' : 'cursor-not-allowed opacity-50'}`}
        title={canAccounting ? `B = An Buchhaltung übergeben — ${fmt(accountingAt, accountingBy)} (klicken zum Umschalten)` : 'B = An Buchhaltung übergeben — nur im Übergabekorb möglich (und nur mit dem passenden Recht)'}
      >
        B
      </button>
      <span className={`${base} ${kositStyle}`} title={kositTitle}>{kositLabel}</span>
    </div>
  )
}
