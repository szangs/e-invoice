// Nachgebaute Rechnungsansicht für reine XML-Rechnungen (XRechnung UBL/CII):
// so ein Format hat kein eigenes Bild/PDF — bisher gab es auf der Detailseite
// dafür nur den generischen Hinweis "Keine Inline-Vorschau". Diese Komponente
// stellt die aus dem XML gelesenen Daten stattdessen wie ein Rechnungslayout
// dar (Kopf/Positionen/Summen), DEUTLICH mit Wasserzeichen als Nachbau
// gekennzeichnet — niemals mit einem echten, rechtsverbindlichen Original zu
// verwechseln, das nur als XML vorliegt.
import type { DocFormat, ParsedInvoiceData } from '@/lib/erechnung'
import { formatAmount } from '@/lib/invoices'

export function ERechnungMockInvoice({ data, format }: { data: ParsedInvoiceData; format: DocFormat }) {
  const currency = data.currency ?? 'EUR'
  const netSum = data.lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0)
  const discountSum = data.lines.reduce((s, l) => s + (l.discount ?? 0), 0)

  return (
    <div className="relative overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-sm">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      >
        <span className="rotate-[-22deg] select-none whitespace-nowrap text-[15px] font-extrabold uppercase tracking-widest text-red-600/25 sm:text-2xl">
          Nur E-Rechnungs-Visualisierung — kein Original
        </span>
      </div>

      <div className="relative space-y-5 p-5 text-sm text-gray-800">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
          <div>
            <p className="text-base font-bold">{data.sellerName ?? '—'}</p>
            {data.sellerVatId && <p className="font-mono text-[11px] text-gray-500">USt-ID: {data.sellerVatId}</p>}
          </div>
          <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            {format === 'XRECHNUNG_CII' ? 'XRechnung (CII)' : format === 'XRECHNUNG_UBL' ? 'XRechnung (UBL)' : format}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Rechnung an</p>
            <p>{data.buyerName ?? '—'}</p>
          </div>
          <div className="space-y-1 text-right text-xs">
            <MetaRow label="Rechnungsnr." value={data.number} />
            <MetaRow label="Datum" value={data.issueDate} />
            <MetaRow label="Lieferdatum" value={data.deliveryDate} />
            <MetaRow label="Fällig am" value={data.dueDate} />
          </div>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-gray-500">
              <th className="py-1 font-medium">Position</th>
              <th className="py-1 text-right font-medium">Menge</th>
              <th className="py-1 text-right font-medium">Rabatt</th>
              <th className="py-1 text-right font-medium">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length > 0 ? (
              data.lines.map((l, i) => (
                <tr key={i} className="border-b border-[var(--line)]/60">
                  <td className="py-1.5">{l.name}</td>
                  <td className="py-1.5 text-right">{l.quantity ?? '—'}</td>
                  <td className="py-1.5 text-right text-gray-500">{l.discount ? `− ${formatAmount(l.discount, currency)}` : '—'}</td>
                  <td className="py-1.5 text-right">{formatAmount(l.lineTotal, currency)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-2 text-center text-gray-400">Keine Positionen im XML angegeben</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="ml-auto max-w-[220px] space-y-1 text-xs">
          {discountSum > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Zwischensumme</span>
              <span>{formatAmount(netSum + discountSum, currency)}</span>
            </div>
          )}
          {discountSum > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Rabatte</span>
              <span>− {formatAmount(discountSum, currency)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Netto</span>
            <span>{formatAmount(data.net, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span>Umsatzsteuer</span>
            <span>{formatAmount(data.tax, currency)}</span>
          </div>
          <div className="flex justify-between border-t border-[var(--line)] pt-1 text-sm font-semibold text-[var(--accent)]">
            <span>Gesamtbetrag</span>
            <span>{formatAmount(data.gross, currency)}</span>
          </div>
        </div>

        {data.paymentTerms && (
          <p className="border-t border-[var(--line)] pt-2 text-[11px] text-gray-500">{data.paymentTerms}</p>
        )}

        <p className="text-center text-[10px] font-semibold uppercase tracking-wide text-red-600/70">
          Nur zur Visualisierung der XML-Daten — kein Original, keine Rechnungskopie
        </p>
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400">{label}</span>
      <span className="font-mono">{value ?? '—'}</span>
    </div>
  )
}
