// Einlieferung durch den Rechnungs-Catcher (Browser-Extension).
// Auth: API-Token (Bearer). GET liefert Mandanten-/Verschlüsselungs-Konfiguration,
// POST nimmt die gefangene Datei entgegen — bei aktiver Verschlüsselung NUR Chiffrat.
import { NextRequest, NextResponse } from 'next/server'
import { InvoiceStatus } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { resolveToken } from '@/lib/apiToken'
import { audit } from '@/lib/audit'
import { ensureSystemBaskets } from '@/lib/baskets'
import { ApiError } from '@/lib/context'
import { prisma } from '@/lib/db'
import { nextDocId } from '@/lib/docId'
import { detectDuplicate, hashBuffer, resolveDuplicateOrVersion, supersedeOlderVersions } from '@/lib/duplicates'
import { analyzeInvoiceFile, autoElectronicCheck, autoFormalCheckForEInvoice, type Analysis } from '@/lib/erechnung'
import { scheduleKositCheck } from '@/lib/kositValidator'
import { hasFeature } from '@/lib/license'
import { ALLOWED_MIME, MAX_FILE_BYTES, saveInvoiceFile } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const token = await resolveToken(req)
    return NextResponse.json({
      tenantName: token.tenant.name,
      encryption: {
        enabled: token.tenant.encryptionEnabled,
        salt: token.tenant.encSalt,
        wrappedDek: token.tenant.encWrappedDek,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = await resolveToken(req)
    const tenant = token.tenant
    if (!hasFeature(tenant, 'CATCHER')) {
      throw new ApiError(403, 'Der Rechnungs-Catcher ist im aktuellen Tarif nicht (mehr) enthalten.')
    }
    const form = await req.formData()

    const sourceUrl = String(form.get('sourceUrl') ?? '')
    const isEncrypted = String(form.get('encrypted') ?? '') === '1'
    const encOrigMime = String(form.get('encOrigMime') ?? '') || null
    const filename = String(form.get('filename') ?? 'beleg.pdf')

    // Zero-Knowledge serverseitig erzwingen: Mandant mit aktiver Verschlüsselung
    // darf über das Plugin KEINE Klartext-Dateien einliefern.
    if (tenant.encryptionEnabled && !isEncrypted) {
      throw new ApiError(409, 'Verschlüsselung ist für diesen Mandanten aktiv — bitte Plugin entsperren.')
    }

    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Datei erhalten.')
    if (!isEncrypted && !ALLOWED_MIME.includes(file.type)) {
      throw new ApiError(400, `Dateityp ${file.type || 'unbekannt'} nicht erlaubt (PDF, PNG, JPG, WebP).`)
    }
    if (file.size > MAX_FILE_BYTES) throw new ApiError(400, 'Datei zu groß (max. 10 MB).')

    let vendor = 'Unbekannt'
    try {
      vendor = new URL(sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      /* sourceUrl optional */
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const storedName = await saveInvoiceFile(tenant.id, filename, buffer)

    // E-Rechnung (W17): nur unverschlüsselte Dateien sind serverseitig analysierbar
    let analysis: Analysis | null = null
    if (!isEncrypted) {
      analysis = await analyzeInvoiceFile(buffer, file.type, filename)
    }
    const d = analysis?.data
    // Wie beim Web-Upload: bei Verschlüsselung NICHT den Chiffrat-Hash bilden
    // (zufälliges IV pro Verschlüsselung → nie deterministisch). Stattdessen
    // einen vom Plugin mitgeschickten Klartext-Hash übernehmen, falls
    // vorhanden (Plugin muss ihn vor dem Verschlüsseln bilden, wie
    // lib/clientCrypto.ts sha256Hex es für den Web-Upload tut).
    const suppliedHash = String(form.get('fileHash') ?? '')
    const fileHash = isEncrypted
      ? (/^[a-f0-9]{64}$/i.test(suppliedHash) ? suppliedHash : null)
      : hashBuffer(buffer)
    const invoiceNumberForDupCheck = d?.number ?? null
    const vendorForDupCheck = d?.sellerName ?? null
    const duplicateMatch = await detectDuplicate(tenant.id, {
      fileHash,
      invoiceNumber: invoiceNumberForDupCheck,
      vendor: vendorForDupCheck,
    })
    // Rechnungsversionierung (Stefan 2026-08-26, Review-Fund "Manueller
    // Upload/Catcher ohne Spam-Filter"): respektiert jetzt dieselbe
    // Mandanten-Einstellung wie der Mail-Eingang, siehe lib/duplicates.ts
    // resolveDuplicateOrVersion.
    const { duplicateOfId, isVersioningCase } = resolveDuplicateOrVersion(duplicateMatch, tenant.autoSupersedeInvoiceVersions)

    const docId = await nextDocId(tenant.id)
    const { inboxId: basketId, archiveId } = await ensureSystemBaskets(tenant.id)
    const electronicCheck = autoElectronicCheck(analysis?.format ?? 'PDF', analysis?.validation?.valid)
    const formalCheck = autoFormalCheckForEInvoice(analysis?.format ?? 'PDF', analysis?.validation?.valid)
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        docId,
        basketId,
        checkElectronicAt: electronicCheck.at,
        checkElectronicBy: electronicCheck.by,
        checkFormalAt: formalCheck.at,
        checkFormalBy: formalCheck.by,
        vendor: d?.sellerName || vendor,
        invoiceNumber: d?.number ?? null,
        invoiceDate: d?.issueDate ? new Date(d.issueDate) : null,
        dueDate: d?.dueDate ? new Date(d.dueDate) : null,
        discountDueDate: d?.discountDueDate ? new Date(d.discountDueDate) : null,
        discountPercent: d?.discountPercent ?? null,
        amountNet: d?.net ?? null,
        amountTax: d?.tax ?? null,
        amountGross: d?.gross ?? null,
        currency: d?.currency ?? 'EUR',
        status: InvoiceStatus.NEW,
        notes: sourceUrl ? `Gefangen von: ${sourceUrl}` : null,
        fileName: storedName,
        originalName: filename.replace(/\.enc$/, ''),
        mimeType: isEncrypted ? 'application/octet-stream' : file.type,
        encrypted: isEncrypted,
        encOrigMime: isEncrypted ? encOrigMime : null,
        fileHash,
        duplicateOfId,
        docFormat: analysis?.format ?? null,
        xmlData: analysis?.xml ?? null,
        validationOk: analysis?.validation?.valid ?? null,
        validationIssues: analysis?.validation?.missing.join(', ') || null,
        source: 'EXTENSION',
      },
    })
    if (isVersioningCase && invoiceNumberForDupCheck && vendorForDupCheck) {
      await supersedeOlderVersions(tenant.id, invoice.id, invoiceNumberForDupCheck, vendorForDupCheck, archiveId)
    }
    await audit({
      tenantId: tenant.id,
      actorName: `Plugin-Token "${token.label}"`,
      action: 'INVOICE_CREATE',
      details: `Rechnungs-Catcher: ${vendor} (${filename})${isEncrypted ? ' · verschlüsselt' : ''}`,
    })
    // Automatische KoSIT-Prüfung (Stefan 2026-08-26, Review-Fund "Browser-
    // Erweiterung löst nie eine KoSIT-Prüfung aus") — läuft im Hintergrund
    // weiter, ohne die Antwort auf diese Anfrage zu verzögern, wie beim
    // Mail-Eingang und dem Web-Upload.
    if (invoice.xmlData) scheduleKositCheck(invoice.id)
    return NextResponse.json({ ok: true, invoiceId: invoice.id, vendor })
  } catch (e) {
    return jsonError(e)
  }
}
