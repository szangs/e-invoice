'use client'

// Lieferanten-Adressregister (Stefan 2026-08-26): anders als die
// Lieferanten-Konten oben (manuell per CSV importiert) füllt sich diese
// Liste automatisch — bei jeder Rechnung mit lesbarer Anschrift wird der
// aktuellste Stand je Lieferant gespeichert (siehe lib/vendorMemory.ts
// upsertVendorAddress). Reine Anzeige + Export, kein manueller Import/Edit
// hier — die Werte kommen ja laufend von den Rechnungen selbst.
import { useEffect, useState } from 'react'

type VendorAddress = { id: string; vendorName: string; address: string; updatedAt: string }

export function VendorAddressesPanel() {
  const [rows, setRows] = useState<VendorAddress[] | null>(null)

  useEffect(() => {
    fetch('/api/admin/vendor-addresses')
      .then((r) => r.json())
      .then((d) => setRows(d.addresses ?? []))
      .catch(() => setRows([]))
  }, [])

  return (
    <section className="dp-card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Lieferanten-Adressregister</h2>
        <a className="btn-secondary !px-2.5 !py-1 text-xs" href="/api/invoices/export/vendor-addresses"
          title="Lieferant + zuletzt übermittelte Anschrift als CSV herunterladen — z. B. für einen eigenständigen Import in die Fibu">
          CSV-Export
        </a>
      </div>
      <p className="text-[11px] text-gray-400">
        Wird automatisch aus eingehenden Rechnungen gepflegt — je Lieferant immer die zuletzt
        übermittelte Anschrift, kein manueller Import nötig. Der Export lässt sich unabhängig vom
        DATEV-Buchungsexport jederzeit an die Fibu weitergeben.
      </p>
      {rows === null && <p className="text-xs text-gray-400">Lade …</p>}
      {rows && rows.length === 0 && <p className="text-xs text-gray-400">Noch keine Anschriften erfasst.</p>}
      {rows && rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1">Lieferant</th>
              <th className="py-1">Anschrift</th>
              <th className="py-1">Aktualisiert</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--line)]">
                <td className="py-1">{r.vendorName}</td>
                <td className="py-1 text-gray-600">{r.address}</td>
                <td className="py-1 text-gray-400">{new Date(r.updatedAt).toLocaleDateString('de-DE')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
