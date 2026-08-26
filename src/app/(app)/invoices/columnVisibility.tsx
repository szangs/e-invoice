'use client'

// Spaltenauswahl für die Rechnungsliste (Stefan 2026-08-26): welche
// optionalen Spalten angezeigt werden, pro Browser in localStorage gemerkt
// (kein Server-Feld nötig, reine Anzeige-Einstellung). Kern-Spalten (Dok-ID,
// Lieferant, Brutto, Status, Beleg, Aktion) sind immer sichtbar und deshalb
// hier nicht aufgeführt.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export const OPTIONAL_COLUMNS = [
  { key: 'invoiceNumber', label: 'Nummer' },
  { key: 'invoiceDate', label: 'Datum' },
  { key: 'dueDate', label: 'Fällig' },
  { key: 'createdAt', label: 'Eingang' },
  { key: 'amountNet', label: 'Netto' },
  { key: 'docFormat', label: 'Inhalt' },
  { key: 'mailBodyText', label: 'Mailtext' },
  { key: 'thumbnail', label: 'Vorschau' },
  { key: 'checks', label: 'Prüfung' },
] as const

export type OptionalColumnKey = (typeof OPTIONAL_COLUMNS)[number]['key']
type Visibility = Record<OptionalColumnKey, boolean>

const DEFAULT_VISIBILITY = Object.fromEntries(OPTIONAL_COLUMNS.map((c) => [c.key, true])) as Visibility

const ColumnVisibilityContext = createContext<{
  visible: Visibility
  setVisible: (key: OptionalColumnKey, value: boolean) => void
} | null>(null)

// Korb-spezifisch statt eine einzige globale Einstellung (Stefan 2026-08-26):
// im Eingangskorb sind andere Spalten relevant als z. B. in der Ablage —
// `scopeKey` (z. B. die Korb-ID oder "trash") geht in den localStorage-
// Schlüssel ein, jeder Korb merkt sich seine Sichtbarkeit also getrennt.
export function ColumnVisibilityProvider({ scopeKey, children }: { scopeKey: string; children: ReactNode }) {
  const storageKey = `invoiceListColumns.v1.${scopeKey}`
  const [visible, setVisibleState] = useState<Visibility>(DEFAULT_VISIBILITY)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      setVisibleState(raw ? { ...DEFAULT_VISIBILITY, ...JSON.parse(raw) } : DEFAULT_VISIBILITY)
    } catch {
      // localStorage nicht verfügbar (privates Fenster o. Ä.) — bei
      // Standardeinstellung (alle Spalten sichtbar) bleiben.
      setVisibleState(DEFAULT_VISIBILITY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])
  function setVisible(key: OptionalColumnKey, value: boolean) {
    setVisibleState((prev) => {
      const next = { ...prev, [key]: value }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // s. o.
      }
      return next
    })
  }
  return <ColumnVisibilityContext.Provider value={{ visible, setVisible }}>{children}</ColumnVisibilityContext.Provider>
}

export function useColumnVisibility() {
  const ctx = useContext(ColumnVisibilityContext)
  if (!ctx) throw new Error('useColumnVisibility muss innerhalb von ColumnVisibilityProvider verwendet werden')
  return ctx
}
