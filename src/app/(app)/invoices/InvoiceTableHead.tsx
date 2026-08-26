'use client'

import Link from 'next/link'
import { SelectAllCheckbox } from './InvoiceSelection'
import { useColumnVisibility } from './columnVisibility'

export type SortColumn = { label: string; href: string; arrow: string }

function SortTh({ col }: { col: SortColumn }) {
  return (
    <th className="dp-th">
      <Link href={col.href} className="hover:text-[var(--accent)]" title={`Nach ${col.label} sortieren`}>
        {col.label}{col.arrow}
      </Link>
    </th>
  )
}

export function InvoiceTableHead({
  showTrash, invoiceIds, sorts,
}: {
  showTrash: boolean
  invoiceIds: string[]
  sorts: Record<
    'docId' | 'vendor' | 'invoiceNumber' | 'invoiceDate' | 'dueDate' | 'createdAt' | 'amountNet' | 'amountGross' | 'status',
    SortColumn
  >
}) {
  const { visible } = useColumnVisibility()
  return (
    <thead>
      <tr className="dp-tr">
        {!showTrash && (
          <th className="dp-th w-8">
            <SelectAllCheckbox ids={invoiceIds} />
          </th>
        )}
        <SortTh col={sorts.docId} />
        <SortTh col={sorts.vendor} />
        {visible.invoiceNumber && <SortTh col={sorts.invoiceNumber} />}
        {visible.invoiceDate && <SortTh col={sorts.invoiceDate} />}
        {visible.dueDate && <SortTh col={sorts.dueDate} />}
        {visible.createdAt && <SortTh col={sorts.createdAt} />}
        {visible.amountNet && <SortTh col={sorts.amountNet} />}
        <SortTh col={sorts.amountGross} />
        <SortTh col={sorts.status} />
        {visible.docFormat && (
          <th className="dp-th" title="Beleg-Format und Erfassungsart (elektronisch/Scan, KI/manuell)">Inhalt</th>
        )}
        {!showTrash && visible.mailBodyText && (
          <th className="dp-th" title="Kurzer Auszug aus dem Mailtext, mit dem der Beleg eintraf — nur zur groben Einschätzung, volle Ansicht auf der Detailseite">
            Mailtext
          </th>
        )}
        {!showTrash && visible.thumbnail && (
          <th className="dp-th" title="Vorschau des Belegs — zum Vergrößern mit der Maus darüberfahren">Vorschau</th>
        )}
        {!showTrash && visible.checks && (
          <th className="dp-th" title="Prüfkette: E = Elektronische Vorprüfung, F = Formal richtig, S = Sachlich richtig (klickbar), B = An Buchhaltung übergeben (klickbar)">
            <span className="block">Prüfung</span>
            <span className="mt-0.5 block text-[9px] font-normal normal-case tracking-[0.2em] text-gray-400">E · F · S · B</span>
          </th>
        )}
        <th className="dp-th">Beleg</th>
        <th className="dp-th">Aktion</th>
      </tr>
    </thead>
  )
}
