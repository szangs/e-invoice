// Gemeinsame Helfer für das Rechnungsmodul
import { Invoice, InvoiceStatus } from '@prisma/client'

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  NEW: 'Neu',
  CHECKED: 'Geprüft',
  EXPORTED: 'Exportiert',
  REJECTED: 'Abgelehnt',
}

export type InvoiceDTO = {
  id: string
  vendor: string
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  amountNet: number | null
  amountTax: number | null
  amountGross: number | null
  currency: string
  status: InvoiceStatus
  tags: string | null
  notes: string | null
  originalName: string | null
  hasFile: boolean
  encrypted: boolean
  origMime: string | null
  mimeType: string | null
  duplicateOfId: string | null
  createdAt: string
}

export function toDTO(inv: Invoice): InvoiceDTO {
  return {
    id: inv.id,
    vendor: inv.vendor,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10) : null,
    dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
    amountNet: inv.amountNet ? Number(inv.amountNet) : null,
    amountTax: inv.amountTax ? Number(inv.amountTax) : null,
    amountGross: inv.amountGross ? Number(inv.amountGross) : null,
    currency: inv.currency,
    status: inv.status,
    tags: inv.tags,
    notes: inv.notes,
    originalName: inv.originalName,
    hasFile: Boolean(inv.fileName),
    encrypted: inv.encrypted,
    origMime: inv.encOrigMime,
    mimeType: inv.mimeType,
    duplicateOfId: inv.duplicateOfId,
    createdAt: inv.createdAt.toISOString(),
  }
}

export function formatAmount(v: number | null, currency: string): string {
  if (v === null) return '—'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(v)
}
