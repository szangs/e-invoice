// Rechnung bearbeiten / löschen — Mandantentrennung an der Quelle (§22)
import { NextRequest, NextResponse } from 'next/server'
import { InvoiceStatus } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { toDTO } from '@/lib/invoices'

const schema = z.object({
  vendor: z.string().min(1).optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  amountNet: z.number().nullable().optional(),
  amountTax: z.number().nullable().optional(),
  amountGross: z.number().nullable().optional(),
  currency: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  tags: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Dubletten-Kennzeichnung aufheben ("keine Dublette")
  duplicateOfId: z.null().optional(),
  // Wird gesetzt, wenn beim Speichern zuvor "Mit KI erkennen" genutzt wurde
  aiAssisted: z.boolean().optional(),
  // Zahlungsart
  directDebitByVendor: z.boolean().optional(),
  // Rechnungsprüfung (4-Augen-Workflow) — Absicht als Boolean, Server setzt
  // wer/wann (siehe unten), Client kann sich nicht als jemand anderen ausgeben
  checkElectronic: z.boolean().optional(),
  checkFormal: z.boolean().optional(),
  checkSubstantive: z.boolean().optional(),
  checkAccounting: z.boolean().optional(),
  // Wiederherstellen einer weich gelöschten Rechnung (siehe DELETE-Handler)
  restore: z.literal(true).optional(),
})

const CHECK_MAP = {
  checkElectronic: ['checkElectronicAt', 'checkElectronicBy'],
  checkFormal: ['checkFormalAt', 'checkFormalBy'],
  checkSubstantive: ['checkSubstantiveAt', 'checkSubstantiveBy'],
  checkAccounting: ['checkAccountingAt', 'checkAccountingBy'],
} as const

async function findOwn(id: string, tenantId: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId } })
  if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden')
  return invoice
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const existing = await findOwn(params.id, tenantId)
    const { checkElectronic, checkFormal, checkSubstantive, checkAccounting, restore, ...data } =
      schema.parse(await req.json())

    // Weich gelöschte Rechnung: nur die Wiederherstellung ist erlaubt, keine
    // sonstigen Änderungen (verhindert versehentliches Weiterbearbeiten).
    if (existing.deletedAt && !restore) {
      throw new ApiError(409, 'Rechnung ist gelöscht — bitte zuerst wiederherstellen.')
    }

    // Prüfschritte: Server stempelt wer (angemeldeter Nutzer) + wann; ein
    // "false" hebt die Prüfung wieder auf (beide Felder zurück auf null)
    const checkData: Record<string, Date | string | null> = {}
    const intents = { checkElectronic, checkFormal, checkSubstantive, checkAccounting }
    for (const [key, atField, byField] of Object.entries(CHECK_MAP).map(([k, [a, b]]) => [k, a, b] as const)) {
      const intent = intents[key as keyof typeof intents]
      if (intent === undefined) continue
      checkData[atField] = intent ? new Date() : null
      checkData[byField] = intent ? ctx.email : null
    }

    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        ...data,
        ...checkData,
        ...(restore ? { deletedAt: null, deletedBy: null } : {}),
        invoiceDate: data.invoiceDate === undefined ? undefined : data.invoiceDate ? new Date(data.invoiceDate) : null,
        dueDate: data.dueDate === undefined ? undefined : data.dueDate ? new Date(data.dueDate) : null,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: restore ? 'INVOICE_RESTORE' : 'INVOICE_UPDATE',
      details: restore
        ? `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id} wiederhergestellt`
        : `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id} geändert`,
    })
    return NextResponse.json({ invoice: toDTO(invoice) })
  } catch (e) {
    return jsonError(e)
  }
}

// Löschen markiert nur (deletedAt/deletedBy) — kein echtes Entfernen. GoBD
// verlangt Nachvollziehbarkeit; Beleg-Datei und Datensatz bleiben erhalten
// und lassen sich per PATCH { restore: true } wiederherstellen.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const existing = await findOwn(params.id, tenantId)
    const invoice = await prisma.invoice.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedBy: ctx.email },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_DELETE',
      details: `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id} als gelöscht markiert`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
