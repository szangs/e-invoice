'use client'

// Korb-Kachelleiste (Stefan 2026-07-08): zeigt Körbe in fester Reihenfolge
// (Eingangskorb zuerst, Übergabekorb an FiBu zuletzt) mit bearbeitet/
// unbearbeitet-Zahlen. Auf der Rechnungsliste zusätzlich Drop-Ziel — eine
// per Drag&Drop hierher gezogene Rechnungszeile wird in diesen Korb
// verschoben (ruft dieselbe Route wie das Dropdown in der Liste auf).
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type BasketTile = {
  id: string
  name: string
  kind: 'INBOX' | 'HANDOVER' | 'CUSTOM' | 'ARCHIVE'
  unprocessed: number
  processed: number
  /** Zahlungsziel (dueDate) liegt in den nächsten Tagen — ohne Lastschrift/bereits an Fibu übergeben. */
  dueSoon?: number
  /** Zahlungsziel (dueDate) bereits überschritten — ohne Lastschrift/bereits an Fibu übergeben. */
  overdue?: number
  /** Ungelesene, an den aktuellen Nutzer gerichtete Nachrichten in diesem Korb. */
  unreadNotes?: number
  /** Vollständig geprüft und noch nicht übergeben (Stefan 2026-07-09) — nur im
   * Übergabekorb angezeigt, dort aussagekräftiger als offen/bearbeitet. */
  readyForHandover?: number
}

