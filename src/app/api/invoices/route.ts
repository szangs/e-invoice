// Rechnungen: Anlegen (multipart mit optionalem Beleg) — mandantengetrennt (§22)
import { NextRequest, NextResponse } from 'next/server'
import { InvoiceStatus } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getInboxBasketId } from '@/lib/baskets'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { nextDocId } from '@/lib/docId'
import { detectDuplicate, hashBuffer } from '@/lib/duplicates'
import { analyzeInvoiceFile, EINVOICE_FORMATS, type Analysis } from '@/lib/erechnung'
import { CONTENT_ENC_VENDOR_PLACEHOLDER, toDTO } from '@/lib/invoices'
import { ALLOWED_MIME, MAX_FILE_BYTES, saveInvoiceFile } from '@/lib/storage'

// Inhalts-Verschlüsselung (Stefan 2026-07-09): ist contentEnc gesetzt, hat der
// Browser Lieferant/Nummer/Beträge/Währung/Tags/Notizen bereits zu einem
// einzigen Chiffrat zusammengefasst (siehe /invoices/new) — die einzelnen
// Klartext-Felder unten werden dann NICHT verwendet (vendor bleibt daher hier
// optional, ein fester Platzhalter füllt die NOT-NULL-Spalte).
const VENDOR_PLACEHOLDER = CONTENT_ENC_VENDOR_PLACEHOLDER

const fieldsSchema = z.object({
  vendor: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  amountNet: z.string().optional(),
  amountTax: z.string().optional(),
  amountGross: z.string().optional(),
  currency: z.string().default('EUR'),
  tags: z.string().optional(),
  notes: z.string().optional(),
  // Inhalts-Verschlüsselung: Base64-Chiffrat (IV+Ciphertext) eines JSON-Blobs
  // mit den Inhaltsfeldern — siehe clientCrypto.ts encryptJson.
  contentEnc: z.string().optional(),
  // Zero-Knowledge: "1" = Datei wurde bereits im Browser verschlüsselt
  encrypted: z.string().optional(),
  encOrigMime: z.string().optional(),
  // Bei verschlüsseltem Upload: SHA-256 des KLARTEXTS, im Browser VOR dem
  // Verschlüsseln gebildet (siehe lib/clientCrypto.ts sha256Hex) — für die
  // Dubletten-Erkennung. Wird bei unverschlüsseltem Upload ignoriert
  // (Server berechnet dort selbst, siehe unten).
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  // Herkunft/Erfassungsart — nur diese beiden client-seitig erlaubt (EMAIL/
  // EXTENSION/RESTORE sind serverseitig gesetzte Herkünfte, nicht spoofbar)
  source: z.enum(['UPLOAD', 'SCAN']).default('UPLOAD'),
  aiAssisted: z.string().optional(),
  directDebitByVendor: z.string().optional(),
}).refine((f) => Boolean(f.contentEnc) || Boolean(f.vendor?.trim()), {
  message: 'Lieferant fehlt', path: ['vendor'],
})

