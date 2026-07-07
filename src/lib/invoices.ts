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
  docId: string | null
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
  docFormat: string | null
  duplicateOfId: string | null
  source: string
  aiAssisted: boolean
  directDebitByVendor: boolean
  checkElectronicAt: string | null
  checkElectronicBy: string | null
  checkFormalAt: string | null
  checkFormalBy: string | null
  checkSubstantiveAt: string | null
  checkSubstantiveBy: string | null
  checkAccountingAt: string | null
  checkAccountingBy: string | null
  deletedAt: string | null
  deletedBy: string | null
  createdAt: string
}

export function toDTO(inv: Invoice): InvoiceDTO {
  return {
    id: inv.id,
    docId: inv.docId,
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
    docFormat: inv.docFormat,
    duplicateOfId: inv.duplicateOfId,
    source: inv.source,
    aiAssisted: inv.aiAssisted,
    directDebitByVendor: inv.directDebitByVendor,
    checkElectronicAt: inv.checkElectronicAt ? inv.checkElectronicAt.toISOString() : null,
    checkElectronicBy: inv.checkElectronicBy,
    checkFormalAt: inv.checkFormalAt ? inv.checkFormalAt.toISOString() : null,
    checkFormalBy: inv.checkFormalBy,
    checkSubstantiveAt: inv.checkSubstantiveAt ? inv.checkSubstantiveAt.toISOString() : null,
    checkSubstantiveBy: inv.checkSubstantiveBy,
    checkAccountingAt: inv.checkAccountingAt ? inv.checkAccountingAt.toISOString() : null,
    checkAccountingBy: inv.checkAccountingBy,
    deletedAt: inv.deletedAt ? inv.deletedAt.toISOString() : null,
    deletedBy: inv.deletedBy,
    createdAt: inv.createdAt.toISOString(),
  }
}

export function formatAmount(v: number | null, currency: string): string {
  if (v === null) return '—'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(v)
}