export function BasketStrip({
  baskets,
  activeBasketId,
  basePath,
  baseParams,
  allowDrop = false,
  trash,
}: {
  baskets: BasketTile[]
  activeBasketId: string | null
  /** Ziel-URL ohne Query, z. B. "/invoices" — Funktionen lassen sich nicht von
   * Server- an Client-Komponenten übergeben, daher Pfad + Basis-Parameter statt hrefFor(). */
  basePath: string
  /** bereits vorhandene Filter (q, status, dup …), die beim Korb-Wechsel erhalten bleiben sollen */
  baseParams?: Record<string, string>
  allowDrop?: boolean
  /** Papierkorb als zusätzliche Kachel ganz rechts (Stefan 2026-07-08) — kein
   * echter Korb, daher eigener href/active-Zustand statt Eintrag in `baskets`.
   * canDelete steuert, ob eine hierher gezogene Rechnung gelöscht werden darf
   * (dasselbe APPROVE-Recht wie der Löschen-Button in der Liste). */
  trash?: { href: string; active: boolean; count: number; canDelete?: boolean }
}) {
  const router = useRouter()
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [trashDragOver, setTrashDragOver] = useState(false)
  const [busy, setBusy] = useState(false)

  function hrefFor(basketId: string | null): string {
    const params = new URLSearchParams({ ...(baseParams ?? {}), ...(basketId ? { basket: basketId } : {}) })
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  async function onDrop(e: React.DragEvent, basketId: string) {
    e.preventDefault()
    setDragOver(null)
    const invoiceId = e.dataTransfer.getData('application/x-invoice-id')
    if (!invoiceId || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetBasketId: basketId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        window.alert(data.error ?? 'Verschieben fehlgeschlagen.')
        return
      }
      if (data.moved === false) {
        window.alert(`Freigabe erfasst — noch ${data.approvalsNeeded} weitere Freigabe(n) durch einen anderen Mitarbeiter nötig (Vier-Augen-Korb).`)
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function onDropTrash(e: React.DragEvent) {
    e.preventDefault()
    setTrashDragOver(false)
    const invoiceId = e.dataTransfer.getData('application/x-invoice-id')
    if (!invoiceId || busy) return
    if (!window.confirm('Rechnung löschen? Sie wandert in den Papierkorb und kann dort wiederhergestellt werden.')) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        window.alert(data.error ?? 'Löschen fehlgeschlagen.')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const KIND_HINT: Record<BasketTile['kind'], string> = {
    INBOX: 'Fester Eingangskorb — jede neue Rechnung landet zuerst hier',
    HANDOVER: 'Fester Übergabekorb an die Finanzbuchhaltung — immer der letzte Schritt',
    CUSTOM: 'Eigener Korb',
    ARCHIVE: 'Feste Ablage — Rechnungen landen hier automatisch nach der Übergabe und bleiben hier. Nur Admin/Betreiber kann Belege wieder herausverschieben.',
  }

  // Kräftigere, sofort unterscheidbare Farbgebung je Korb-Art statt neutralem Grau.
  const KIND_STYLE: Record<BasketTile['kind'], { ring: string; iconBg: string; iconFg: string; barActive: string }> = {
    INBOX: { ring: 'border-[var(--accent)]', iconBg: 'bg-[var(--accent)]', iconFg: 'text-white', barActive: 'bg-[var(--accent)]' },
    HANDOVER: { ring: 'border-[var(--warn-strong)]', iconBg: 'bg-[var(--warn)]', iconFg: 'text-white', barActive: 'bg-[var(--warn)]' },
    CUSTOM: { ring: 'border-[var(--accent-soft)]', iconBg: 'bg-[var(--accent-bg)]', iconFg: 'text-[var(--accent)]', barActive: 'bg-[var(--accent-soft)]' },
    ARCHIVE: { ring: 'border-gray-400', iconBg: 'bg-gray-500', iconFg: 'text-white', barActive: 'bg-gray-400' },
  }

  return (
    <div className="flex flex-wrap gap-3">
      {baskets.map((b) => {
        const isActive = activeBasketId === b.id
        const isDragOver = dragOver === b.id
        const style = KIND_STYLE[b.kind]
        const total = b.unprocessed + b.processed
        const pct = total > 0 ? Math.round((b.processed / total) * 100) : 0
        return (
          <div
            key={b.id}
            onDragOver={allowDrop ? (e) => { e.preventDefault(); setDragOver(b.id) } : undefined}
            onDragLeave={allowDrop ? () => setDragOver((d) => (d === b.id ? null : d)) : undefined}
            onDrop={allowDrop ? (e) => onDrop(e, b.id) : undefined}
            title={allowDrop ? `${KIND_HINT[b.kind]} — Rechnungszeile hier ablegen zum Verschieben` : KIND_HINT[b.kind]}
            className={`min-w-[190px] rounded-2xl border-2 bg-white px-4 py-3.5 shadow-sm transition ${
              isDragOver
                ? `${style.ring} scale-[1.03] bg-[var(--accent-bg)] shadow-lg ring-4 ring-[var(--accent-bg)]`
                : isActive
                  ? `${style.ring} bg-[var(--accent-bg)] shadow-md`
                  : 'border-[var(--line)] hover:border-[var(--accent-soft)] hover:shadow-md'
            }`}
          >
            <Link href={hrefFor(b.id)} className="flex items-center gap-2.5">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.iconBg} ${style.iconFg}`}>
                <BasketKindIcon kind={b.kind} />
              </span>
              <span className="min-w-0">
                <span className={`block truncate text-sm font-semibold ${isActive ? 'text-[var(--accent)]' : 'text-gray-800'}`}>
                  {b.name}
                  {(b.unreadNotes ?? 0) > 0 && (
                    <span title={`${b.unreadNotes} ungelesene Nachricht${b.unreadNotes === 1 ? '' : 'en'} an Sie in diesem Korb`} className="ml-1">💬</span>
                  )}
                </span>
                <span className="block text-[11px] text-gray-500">{total} Beleg{total === 1 ? '' : 'e'}</span>
              </span>
              {b.kind !== 'ARCHIVE' && b.unprocessed > 0 && (
                <span
                  title="Anzahl noch unbearbeiteter Belege"
                  className="ml-auto flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-[var(--warn)] px-1.5 text-[11px] font-bold text-white"
                >
                  {b.unprocessed}
                </span>
              )}
            </Link>
            {/* Ablage (Stefan 2026-07-09): offen/bearbeitet ergibt hier keinen
                Sinn mehr — alles liegt schon vollständig geprüft und übergeben,
                die Beleg-Anzahl oben reicht. Übergabekorb: statt offen/
                bearbeitet ist "bereit zur Übergabe" die aussagekräftigere Zahl. */}
            {b.kind === 'HANDOVER' ? (
              <p className="mt-2 text-[11px]">
                <span
                  title="Elektronisch, Formal und Sachlich richtig sind abgehakt — wartet nur noch auf die Übergabe an die Fibu"
                  className={`font-medium ${(b.readyForHandover ?? 0) > 0 ? 'text-[var(--accent)]' : 'text-gray-400'}`}
                >
                  {b.readyForHandover ?? 0} bereit zur Übergabe
                </span>
              </p>
            ) : b.kind !== 'ARCHIVE' && (
              <>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]" title={`${pct}% bearbeitet`}>
                  <div className={`h-full rounded-full ${style.barActive} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500">
                  <span title="Noch keine Vorprüfung/Formalprüfung durchgeführt" className="font-medium text-[var(--warn-strong)]">{b.unprocessed} offen</span>
                  {' · '}
                  <span title="Elektronische Vorprüfung oder Formal richtig bereits abgehakt">{b.processed} bearbeitet</span>
                </p>
              </>
            )}
            {((b.overdue ?? 0) > 0 || (b.dueSoon ?? 0) > 0) && (
              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                {(b.overdue ?? 0) > 0 && (
                  <span
                    title="Zahlungsziel bereits überschritten (ohne Lastschrift/bereits an Fibu übergeben)"
                    className="font-semibold text-[var(--danger)]"
                  >
                    ⚠ {b.overdue} überfällig
                  </span>
                )}
                {(b.dueSoon ?? 0) > 0 && (
                  <span
                    title="Zahlungsziel in den nächsten 7 Tagen (ohne Lastschrift/bereits an Fibu übergeben)"
                    className="font-medium text-[var(--warn-strong)]"
                  >
                    {b.dueSoon} bald fällig
                  </span>
                )}
              </p>
            )}
          </div>
        )
      })}
      {trash && (
        <Link
          href={trash.href}
          onDragOver={trash.canDelete && !trash.active ? (e) => { e.preventDefault(); setTrashDragOver(true) } : undefined}
          onDragLeave={trash.canDelete && !trash.active ? () => setTrashDragOver(false) : undefined}
          onDrop={trash.canDelete && !trash.active ? onDropTrash : undefined}
          title={
            trash.active
              ? 'Zurück zu den Ablagekörben'
              : trash.canDelete
                ? 'Als gelöscht markierte Rechnungen ansehen und wiederherstellen — Rechnungszeile hier ablegen zum Löschen'
                : 'Als gelöscht markierte Rechnungen ansehen und wiederherstellen'
          }
          className={`ml-auto flex min-w-[190px] shrink-0 items-center gap-2.5 rounded-2xl border-2 bg-white px-4 py-3.5 shadow-sm transition ${
            trashDragOver
              ? 'scale-[1.03] border-[var(--danger)] bg-red-50 shadow-lg ring-4 ring-red-100'
              : trash.active
                ? 'border-gray-400 bg-gray-50 shadow-md'
                : 'border-[var(--line)] hover:border-gray-400 hover:shadow-md'
          }`}
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            trashDragOver ? 'bg-[var(--danger)] text-white' : trash.active ? 'bg-gray-500 text-white' : 'bg-gray-100 text-gray-500'
          }`}>
            <TrashIcon />
          </span>
          <span className="min-w-0">
            <span className={`block truncate text-sm font-semibold ${trash.active ? 'text-gray-700' : 'text-gray-800'}`}>
              Papierkorb
            </span>
            <span className="block text-[11px] text-gray-500">{trash.count} Beleg{trash.count === 1 ? '' : 'e'}</span>
          </span>
        </Link>
      )}
    </div>
  )
}

/** Exportiert, da auch die Körbe-Verwaltung (admin/baskets/BasketAdmin.tsx)
 * denselben Papierkorb-Kachel-Look für gelöschte Körbe verwendet. */
export function TrashIcon() {
  const common = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg {...common} aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

/** Passende Liniensymbole je Korb-Art statt generischer Emojis — Eingang (Tray),
 * Übergabe (Pfeil nach außen), eigener Korb (Aktenkorb-Silhouette). Exportiert,
 * da auch die Körbe-Verwaltung (admin/baskets/BasketAdmin.tsx) dieselben
 * Symbole für die Kachelleiste dort verwendet. */
export function BasketKindIcon({ kind }: { kind: BasketTile['kind'] }) {
  const common = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'INBOX') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 12h4l2 3h4l2-3h4" />
        <path d="M5.5 5h13l1.5 7v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6z" />
      </svg>
    )
  }
  if (kind === 'HANDOVER') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 12h4l2 3h4l2-3h4" />
        <path d="M5.5 5h13l1.5 7v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6z" />
        <path d="M12 3v6M9.5 6.5 12 9l2.5-2.5" />
      </svg>
    )
  }
  if (kind === 'ARCHIVE') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 5h16v4H4z" />
        <path d="M5 9v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
        <path d="M10 13h4" />
      </svg>
    )
  }
  return (
    <svg {...common} aria-hidden="true">
      <path d="M5 10h14l-1.4 8.4a1 1 0 0 1-1 .8H7.4a1 1 0 0 1-1-.8z" />
      <path d="M9 10 8 5h8l-1 5M10.5 13.5v3M13.5 13.5v3" />
    </svg>
  )
}