function parseAmount(v?: string): number | null {
  if (!v) return null
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const form = await req.formData()
    const fields = fieldsSchema.parse(Object.fromEntries(
      Array.from(form.entries()).filter(([, v]) => typeof v === 'string'),
    ))

    const isEncrypted = fields.encrypted === '1'
    let fileName: string | null = null
    let originalName: string | null = null
    let mimeType: string | null = null
    let analysis: Analysis | null = null
    let fileHash: string | null = null
    const file = form.get('file')
    if (file instanceof File && file.size > 0) {
      // Verschlüsselte Belege kommen als Chiffrat (octet-stream) — Server kann und
      // soll den Inhalt nicht prüfen können (Zero-Knowledge).
      if (!isEncrypted && !ALLOWED_MIME.includes(file.type)) {
        throw new ApiError(400, 'Nur PDF, PNG, JPG oder WebP erlaubt.')
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new ApiError(400, 'Datei zu groß (max. 10 MB).')
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      fileName = await saveInvoiceFile(tenantId, file.name, buffer)
      originalName = file.name.replace(/\.enc$/, '')
      mimeType = isEncrypted ? 'application/octet-stream' : file.type
      // E-Rechnung (W17): nur bei unverschlüsselten Dateien analysierbar
      if (!isEncrypted) {
        analysis = await analyzeInvoiceFile(buffer, file.type, file.name)
      }
      // Dubletten-Hash: bei Verschlüsselung NICHT über das Chiffrat bilden (AES-GCM
      // nutzt pro Verschlüsselung ein zufälliges IV — derselbe Klartext ergäbe bei
      // jedem Upload ein anderes Chiffrat und damit nie einen Treffer). Stattdessen
      // den vom Browser mitgeschickten Klartext-Hash übernehmen.
      fileHash = isEncrypted ? (fields.fileHash ?? null) : hashBuffer(buffer)
    }
    const d = analysis?.data
    // Steuerlich relevante Felder aus einer ZUGFeRD/XRechnung sind das
    // rechtsverbindliche Original — die client-seitige Sperre (siehe
    // /invoices/new) verhindert das Bearbeiten in der UI schon vor dem
    // Speichern, aber ohne serverseitige Durchsetzung könnte ein direkter
    // API-Aufruf sie trotzdem überschreiben (Stefan 2026-07-08: dieselbe
    // GoBD-Sperre wie beim späteren Bearbeiten in InvoiceEditForm/PATCH
    // muss schon beim ersten Einlesen gelten, nicht erst danach).
    const isEInvoiceUpload = Boolean(analysis && (EINVOICE_FORMATS as string[]).includes(analysis.format))
    const hasEncryptedContent = Boolean(fields.contentEnc)
    // Bei verschlüsseltem Inhalt trägt jede Rechnung denselben Platzhalter als
    // vendor-Spalte (Server kennt den echten Lieferanten nicht) — ein Abgleich
    // "gleicher Lieferant + gleiche Nummer" würde sonst ständig fälschlich
    // anschlagen. Die Dubletten-Prüfung stützt sich dann nur noch auf den
    // Datei-Hash (fileHash, s. o. — wird vor dem Verschlüsseln gebildet).
    const duplicateOfId = await detectDuplicate(tenantId, {
      fileHash,
      invoiceNumber: hasEncryptedContent ? null : (fields.invoiceNumber || d?.number || null),
      vendor: hasEncryptedContent ? null : (fields.vendor || d?.sellerName || null),
    })

    const docId = await nextDocId(tenantId)
    // Neue Rechnungen starten immer im Eingangskorb (Körbe-Workflow, Stefan
    // 2026-07-08) — von dort aus werden sie manuell in andere Körbe verschoben.
    const basketId = await getInboxBasketId(tenantId)
    // Elektronische Vorprüfung automatisch abhaken, wenn die E-Rechnung
    // (ZUGFeRD/XRechnung) beim Einlesen bereits als formal gültig erkannt
    // wurde — Stefan 2026-07-07: soll nicht erst manuell gesetzt werden
    // müssen, wenn die Maschine es ohnehin schon geprüft hat.
    const autoElectronicOk = analysis?.validation?.valid === true
    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        docId,
        basketId,
        checkElectronicAt: autoElectronicOk ? new Date() : null,
        checkElectronicBy: autoElectronicOk ? 'System (automatische Prüfung)' : null,
        vendor: hasEncryptedContent
          ? VENDOR_PLACEHOLDER
          : isEInvoiceUpload ? (d?.sellerName || 'Unbekannt') : (fields.vendor || d?.sellerName || 'Unbekannt'),
        invoiceNumber: hasEncryptedContent
          ? null
          : isEInvoiceUpload ? (d?.number || null) : (fields.invoiceNumber || d?.number || null),
        // Rechnungs-/Fälligkeitsdatum bleiben bewusst im Klartext (Workflow-
        // Felder — Sortierung, Fälligkeits-Erinnerungen, Körbe-Zähler).
        invoiceDate: isEInvoiceUpload
          ? (d?.issueDate ? new Date(d.issueDate) : null)
          : fields.invoiceDate
            ? new Date(fields.invoiceDate)
            : d?.issueDate
              ? new Date(d.issueDate)
              : null,
        dueDate: isEInvoiceUpload
          ? (d?.dueDate ? new Date(d.dueDate) : null)
          : fields.dueDate ? new Date(fields.dueDate) : d?.dueDate ? new Date(d.dueDate) : null,
        amountNet: hasEncryptedContent ? null : isEInvoiceUpload ? (d?.net ?? null) : (parseAmount(fields.amountNet) ?? d?.net ?? null),
        amountTax: hasEncryptedContent ? null : isEInvoiceUpload ? (d?.tax ?? null) : (parseAmount(fields.amountTax) ?? d?.tax ?? null),
        amountGross: hasEncryptedContent ? null : isEInvoiceUpload ? (d?.gross ?? null) : (parseAmount(fields.amountGross) ?? d?.gross ?? null),
        currency: hasEncryptedContent ? 'EUR' : isEInvoiceUpload ? (d?.currency || 'EUR') : (fields.currency || 'EUR'),
        contentEnc: fields.contentEnc ?? null,
        status: InvoiceStatus.NEW,
        tags: hasEncryptedContent ? null : (fields.tags || null),
        notes: hasEncryptedContent ? null : (fields.notes || null),
        fileName,
        originalName,
        mimeType,
        encrypted: isEncrypted && Boolean(fileName),
        encOrigMime: isEncrypted ? fields.encOrigMime || null : null,
        fileHash,
        duplicateOfId,
        source: fields.source,
        aiAssisted: fields.aiAssisted === '1',
        directDebitByVendor: fields.directDebitByVendor === '1',
        docFormat: analysis?.format ?? null,
        xmlData: analysis?.xml ?? null,
        validationOk: analysis?.validation?.valid ?? null,
        validationIssues: analysis?.validation?.missing.join(', ') || null,
        createdById: ctx.userId,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_CREATE',
      details: `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? ''} erfasst`,
    })
    return NextResponse.json({ invoice: toDTO(invoice) })
  } catch (e) {
    return jsonError(e)
  }
}
