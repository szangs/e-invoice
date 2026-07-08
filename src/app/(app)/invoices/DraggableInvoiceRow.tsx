'use client'

// Dünner Client-Wrapper NUR für die Drag-Quelle (Stefan 2026-07-08:
// Rechnungen per Ziehen auf einen Korb verschieben). Die eigentlichen
// Tabellenzellen kommen fertig gerendert von der Server-Komponente als
// children herein — Next.js erlaubt das (children sind bereits gerendert,
// müssen nicht selbst client-seitig sein).
export function DraggableInvoiceRow({
  invoiceId,
  className,
  disabled,
  children,
}: {
  invoiceId: string
  className?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  if (disabled) return <tr className={className}>{children}</tr>
  return (
    <tr
      className={className}
      draggable
      title="Zum Verschieben auf einen Korb oben ziehen"
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-invoice-id', invoiceId)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {children}
    </tr>
  )
}
