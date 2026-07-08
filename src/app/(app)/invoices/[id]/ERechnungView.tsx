// E-Rechnungs-Ansicht (W17): Format-Badge, Prüfergebnis nach gesetzlichen
// Kernvorgaben und Visualisierung der strukturierten Rechnungsdaten inkl.
// Positionen. Für reine XML-Rechnungen (XRechnung) ist das zugleich das
// einzige "Rechnungsbild"; bei ZUGFeRD/PDF wird zusätzlich das echte PDF
// über InvoicePdfPreview angezeigt.
import type { DocFormat, ParsedInvoiceData, Validation } from '@/lib/erechnung'
import { FORMAT_LABELS } from '@/lib/erechnung'
import { formatAmount } from '@/lib/invoices'

export function ERechnungView({
  format,
  data,
  validation,
}: {
  format: DocFormat
  data: ParsedInvoiceData | null
  validation: Validation | null
}) {
  const currency = data?.currency ?? 'EUR'
  return (
    <div className="dp-card space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--accent-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
          {FORMAT_LABELS[format]}
        </span>
        {validation &&
          (validation.valid ? (
            <span className="rounded-full bg-[var(--accent-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
              ✓ Pflichtangaben vollständig
            </span>
          ) : (
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-[var(--danger)]">
              ✗ Pflichtangaben unvollständig
            </span>
          ))}
      </div>

      {validation && !validation.valid && (
        <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
          Fehlend (EN 16931-Kern / §14 UStG): {validation.missing.join(', ')}
        </p>
      )}

      {data && (
        <>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="Rechnungsnummer" value={data.number} mono />
            <Field label="Rechnungsdatum" value={data.issueDate} />
            <Field label="Fällig am" value={data.dueDate} />
            <Field label="Währung" value={data.currency} />
            <Field label="Rechnungssteller" value={data.sellerName} />
            <Field label="USt-ID/Steuernummer" value={data.sellerVatId} mono />
            <Field label="Rechnungsempfänger" value={data.buyerName} />
          </div>

          {data.lines.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="dp-tr">
                  <th className="dp-th">Position</th>
                  <th className="dp-th">Menge</th>
                  <th className="dp-th text-right">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={i} className="dp-tr">
                    <td className="dp-td">{l.name}</td>
                    <td className="dp-td text-xs">{l.quantity ?? '—'}</td>
                    <td className="dp-td text-right">{formatAmount(l.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <Total label="Netto" value={formatAmount(data.net, currency)} />
            <Total label="Umsatzsteuer" value={formatAmount(data.tax, currency)} />
            <div className="border-t border-[var(--line)] pt-1">
              <Total label="Gesamtbetrag" value={formatAmount(data.gross, currency)} strong />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm text-gray-800 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</p>
    </div>
  )
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold text-[var(--accent)]' : 'text-gray-700'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
