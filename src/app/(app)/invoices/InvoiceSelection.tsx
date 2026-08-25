'use client'

// Mehrfachauswahl in der Rechnungsliste (Stefan 2026-08-25): Checkbox je Zeile
// + "alle auswählen" im Tabellenkopf teilen sich den Auswahlzustand über
// Context, da Kopf (th, in page.tsx) und Zeilen (InvoiceRows.tsx) getrennte
// Client-Bäume sind. BulkActionBar erscheint nur bei mindestens einer
// Auswahl und ruft für Verschieben/Löschen dieselben Routen wie die
// bestehenden Einzel-Aktionen auf (BasketMoveSelect / DeleteInvoiceButton),
// nur pro ausgewählter Rechnung nacheinander statt einzeln per Klick.
import { useRouter } from 'next/navigation'
import { createContext, useContext, useMemo, useState } from 'react'

type SelectionCtx = {
  selected: Set<string>
  toggle: (id: string) => void
  setAll: (ids: string[], checked: boolean) => void
  clear: () => void
}

const SelectionContext = createContext<SelectionCtx | null>(null)

export function InvoiceSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const value = useMemo<SelectionCtx>(
    () => ({
      selected,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        }),
      setAll: (ids, checked) =>
        setSelected((prev) => {
          const next = new Set(prev)
          for (const id of ids) {
            if (checked) next.add(id)
            else next.delete(id)
          }
          return next
        }),
      clear: () => setSelected(new Set()),
    }),
    [selected],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

function useSelection(): SelectionCtx {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection außerhalb von InvoiceSelectionProvider verwendet')
  return ctx
}

export function RowCheckbox({ id }: { id: string }) {
  const { selected, toggle } = useSelection()
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-[var(--line)] accent-[var(--accent)]"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      title="Für Mehrfachaktion auswählen"
    />
  )
}

export function SelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setAll } = useSelection()
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id))
  const someSelected = !allSelected && ids.some((id) => selected.has(id))
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-[var(--line)] accent-[var(--accent)]"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected
      }}
      onChange={(e) => setAll(ids, e.target.checked)}
      title="Alle sichtbaren Rechnungen auswählen/abwählen"
    />
  )
}

type BasketOption = { id: string; name: string }

export function BulkActionBar({
  baskets,
  currentBasketId,
  canMove,
  canApprove,
}: {
  baskets: BasketOption[]
  currentBasketId: string | null
  canMove: boolean
  canApprove: boolean
}) {
  const { selected, clear } = useSelection()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const ids = Array.from(selected)

  if (ids.length === 0) return null

  async function moveAll(targetBasketId: string) {
    if (!targetBasketId) return
    setBusy(true)
    let moved = 0
    let pendingApproval = 0
    let failed = 0
    let firstError: string | null = null
    for (const id of ids) {
      try {
        const res = await fetch(`/api/invoices/${id}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetBasketId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          failed++
          firstError ??= data.error ?? 'Fehler beim Verschieben'
          continue
        }
        if (data.moved === false) pendingApproval++
        else moved++
      } catch {
        failed++
      }
    }
    setBusy(false)
    clear()
    router.refresh()
    const parts = [`${moved} verschoben`]
    if (pendingApproval > 0) parts.push(`${pendingApproval} Freigabe erfasst (Vier-Augen-Korb)`)
    if (failed > 0) parts.push(`${failed} fehlgeschlagen${firstError ? ` — z. B. „${firstError}“` : ''}`)
    window.alert(parts.join(', ') + '.')
  }

  async function deleteAll() {
    if (
      !window.confirm(
        `${ids.length} Rechnung(en) löschen? Sie wandern in den Papierkorb und können dort wiederhergestellt werden.`,
      )
    ) {
      return
    }
    setBusy(true)
    let done = 0
    let failed = 0
    for (const id of ids) {
      const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
      if (res.ok) done++
      else failed++
    }
    setBusy(false)
    clear()
    router.refresh()
    window.alert(`${done} gelöscht${failed > 0 ? `, ${failed} fehlgeschlagen` : ''}.`)
  }

  return (
    <div className="dp-card flex flex-wrap items-center gap-3 !py-2.5 bg-[var(--accent-bg)]">
      <span className="text-sm font-semibold text-[var(--accent)]">
        {ids.length} ausgewählt
      </span>
      {canMove && (
        <select
          className="dp-input !w-auto !py-1 text-xs"
          value=""
          disabled={busy}
          title="Alle ausgewählten Rechnungen in einen anderen Korb verschieben"
          onChange={(e) => moveAll(e.target.value)}
        >
          <option value="">→ alle verschieben…</option>
          {baskets.filter((b) => b.id !== currentBasketId).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}
      {canApprove && (
        <button
          type="button"
          className="text-xs text-gray-500 hover:text-[var(--danger)]"
          onClick={deleteAll}
          disabled={busy}
          title="Alle ausgewählten Rechnungen löschen"
        >
          🗑 alle löschen
        </button>
      )}
      <button
        type="button"
        className="ml-auto text-xs text-gray-400 hover:text-gray-600"
        onClick={clear}
        disabled={busy}
      >
        Auswahl aufheben
      </button>
    </div>
  )
}
