'use client'

// Globaler Hinweis auf offene "Zur Prüfung weitergeben"-Übergaben (Stefan
// 2026-08-27, Fehlerbericht "weitergegebene Belege kommen nicht an") — auf
// jeder Seite sichtbar (siehe (app)/layout.tsx), NICHT nur auf der
// Rechnungsliste, weil die Liste immer nach Korb-Rechten gefiltert ist und
// eine Übergabe bewusst keinen Korb-Wechsel auslöst (siehe
// lib/invoiceHandoff.ts) — ohne diesen Hinweis könnte der Empfänger nie
// erfahren, dass ihm etwas übergeben wurde.
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Handoff = { invoiceId: string; label: string; subject: string | null; authorName: string; createdAt: string }

const POLL_MS = 60_000

export function HandoffInbox() {
  const [handoffs, setHandoffs] = useState<Handoff[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetch('/api/invoices/handoffs/mine')
        .then((r) => r.json())
        .then((d: { handoffs?: Handoff[] }) => { if (!cancelled) setHandoffs(d.handoffs ?? []) })
        .catch(() => undefined)
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (handoffs.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-40 print:hidden">
      {open && (
        <div className="mb-2 w-72 rounded-xl border border-[var(--line)] bg-white p-3 shadow-xl">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            Ihnen zur Prüfung übergeben
          </p>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {handoffs.map((h) => (
              <li key={h.invoiceId}>
                <Link
                  href={`/invoices/${h.invoiceId}`}
                  className="block rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
                  onClick={() => setOpen(false)}
                >
                  <span className="font-medium text-gray-800">{h.label}</span>
                  <span className="block text-[11px] text-gray-500">
                    von {h.authorName} · {new Date(h.createdAt).toLocaleString('de-DE')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-lg"
        onClick={() => setOpen((v) => !v)}
      >
        📥 {handoffs.length} zur Prüfung übergeben
      </button>
    </div>
  )
}
