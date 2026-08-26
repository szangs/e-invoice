'use client'

// Blättern in der Detailansicht (Stefan 2026-08-26): die Rechnungsliste
// (InvoiceRows.tsx) merkt bei jeder Anzeige ihre gerade sichtbare, fertig
// sortierte/gefilterte Reihenfolge in sessionStorage ("invoiceNavContext")
// — hier wird daraus "‹ Zurück"/"X von Y"/"Weiter ›" gebaut, damit man sich
// beim Prüfen mehrerer Rechnungen nicht jedes Mal zur Liste zurückklicken
// muss. Ohne passenden Kontext (z. B. Direktaufruf per Lesezeichen) zeigt
// die Komponente einfach nichts an.
import Link from 'next/link'
import { useEffect, useState } from 'react'

type NavContext = { ids: string[]; listHref: string }

export function InvoiceNavigator({ currentId }: { currentId: string }) {
  const [ctx, setCtx] = useState<NavContext | null>(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('invoiceNavContext')
      if (!raw) return
      const parsed = JSON.parse(raw) as NavContext
      if (Array.isArray(parsed.ids) && parsed.ids.includes(currentId)) setCtx(parsed)
    } catch {
      // kein nutzbarer Kontext — Navigator bleibt einfach aus
    }
  }, [currentId])

  if (!ctx) return null
  const idx = ctx.ids.indexOf(currentId)
  const prevId = idx > 0 ? ctx.ids[idx - 1] : null
  const nextId = idx < ctx.ids.length - 1 ? ctx.ids[idx + 1] : null

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5">
      <Link href={ctx.listHref} className="text-xs text-[var(--accent)] hover:underline" title="Zurück zur Liste">
        ← Liste
      </Link>
      <div className="flex items-center gap-2">
        {prevId ? (
          <Link href={`/invoices/${prevId}`} className="btn-secondary !px-2 !py-1 text-xs" title="Vorherige Rechnung in dieser Liste">
            ‹ Zurück
          </Link>
        ) : (
          <span className="btn-secondary !px-2 !py-1 text-xs cursor-not-allowed opacity-40">‹ Zurück</span>
        )}
        <span className="text-xs text-gray-500">{idx + 1} von {ctx.ids.length}</span>
        {nextId ? (
          <Link href={`/invoices/${nextId}`} className="btn-secondary !px-2 !py-1 text-xs" title="Nächste Rechnung in dieser Liste">
            Weiter ›
          </Link>
        ) : (
          <span className="btn-secondary !px-2 !py-1 text-xs cursor-not-allowed opacity-40">Weiter ›</span>
        )}
      </div>
    </div>
  )
}
