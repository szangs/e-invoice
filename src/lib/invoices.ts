// Gemeinsame Helfer für das Rechnungsmodul
import { Invoice, InvoiceStatus } from '@prisma/client'

// Inhalts-Verschlüsselung (Stefan 2026-07-09): fester Platzhalter für die
// NOT-NULL-Spalte vendor, wenn der echte Lieferant nur noch verschlüsselt in
// contentEnc steckt — an einer Stelle definiert, da sowohl die Anlage- als
// auch die Bearbeiten-Route ihn brauchen (siehe api/invoices/route.ts und
// api/invoices/[id]/route.ts).
export const CONTENT_ENC_VENDOR_PLACEHOLDER = '🔒 Verschlüsselt'

// Positionszeilen aus der KI-Erkennung (Stefan 2026-08-25) — nur bei nackten
// PDFs/Scans gesetzt, siehe Invoice.lineItems in schema.prisma.
export type InvoiceLineItem = { name: string; qty: string | null; unitPrice: number | null; total: number | null }

function parseLineItems(v: unknown): InvoiceLineItem[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return v
    .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
    .map((l) => ({
      name: typeof l.name === 'string' ? l.name : '(ohne Bezeichnung)',
      qty: typeof l.qty === 'string' ? l.qty : null,
      unitPrice: typeof l.unitPrice === 'number' ? l.unitPrice : null,
      total: typeof l.total === 'number' ? l.total : null,
    }))
}

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
  // Skonto (Stefan 2026-08-25) — siehe Invoice.discountDueDate/-Percent in schema.prisma.
  discountDueDate: string | null
  discountPercent: number | null
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
  validationOk: boolean | null
  validationIssues: string | null
  duplicateOfId: string | null
  source: string
  aiAssisted: boolean
  aiConfirmedAt: string | null
  aiConfirmedBy: string | null
  aiUncertainFields: string | null
  // Spam-/Nicht-Rechnung-Klassifikation beim Mail-Eingang (lib/mailin.ts) —
  // 'INVOICE' | 'UNCERTAIN' | 'NOT_INVOICE', null bei Scan/manuellem Upload.
  invoiceClass: string | null
  // Beleg-PDF wurde aus dem HTML-Mailtext gerendert, kein Original-PDF vom
  // Lieferanten (lib/htmlToPdf.ts) — Kennzeichnung in der "Inhalt"-Spalte.
  htmlRendered: boolean
  // Mailtext, der zusammen mit dem Beleg ankam (lib/mailin.ts) — nur beim Mail-Eingang gesetzt.
  mailBodyText: string | null
  // Positionszeilen aus der KI-Erkennung (nur nackte PDFs/Scans, siehe oben) — null wenn keine gesetzt.
  lineItems: InvoiceLineItem[] | null
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
  basketId: string | null
  // Kostenstellen/Kostenträger (Stefan 2026-07-09, #114) — immer Klartext,
  // auch bei aktiver Inhalts-Verschlüsselung (Workflow-Feld, siehe Schema).
  costCenterCode: string | null
  costCarrierCode: string | null
  // Inhalts-Verschlüsselung (Stefan 2026-07-09): gesetzt = vendor/invoice
  // Number/amount*/currency/tags/notes oben sind nur Platzhalter/leer, der
  // echte Inhalt steckt hier drin (AES-GCM, Base64) und muss client-seitig
  // entschlüsselt werden — siehe components/crypto/useDecryptedContent.ts.
  contentEnc: string | null
}

export function toDTO(inv: Invoice): InvoiceDTO {
  return {
    id: inv.id,
    docId: inv.docId,
    vendor: inv.vendor,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10) : null,
    dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
    discountDueDate: inv.discountDueDate ? inv.discountDueDate.toISOString().slice(0, 10) : null,
    discountPercent: inv.discountPercent ? Number(inv.discountPercent) : null,
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
    validationOk: inv.validationOk,
    validationIssues: inv.validationIssues,
    duplicateOfId: inv.duplicateOfId,
    source: inv.source,
    aiAssisted: inv.aiAssisted,
    aiConfirmedAt: inv.aiConfirmedAt ? inv.aiConfirmedAt.toISOString() : null,
    aiConfirmedBy: inv.aiConfirmedBy,
    aiUncertainFields: inv.aiUncertainFields,
    invoiceClass: inv.invoiceClass,
    htmlRendered: inv.htmlRendered,
    mailBodyText: inv.mailBodyText,
    lineItems: parseLineItems(inv.lineItems),
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
    basketId: inv.basketId,
    costCenterCode: inv.costCenterCode,
    costCarrierCode: inv.costCarrierCode,
    contentEnc: inv.contentEnc,
  }
}

export function formatAmount(v: number | null, currency: string): string {
  if (v === null) return '—'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(v)
}
