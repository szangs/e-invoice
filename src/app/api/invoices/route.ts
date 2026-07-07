// Rechnungen: Anlegen (multipart mit optionalem Beleg) — mandantengetrennt (§22)
import { NextRequest, NextResponse } from 'next/server'
import { InvoiceStatus } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { analyzeInvoiceFile, type Analysis } from '@/lib/erechnung'
import { toDTO } from '@/lib/invoices'
import { ALLOWED_MIME, MAX_FILE_BYTES, saveInvoiceFile } from '@/lib/storage'

const fieldsSchema = z.object({
  vendor: z.string().min(1, 'Lieferant fehlt'),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  amountNet: z.string().optional(),
  amountTax: z.string().optional(),
  amountGross: z.string().optional(),
  currency: z.string().default('EUR'),
  tags: z.string().optional(),
  notes: z.string().optional(),
  // Zero-Knowledge: "1" = Datei wurde bereits im Browser verschlüsselt
  encrypted: z.string().optional(),
  encOrigMime: z.string().optional(),
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
    }
    const d = analysis?.data

    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        vendor: fields.vendor || d?.sellerName || 'Unbekannt',
        invoiceNumber: fields.invoiceNumber || d?.number || null,
        invoiceDate: fields.invoiceDate
          ? new Date(fields.invoiceDate)
          : d?.issueDate
            ? new Date(d.issueDate)
            : null,
        dueDate: fields.dueDate ? new Date(fields.dueDate) : d?.dueDate ? new Date(d.dueDate) : null,
        amountNet: parseAmount(fields.amountNet) ?? d?.net ?? null,
        amountTax: parseAmount(fields.amountTax) ?? d?.tax ?? null,
        amountGross: parseAmount(fields.amountGross) ?? d?.gross ?? null,
        currency: fields.currency || 'EUR',
        status: InvoiceStatus.NEW,
        tags: fields.tags || null,
        notes: fields.notes || null,
        fileName,
        originalName,
        mimeType,
        encrypted: isEncrypted && Boolean(fileName),
        encOrigMime: isEncrypted ? fields.encOrigMime || null : null,
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
