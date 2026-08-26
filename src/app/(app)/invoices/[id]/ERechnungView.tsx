// E-Rechnungs-Ansicht (W17): Format-Badge, Prüfergebnis nach gesetzlichen
// Kernvorgaben und Visualisierung der strukturierten Rechnungsdaten inkl.
// Positionen. Für reine XML-Rechnungen (XRechnung) ist das zugleich das
// einzige "Rechnungsbild"; bei ZUGFeRD/PDF wird zusätzlich das echte PDF
// über InvoicePdfPreview angezeigt.
import type { DocFormat, ParsedInvoiceData, TaxRegion, Validation } from '@/lib/erechnung'
import { FORMAT_LABELS, TAX_REGION_LABELS } from '@/lib/erechnung'
import { formatAmount } from '@/lib/invoices'
import { BuyerNameMismatchWarning } from './BuyerNameMismatchWarning'

export type ReviewStatus = 'pending' | 'confirmed' | 'flagged'
const REVIEW_STATUS_ICON: Record<ReviewStatus, { icon: string; title: string; className: string }> = {
  pending: { icon: '⏳', title: 'Noch zu prüfen — Tab zum Übernehmen, Shift+Tab wenn der Wert falsch ist', className: 'text-[var(--warn-strong)]' },
  confirmed: { icon: '✓', title: 'Bestätigt', className: 'text-[var(--accent)]' },
  flagged: { icon: '✗', title: 'Als falsch markiert — bitte Wert korrigieren', className: 'text-[var(--danger)]' },
}

export type EditableFieldConfig = {
  value: string
  onChange: (v: string) => void
  warn?: boolean
  reviewStatus?: ReviewStatus
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  required?: boolean
  // Skonto u. ä. (Stefan 2026-08-25) — leer ist hier normal, kein fehlender
  // Pflichtwert. Bekommt deshalb bewusst NICHT dieselbe amber "fehlt"-Optik
  // wie z. B. USt-IdNr./Anschrift, sonst sieht ein optionales Feld genauso
  // dringend aus wie eine echte Pflichtangabe.
  optional?: boolean
}

// Direkte Eingabe in dieser ruhigen Kopfzeile statt eines zweiten, dichten
// Formulars weiter unten (Stefan 2026-08-25) — nur bei Rechnungen OHNE
// strukturierte E-Rechnungs-Daten (kein ZUGFeRD/XRechnung) gesetzt, siehe
// InvoiceEditForm.tsx. Bei einer E-Rechnung bleibt diese Ansicht wie bisher
// rein lesend (GoBD-Original aus dem XML).
export type EditBundle = {
  vendor: EditableFieldConfig
  number: EditableFieldConfig
  issueDate: EditableFieldConfig
  dueDate: EditableFieldConfig
  discountDueDate: EditableFieldConfig
  discountPercent: EditableFieldConfig
  sellerAddress: EditableFieldConfig
  sellerVatId: EditableFieldConfig
  sellerTaxNumber: EditableFieldConfig
  net: EditableFieldConfig
  tax: EditableFieldConfig
  gross: EditableFieldConfig
  currency: { value: string; onChange: (v: string) => void }
}

// Vollständigkeits-Prüfung im Eingabe-Modus (Stefan 2026-08-25): bewusst NICHT
// dieselbe validateData()-Prüfung wie bei E-Rechnungen — die verlangt auch
// Rechnungsempfänger/Anschrift und Liefer-/Leistungsdatum, die bei einer
// PDF/KI-Rechnung gar nicht erfasst werden (Empfänger ist ohnehin immer der
// eigene Mandant) und sonst als dauerhaft unbehebbar "fehlend" gemeldet
// würden. Hier nur die Felder, die tatsächlich oben eingebbar sind.
// Stefan 2026-08-26: bei nackten PDFs/Scans (kein XML, keine echte
// E-Rechnung) sind USt-IdNr./Steuernummer KEINE Pflichtangabe mehr — in der
// Praxis läuft die Lieferanten-Zuordnung in der Fibu über die Kontonummer
// (siehe VendorAccount/DatevAccountsPanel.tsx), USt-IdNr./Steuernummer sind
// dafür eher Fibu-Stammdaten als ein Kriterium, das die Übergabe blockieren
// sollte. Gilt NUR hier (Nicht-E-Rechnung) — bei einer echten E-Rechnung
// (XRechnung/ZUGFeRD) bleibt validateData() in lib/erechnung.ts unverändert
// streng, da dort wirklich alle §14-UStG-Pflichtangaben vorhanden sein müssen.
function missingEditFields(edit: EditBundle): string[] {
  const missing: string[] = []
  if (!edit.vendor.value) missing.push('Rechnungssteller')
  if (!edit.number.value) missing.push('Rechnungsnummer')
  if (!edit.issueDate.value) missing.push('Rechnungsdatum')
  if (!edit.sellerAddress.value) missing.push('Anschrift des Rechnungsstellers')
  if (!edit.net.value) missing.push('Nettobetrag')
  if (!edit.tax.value) missing.push('Steuerbetrag')
  if (!edit.gross.value) missing.push('Bruttobetrag')
  return missing
}

export function ERechnungView({
  format,
  data,
  validation,
  buyerNameCheck,
  edit,
  region,
  ignore,
  directDebit,
  docId,
  receivedInfo,
  celebrate,
}: {
  format: DocFormat
  data: ParsedInvoiceData | null
  /** Eindeutige Dokumenten-ID (GoBD-Referenzierung) — neben der Überschrift statt in einer eigenen Zeile weiter unten (Stefan 2026-08-26). */
  docId?: string | null
  /** Herkunft/Eingangszeitpunkt (Stefan 2026-08-26) — vorher eigene Karte weiter unten, jetzt hier oben rechts neben der Überschrift. */
  receivedInfo?: string
  /** Belohnungs-Animation nach "Prüfen & freigeben" (Stefan 2026-08-26) — großer grüner Haken über dem Gesamtbetrag, siehe InvoiceEditForm.tsx. */
  celebrate?: boolean
  validation: Validation | null
  // Firmenbezeichnung-Abgleich (Stefan 2026-08-25) — null wenn Mandant keine
  // exakte Firmenbezeichnung hinterlegt hat oder keine Abweichung vorliegt.
  buyerNameCheck?: { invoiceId: string; expected: string; actual: string; acknowledged: boolean; locked: boolean } | null
  edit?: EditBundle
  // Inland/EU/Drittland (Stefan 2026-08-25) — bestimmt, welche Pflichtangaben-
  // Regel gilt (siehe missingEditFields/lib/erechnung.ts validateData).
  region: { effective: TaxRegion | null; onOverride: (region: string) => void; busy?: boolean }
  // "Prüfung ignorieren" (Stefan 2026-08-25) — bewusste, begründete Ausnahme,
  // ändert nur die Anzeige, keine Sperre wird dadurch aufgehoben.
  ignore: { ignored: boolean; reason: string | null; by: string | null; at: string | null; onToggle: (ignored: boolean) => void; busy?: boolean }
  // Zahlungsart (Stefan 2026-08-25) — gehört inhaltlich zur Fälligkeit oben in
  // derselben Kopfzeile (bestimmt, ob dort ein Datum oder "wird abgebucht"
  // steht), deshalb hier unten links statt in "Weitere Angaben". Workflow-
  // Feld wie Land/Ignorieren, immer editierbar, auch bei E-Rechnung.
  directDebit: { checked: boolean; onChange: (v: boolean) => void; warn?: boolean }
}) {
  const currency = data?.currency ?? 'EUR'
  const editMissing = edit ? missingEditFields(edit) : []
  const missing = edit ? editMissing : (validation?.missing ?? [])
  const isComplete = missing.length === 0
  // Überschrift außerhalb der Box (Stefan 2026-08-25, wie bei den übrigen
  // Karten) statt eines Format-Badges INNERHALB — und im Erfassungs-Fall
  // (kein XML, KI-/manuell erfasst) eine treffendere Bezeichnung als der
  // technische Format-Name, der dort ohnehin nur "PDF"/"Unbekannt" wäre.
  const heading = edit
    ? format === 'PDF' ? 'Aus PDF extrahierte Daten' : 'Aus Beleg extrahierte Daten'
    : FORMAT_LABELS[format]
  return (
    <>
      <div className="mb-1.5 flex items-start justify-between gap-2 px-1">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">{heading}</h3>
        {(docId || receivedInfo) && (
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
            {docId && (
              <span className="font-mono text-[11px] text-gray-400" title="Eindeutige Dokumenten-ID (GoBD-Referenzierung)">
                {docId}
              </span>
            )}
            {receivedInfo && <span className="text-[10px] text-gray-400">{receivedInfo}</span>}
          </div>
        )}
      </div>
      <div className="dp-card space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {ignore.ignored ? (
          <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-semibold text-gray-500"
            title={`Prüfung ignoriert von ${ignore.by ?? '?'} am ${ignore.at ? new Date(ignore.at).toLocaleString('de-DE') : '?'} — Grund: ${ignore.reason ?? '—'}`}>
            ⊘ Prüfung ignoriert
          </span>
        ) : isComplete ? (
          <span className="rounded-full bg-[var(--accent-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
            ✓ Pflichtangaben vollständig
          </span>
        ) : (
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-[var(--danger)]">
            ✗ {edit ? `${missing.length} Pflichtangabe${missing.length === 1 ? '' : 'n'} fehlt${missing.length === 1 ? '' : 'en'}` : 'Pflichtangaben unvollständig'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-400" title="Bestimmt, welche Pflichtangaben-Regel gilt — automatisch erkannt, bei Bedarf hier korrigierbar">
            Land
          </span>
          <select
            value={region.effective ?? ''}
            disabled={region.busy}
            onChange={(e) => region.onOverride(e.target.value)}
            className={`rounded-md border bg-transparent px-1.5 py-0.5 text-xs outline-none transition-colors ${
              region.effective
                ? 'border-transparent text-gray-600 hover:border-[var(--line)] focus:border-[var(--accent-soft)]'
                : 'border-[var(--warn-strong)] text-[var(--warn-strong)]'
            }`}
          >
            <option value="">{region.effective ? '— zurücksetzen —' : 'bitte wählen …'}</option>
            <option value="INLAND">{TAX_REGION_LABELS.INLAND}</option>
            <option value="EU">{TAX_REGION_LABELS.EU}</option>
            <option value="DRITTLAND">{TAX_REGION_LABELS.DRITTLAND}</option>
          </select>
        </div>
      </div>

      {!ignore.ignored && missing.length > 0 && (
        <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
          Fehlend ({edit ? '§14 UStG' : 'EN 16931-Kern / §14 UStG'}): {missing.join(', ')}
          {edit ? ' — bitte in den dezent markierten Feldern unten ergänzen.' : ' — Übergabe an die Buchhaltung erst nach Behebung möglich.'}{' '}
          <button type="button" className="underline" onClick={() => ignore.onToggle(true)} disabled={ignore.busy}>
            Prüfung ignorieren
          </button>
        </p>
      )}
      {ignore.ignored && (
        <p className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-gray-600">
          Prüfung ignoriert von {ignore.by ?? '?'} am {ignore.at ? new Date(ignore.at).toLocaleString('de-DE') : '?'} — Grund: {ignore.reason ?? '—'}{' '}
          <button type="button" className="underline" onClick={() => ignore.onToggle(false)} disabled={ignore.busy}>
            Prüfung wieder aktivieren
          </button>
        </p>
      )}

      {buyerNameCheck && (
        <BuyerNameMismatchWarning
          invoiceId={buyerNameCheck.invoiceId}
          expected={buyerNameCheck.expected}
          actual={buyerNameCheck.actual}
          acknowledged={buyerNameCheck.acknowledged}
          locked={buyerNameCheck.locked}
        />
      )}

      {data && (
        <>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {edit ? (
              <>
                <EditField label="Rechnungsnummer" config={edit.number} mono />
                <EditField label="Rechnungsdatum" type="date" config={edit.issueDate} />
                {directDebit.checked ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Fällig am</p>
                    <p className="py-0.5 text-sm text-gray-500">wird abgebucht</p>
                  </div>
                ) : (
                  <EditField label="Fällig am" type="date" config={edit.dueDate} />
                )}
                <EditField label="Skonto-Frist" type="date" config={edit.discountDueDate} />
                <EditField label="Skonto (%)" config={edit.discountPercent} />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Währung</p>
                  <select value={edit.currency.value} onChange={(e) => edit.currency.onChange(e.target.value)}
                    className="w-full border-0 border-b border-transparent bg-transparent py-0.5 text-sm text-gray-800 outline-none transition-colors hover:border-[var(--line)] focus:border-[var(--accent-soft)]">
                    <option>EUR</option><option>USD</option><option>CHF</option><option>GBP</option>
                  </select>
                </div>
                <EditField label="Rechnungssteller *" config={edit.vendor} />
                <EditField label="Anschrift Rechnungssteller" config={edit.sellerAddress} />
                <EditField label="USt-IdNr." config={edit.sellerVatId} mono />
                <EditField label="Steuernummer" config={edit.sellerTaxNumber} mono />
              </>
            ) : (
              <>
                <Field label="Rechnungsnummer" value={data.number} mono />
                <Field label="Rechnungsdatum" value={data.issueDate} />
                <Field label="Fällig am" value={data.dueDate} />
                {data.deliveryDate ? (
                  <Field label="Liefer-/Leistungsdatum" value={data.deliveryDate} />
                ) : data.deliveryPeriodStart && data.deliveryPeriodEnd ? (
                  <Field label="Abrechnungszeitraum" value={`${data.deliveryPeriodStart} – ${data.deliveryPeriodEnd}`} />
                ) : (
                  <Field label="Liefer-/Leistungsdatum" value={null} />
                )}
                <Field label="Währung" value={data.currency} />
                <Field label="Rechnungssteller" value={data.sellerName} />
                <Field label="Anschrift Rechnungssteller" value={data.sellerAddress} />
                <Field label="USt-IdNr." value={data.sellerVatId} mono />
                <Field label="Steuernummer" value={data.sellerTaxNumber} mono />
              </>
            )}
            <Field label="Rechnungsempfänger" value={data.buyerName} />
            <Field label="Anschrift Rechnungsempfänger" value={data.buyerAddress} />
          </div>

          {data.lines.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="dp-tr">
                  <th className="dp-th">Position</th>
                  <th className="dp-th">Menge</th>
                  <th className="dp-th text-right">Rabatt</th>
                  <th className="dp-th text-right">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={i} className="dp-tr">
                    <td className="dp-td">{l.name}</td>
                    <td className="dp-td text-xs">{l.quantity ?? '—'}</td>
                    <td className="dp-td text-right text-xs">{l.discount ? `− ${formatAmount(l.discount, currency)}` : '—'}</td>
                    <td className="dp-td text-right">{formatAmount(l.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="flex items-center gap-2 text-xs text-gray-600"
            title="Zahlungsart ist keine steuerlich relevante Angabe der Rechnung — immer frei änderbar">
            <input type="checkbox" checked={directDebit.checked} onChange={(e) => directDebit.onChange(e.target.checked)} />
            Lieferant bucht per Lastschrift/Abbuchung selbst ab (statt Überweisung)
            {directDebit.warn && <span className="text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>}
          </label>
          <div className="relative max-w-xs space-y-1 text-sm">
            {/* Belohnungs-Animation nach "Prüfen & freigeben" (Stefan
                2026-08-26) — großer, transparenter grüner Haken über dem
                Gesamtbetrag, klingt von selbst wieder ab (siehe
                InvoiceEditForm.tsx celebrate()/showPrimarySuccess). */}
            {celebrate && (
              <span
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-7xl text-emerald-500/60 animate-celebrate-check"
                aria-hidden="true">
                ✓
              </span>
            )}
            {data.documentAllowance !== null && (
              <Total label="Rabatt (Rechnungsebene)" value={`− ${formatAmount(data.documentAllowance, currency)}`} />
            )}
            {edit ? (
              <>
                <EditTotal label="Netto" config={edit.net} />
                <EditTotal label="Steuer" config={edit.tax} />
                <div className="border-t border-[var(--line)] pt-1">
                  <EditTotal label="Brutto" config={edit.gross} strong />
                </div>
              </>
            ) : (
              <>
                <Total label="Netto" value={formatAmount(data.net, currency)} />
                {data.taxRates.length > 0 ? (
                  data.taxRates.map((t, i) => (
                    <Total
                      key={i}
                      label={`Umsatzsteuer${t.ratePercent !== null ? ` (${t.ratePercent}%)` : ''}`}
                      value={formatAmount(t.taxAmount, currency)}
                    />
                  ))
                ) : (
                  <Total label="Umsatzsteuer" value={formatAmount(data.tax, currency)} />
                )}
                <div className="border-t border-[var(--line)] pt-1">
                  <Total label="Gesamtbetrag" value={formatAmount(data.gross, currency)} strong />
                </div>
              </>
            )}
          </div>
          </div>

          {/* Steuerbefreiungs-Hinweis (Stefan 2026-08-25, §14 Abs. 4 Nr. 8
              UStG) — Pflichtangabe bei 0 % Steuersatz, z. B. Drittland-
              Ausfuhrlieferung oder innergemeinschaftliche Lieferung. */}
          {data.taxRates.filter((t) => t.exemptionReason).map((t, i) => (
            <p key={i} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">Steuerbefreiung{t.categoryCode ? ` (${t.categoryCode})` : ''}:</span>{' '}
              {t.exemptionReason}
            </p>
          ))}

          {!edit && data.discountDueDate && (
            <p className="rounded-lg bg-[var(--accent-bg)] px-3 py-2 text-xs text-[var(--accent)]">
              💰 Skonto: {data.discountPercent !== null ? `${data.discountPercent}% ` : ''}
              bei Zahlung bis {data.discountDueDate} (statt Fälligkeit {data.dueDate ?? '—'} netto)
            </p>
          )}
          {data.paymentTerms && (
            <p className="text-xs text-gray-500">
              <span className="font-semibold text-gray-600">Zahlungsbedingungen:</span> {data.paymentTerms}
            </p>
          )}
        </>
      )}
      </div>
    </>
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

// Direkte Eingabe statt reiner Anzeige (Stefan 2026-08-25) — dezenter als der
// Kasten/Rahmen im übrigen Formular, aber klar erkennbar: ein kleiner Punkt
// vor dem Label markiert leer (amber) vs. ausgefüllt (grün-gedämpft), dazu
// ein dünner durchgezogener Rahmen bei leeren Pflichtfeldern (KEINE
// gepunktete Linie — die wirkte unruhig/unschön). Ist ein Wert eingetragen,
// verschwindet der Rahmen bis auf Hover/Fokus wieder fast vollständig — sieht
// dann fast wie die reine Anzeige oben aus.
function editInputClass(blocking: boolean, extra = '') {
  return `w-full rounded-md border bg-transparent px-1.5 py-0.5 text-sm outline-none transition-colors ${extra} ${
    blocking
      ? 'border-[var(--warn-strong)] text-[var(--warn-strong)] placeholder:text-[var(--warn-strong)]/80'
      : 'border-transparent text-gray-800 hover:border-[var(--line)] focus:border-[var(--accent-soft)] placeholder:text-gray-300'
  }`
}

// empty = kein Wert, blocking = leer UND eine echte Pflichtangabe (fehlt
// dann tatsächlich in der "N Pflichtangaben fehlen"-Zählung oben) — z. B.
// Skonto ist leer aber NICHT blocking, bekommt deshalb einen neutralen
// grauen statt amber Punkt (Stefan 2026-08-25, sonst sieht ein optionales
// Feld genauso dringend aus wie eine echte Pflichtangabe).
// Stefan 2026-08-26: echte Mini-Icons statt reiner Farbpunkte vor jedem
// Feldnamen — ausgefüllt = grüner Haken, fehlende Pflichtangabe = rotes X,
// leer-aber-optional bleibt ein neutraler grauer Punkt (keine echte Lücke).
function FieldDot({ empty, blocking }: { empty: boolean; blocking: boolean }) {
  if (!empty) {
    return (
      <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-[9px] font-bold leading-none text-emerald-600"
        title="Ausgefüllt">
        ✓
      </span>
    )
  }
  if (blocking) {
    return (
      <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-[9px] font-bold leading-none text-[var(--danger)]"
        title="Noch nicht ausgefüllt — Pflichtangabe">
        ✗
      </span>
    )
  }
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" title="Noch nicht ausgefüllt (optional)" />
}

function EditField({
  label, config, type = 'text', mono,
}: {
  label: string; config: EditableFieldConfig; type?: string; mono?: boolean
}) {
  const empty = !config.value
  const blocking = empty && !config.optional
  const rs = config.reviewStatus ? REVIEW_STATUS_ICON[config.reviewStatus] : null
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        <FieldDot empty={empty} blocking={blocking} />
        {label}
        {config.warn && <span className="text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>}
        {rs && <span className={rs.className} title={rs.title}>{rs.icon}</span>}
      </p>
      <input
        type={type}
        value={config.value}
        required={config.required}
        onChange={(e) => config.onChange(e.target.value)}
        onKeyDown={config.onKeyDown}
        placeholder="ergänzen …"
        className={editInputClass(blocking, mono ? 'font-mono' : '')}
      />
    </div>
  )
}

function EditTotal({ label, config, strong }: { label: string; config: EditableFieldConfig; strong?: boolean }) {
  const empty = !config.value
  const blocking = empty && !config.optional
  return (
    <div className={`flex items-center justify-between gap-2 ${strong ? 'font-semibold text-[var(--accent)]' : 'text-gray-700'}`}>
      <span className="flex items-center gap-1.5">
        <FieldDot empty={empty} blocking={blocking} />
        {label}
      </span>
      <input
        value={config.value}
        onChange={(e) => config.onChange(e.target.value)}
        onKeyDown={config.onKeyDown}
        placeholder="ergänzen …"
        className={editInputClass(blocking, 'w-28 text-right')}
      />
    </div>
  )
}
