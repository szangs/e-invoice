// Rechnung bearbeiten / löschen — Mandantentrennung an der Quelle (§22)
import { NextRequest, NextResponse } from 'next/server'
import { InvoiceStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { isInvoiceLockedByClosure } from '@/lib/auditClosure'
import { alwaysFullAccess, hasBasketRight, requireInvoiceContentAccess } from '@/lib/basketRights'
import { ensureSystemBaskets, requestMove } from '@/lib/baskets'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { EINVOICE_FORMATS } from '@/lib/docFormat'
import { CONTENT_ENC_VENDOR_PLACEHOLDER, toDTO } from '@/lib/invoices'
import { upsertVendorAddress } from '@/lib/vendorMemory'

// Steuerlich relevante Felder — bei ZUGFeRD/XRechnung ist das XML das
// rechtsverbindliche Original, hier darf die Anzeige nie davon abweichen
// (GoBD-Unveränderbarkeit). Wird serverseitig erzwungen, nicht nur in der UI
// versteckt (Stefan 2026-07-08). Notizen/Tags/Status/Zahlungsart/Korb sind
// NICHT betroffen — das ist unsere eigene Workflow-Metadaten-Ebene.
const TAX_RELEVANT_FIELDS = [
  'vendor', 'invoiceNumber', 'invoiceDate', 'dueDate', 'discountDueDate', 'discountPercent',
  'sellerAddress', 'sellerVatId', 'sellerTaxNumber', 'sellerCountryCode',
  'amountNet', 'amountTax', 'amountGross', 'currency',
] as const

const schema = z.object({
  vendor: z.string().min(1).optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  discountDueDate: z.string().nullable().optional(),
  discountPercent: z.number().nullable().optional(),
  sellerAddress: z.string().nullable().optional(),
  sellerVatId: z.string().nullable().optional(),
  sellerTaxNumber: z.string().nullable().optional(),
  sellerCountryCode: z.string().nullable().optional(),
  amountNet: z.number().nullable().optional(),
  amountTax: z.number().nullable().optional(),
  amountGross: z.number().nullable().optional(),
  currency: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  tags: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Positionszeilen aus "Mit KI erkennen" (Stefan 2026-08-25) — nur bei
  // nackten PDFs/Scans, siehe Invoice.lineItems in schema.prisma.
  lineItems: z.array(z.object({
    name: z.string(),
    qty: z.string().nullable(),
    unitPrice: z.number().nullable(),
    total: z.number().nullable(),
  })).nullable().optional(),
  // Kostenstellen/Kostenträger (Stefan 2026-07-09, #114): Workflow-Feld wie
  // Status/Fälligkeit — bleibt IMMER Klartext, auch bei E-Rechnungen (nicht
  // in TAX_RELEVANT_FIELDS) und bei aktiver Inhalts-Verschlüsselung.
  costCenterCode: z.string().nullable().optional(),
  costCarrierCode: z.string().nullable().optional(),
  // Inland/EU/Drittland-Überschreibung (Stefan 2026-08-25) — Workflow-
  // Einschätzung, kein Rechnungsinhalt, deshalb auch bei E-Rechnung frei
  // änderbar (nicht in TAX_RELEVANT_FIELDS).
  taxRegion: z.enum(['INLAND', 'EU', 'DRITTLAND']).nullable().optional(),
  // "Prüfung ignorieren" (Stefan 2026-08-25) — Begründung ist beim Setzen
  // Pflicht (serverseitig erzwungen unten), beim Zurücknehmen (false) wird
  // reason ignoriert.
  pflichtangabenIgnored: z.boolean().optional(),
  pflichtangabenIgnoredReason: z.string().nullable().optional(),
  // Inhalts-Verschlüsselung (Stefan 2026-07-09): ersetzt vendor/invoiceNumber/
  // amount*/currency/tags/notes oben durch ein einziges Chiffrat — siehe
  // clientCrypto.ts encryptJson / /invoices/[id]/InvoiceEditForm.tsx.
  contentEnc: z.string().optional(),
  // Dubletten-Kennzeichnung aufheben ("keine Dublette")
  duplicateOfId: z.null().optional(),
  // Abweichung Rechnungsempfänger/Firmenbezeichnung akzeptiert (Stefan 2026-08-25)
  buyerNameMismatchAcknowledged: z.boolean().optional(),
  // Wird gesetzt, wenn beim Speichern zuvor "Mit KI erkennen" genutzt wurde
  aiAssisted: z.boolean().optional(),
  // Menschliche Bestätigung der KI-erkannten Werte (Tab-Bestätigungs-Flow im
  // Formular) — Server stempelt wer/wann, wie bei den Prüf-Häkchen unten.
  confirmAi: z.literal(true).optional(),
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
    const {
      checkElectronic, checkFormal, checkSubstantive, checkAccounting, restore, confirmAi, lineItems,
      pflichtangabenIgnored, pflichtangabenIgnoredReason, ...rest
    } = schema.parse(await req.json())
    const data = { ...rest } as typeof rest
    // Separat behandelt statt im generischen `data`-Spread (Stefan
    // 2026-08-25): Prisma verlangt für Json?-Spalten beim Löschen das
    // Sentinel Prisma.JsonNull statt eines rohen `null` — ein bedingter
    // Objekt-Spread `{...(x ? {lineItems: ...} : {})}` lässt TS beim
    // konkreten Typ hier durcheinanderkommen (Union über beide Zweige, auch
    // den `null`-Fall aus dem ursprünglichen `rest`), einzeln zugewiesen ist eindeutig.
    const lineItemsUpdate: Prisma.InvoiceUpdateInput['lineItems'] =
      lineItems === undefined ? undefined : (lineItems ?? Prisma.JsonNull)

    // Weich gelöschte Rechnung: nur die Wiederherstellung ist erlaubt, keine
    // sonstigen Änderungen (verhindert versehentliches Weiterbearbeiten).
    if (existing.deletedAt && !restore) {
      throw new ApiError(409, 'Rechnung ist gelöscht — bitte zuerst wiederherstellen.')
    }

    // Korb-Recht CONTENT nötig, um überhaupt an dieser Rechnung etwas zu
    // ändern (Stefan 2026-07-09) — vorher waren nur die zwei Häkchen unten
    // geschützt, alle anderen Felder (Lieferant, Beträge, Notizen, Formal-
    // Häkchen …) ließen sich ohne jedes Korb-Recht per API ändern.
    await requireInvoiceContentAccess(ctx, existing.basketId)

    // Perioden-Abschluss (§18, Stefan 2026-08-25): Belege aus einem
    // abgeschlossenen Jahr sind vollständig schreibgeschützt — keine
    // Ausnahme, auch nicht für Notizen/Prüfhäkchen (siehe
    // lib/auditClosure.ts, api/platform/audit/period-close). Defense in
    // depth wie bei den GoBD-Feldern unten: die UI sperrt bereits, aber ein
    // direkter API-Aufruf darf es ebenfalls nicht umgehen können.
    if (await isInvoiceLockedByClosure(existing.createdAt)) {
      throw new ApiError(423, `Diese Rechnung gehört zum abgeschlossenen Prüfungszeitraum ${existing.createdAt.getFullYear()} und ist schreibgeschützt.`)
    }
    // Rechnungsversionierung (Stefan 2026-08-25): eine ältere, bereits
    // überholte Version ist ebenfalls schreibgeschützt (siehe schema.prisma
    // Invoice.supersededAt) — Ausnahme wie beim Perioden-Abschluss keine.
    if (existing.supersededAt) {
      throw new ApiError(423, 'Diese Rechnung wurde durch eine neuere Version ersetzt und ist schreibgeschützt.')
    }

    // Steuerlich relevante Felder bei ZUGFeRD/XRechnung serverseitig sperren
    // (defense-in-depth — die UI blendet sie zwar schon read-only ein, aber
    // ein direkter API-Aufruf darf sie ebenfalls nicht ändern können).
    if ((EINVOICE_FORMATS as string[]).includes(existing.docFormat ?? '')) {
      for (const field of TAX_RELEVANT_FIELDS) delete data[field]
      // E-Rechnungen lassen sich strukturell nie verschlüsselt anlegen (der
      // Server muss das XML beim Einlesen lesen können) — ein contentEnc
      // würde hier nur die GoBD-Sperre der Felder oben umgehen.
      delete data.contentEnc
    }

    // Inhalts-Verschlüsselung (Stefan 2026-07-09): wird contentEnc gesetzt,
    // ersetzt das die einzelnen Klartext-Felder — vendor bekommt den
    // Platzhalter (NOT NULL), alle anderen content-Felder werden geleert,
    // damit kein alter Klartext neben dem neuen Chiffrat liegen bleibt (z. B.
    // wenn eine vorher unverschlüsselte Rechnung jetzt erstmals verschlüsselt
    // gespeichert wird).
    if (data.contentEnc) {
      data.vendor = CONTENT_ENC_VENDOR_PLACEHOLDER
      data.invoiceNumber = null
      data.amountNet = null
      data.amountTax = null
      data.amountGross = null
      data.currency = 'EUR'
      data.tags = null
      data.notes = null
      data.sellerAddress = null
      data.sellerVatId = null
      data.sellerTaxNumber = null
    }

    // Korb-Rechte (Stefan 2026-07-08): "Sachlich freigeben" braucht APPROVE,
    // "An Buchhaltung übergeben" (= Übergabe an den Übergabekorb) braucht
    // HANDOVER auf dem AKTUELLEN Korb der Rechnung.
    const currentBasket = existing.basketId
      ? await prisma.basket.findUnique({ where: { id: existing.basketId }, select: { kind: true } })
      : null

    if (existing.basketId) {
      if (checkSubstantive !== undefined && !(await hasBasketRight(ctx.userId, ctx.role, existing.basketId, 'APPROVE'))) {
        throw new ApiError(403, 'Kein Recht, "Sachlich richtig" freizugeben.')
      }
      if (checkAccounting !== undefined) {
        if (!(await hasBasketRight(ctx.userId, ctx.role, existing.basketId, 'HANDOVER'))) {
          throw new ApiError(403, 'Kein Recht zur Übergabe an den Übergabekorb.')
        }
        if (checkAccounting) {
          // Stefan 2026-07-09: die Übergabe an die Fibu darf nur passieren,
          // während die Rechnung TATSÄCHLICH im Übergabekorb liegt — sonst
          // könnte jemand mit HANDOVER-Recht auf einem anderen Korb die
          // Rechnung schon dort als "übergeben" markieren.
          if (currentBasket?.kind !== 'HANDOVER') {
            throw new ApiError(400, 'Übergabe an die Fibu ist nur im Übergabekorb möglich.')
          }
        } else if (currentBasket?.kind === 'ARCHIVE' && !alwaysFullAccess(ctx.role)) {
          // Rechnung liegt schon in der Ablage (automatisch nach der
          // Übergabe) — das Zurücknehmen ist wie das Herausverschieben aus
          // der Ablage Admins vorbehalten.
          throw new ApiError(403, 'Nur der Mandanten-Admin kann die Übergabe aus der Ablage zurücknehmen.')
        }
      }
    }

    // Effektiver Stand nach dieser Änderung — auch Häkchen berücksichtigen,
    // die im SELBEN Aufruf gerade erst gesetzt werden (z. B. checkSubstantive).
    const effectiveElectronic = checkElectronic !== undefined ? checkElectronic : !!existing.checkElectronicAt
    const effectiveFormal = checkFormal !== undefined ? checkFormal : !!existing.checkFormalAt
    const effectiveSubstantive = checkSubstantive !== undefined ? checkSubstantive : !!existing.checkSubstantiveAt
    const allPriorChecksDone = effectiveElectronic && effectiveFormal && effectiveSubstantive

    if (checkAccounting && !allPriorChecksDone) {
      throw new ApiError(400, 'Elektronische Vorprüfung, Formal richtig und Sachlich richtig müssen zuerst abgeschlossen sein.')
    }

    // Automatische Übergabe (Stefan 2026-07-09, wie bei HS): sobald alle drei
    // vorherigen Häkchen stehen UND die Rechnung im Übergabekorb liegt, wird
    // "An Buchhaltung übergeben" automatisch mitgesetzt — kein 4. Klick nötig.
    // Nur wenn der HANDELNDE Nutzer selbst auch das HANDOVER-Recht hat, sonst
    // bleibt die Rechnung fertig geprüft, aber offen, bis jemand mit dem
    // passenden Recht (oder der DATEV-Export) sie übergibt.
    let effectiveAccounting = checkAccounting
    if (
      checkAccounting === undefined &&
      allPriorChecksDone &&
      !existing.checkAccountingAt &&
      currentBasket?.kind === 'HANDOVER' &&
      existing.basketId &&
      (await hasBasketRight(ctx.userId, ctx.role, existing.basketId, 'HANDOVER'))
    ) {
      effectiveAccounting = true
    }

    // Prüfschritte: Server stempelt wer (angemeldeter Nutzer) + wann; ein
    // "false" hebt die Prüfung wieder auf (beide Felder zurück auf null)
    const checkData: Record<string, Date | string | null> = {}
    const intents = { checkElectronic, checkFormal, checkSubstantive, checkAccounting: effectiveAccounting }
    for (const [key, atField, byField] of Object.entries(CHECK_MAP).map(([k, [a, b]]) => [k, a, b] as const)) {
      const intent = intents[key as keyof typeof intents]
      if (intent === undefined) continue
      checkData[atField] = intent ? new Date() : null
      checkData[byField] = intent ? ctx.email : null
    }

    // Ablage (Stefan 2026-07-09): bei Übergabe automatisch in den festen
    // Ablagekorb verschieben, beim Zurücknehmen (nur Admin) zurück in den
    // Übergabekorb.
    let basketMove: { basketId?: string } = {}
    if (effectiveAccounting === true) {
      const { archiveId } = await ensureSystemBaskets(tenantId)
      basketMove = { basketId: archiveId }
    } else if (effectiveAccounting === false && currentBasket?.kind === 'ARCHIVE') {
      const { handoverId } = await ensureSystemBaskets(tenantId)
      basketMove = { basketId: handoverId }
    }

    // "Prüfung ignorieren" (Stefan 2026-08-25): Begründung ist beim Setzen
    // Pflicht — reine Anzeige-Ausnahme, aber GoBD-Nachvollziehbarkeit über
    // Grund/wer/wann bleibt erhalten (siehe audit() unten zusätzlich).
    if (pflichtangabenIgnored === true && !pflichtangabenIgnoredReason?.trim()) {
      throw new ApiError(400, 'Für "Prüfung ignorieren" wird eine kurze Begründung benötigt.')
    }

    // Als eigene, explizit getypte Variable statt eines großen Inline-Spreads
    // (Stefan 2026-08-25): TS kommt bei so vielen kombinierten optionalen
    // Feldern sonst mit Prismas "checked vs. unchecked update input"-Union
    // durcheinander (spätestens seit lineItems dazukam).
    const updateData: Prisma.InvoiceUpdateInput = {
      ...data,
      lineItems: lineItemsUpdate,
      ...checkData,
      ...basketMove,
      ...(restore ? { deletedAt: null, deletedBy: null } : {}),
      ...(confirmAi ? { aiConfirmedAt: new Date(), aiConfirmedBy: ctx.email } : {}),
      ...(pflichtangabenIgnored === true
        ? { pflichtangabenIgnoredAt: new Date(), pflichtangabenIgnoredBy: ctx.email, pflichtangabenIgnoredReason: pflichtangabenIgnoredReason!.trim() }
        : pflichtangabenIgnored === false
          ? { pflichtangabenIgnoredAt: null, pflichtangabenIgnoredBy: null, pflichtangabenIgnoredReason: null }
          : {}),
      invoiceDate: data.invoiceDate === undefined ? undefined : data.invoiceDate ? new Date(data.invoiceDate) : null,
      dueDate: data.dueDate === undefined ? undefined : data.dueDate ? new Date(data.dueDate) : null,
      discountDueDate: data.discountDueDate === undefined ? undefined : data.discountDueDate ? new Date(data.discountDueDate) : null,
    }
    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: updateData,
    })
    // Lieferanten-Adressregister nachführen (Stefan 2026-08-26) — nur wenn
    // dieser Aufruf tatsächlich eine Klartext-Anschrift mitgeliefert hat
    // (bei aktiver Inhalts-Verschlüsselung sendet der Client stattdessen
    // contentEnc, sellerAddress bleibt hier undefined).
    if (updateData.sellerAddress !== undefined) {
      await upsertVendorAddress(tenantId, invoice.vendor, invoice.sellerAddress)
    }
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: restore ? 'INVOICE_RESTORE' : 'INVOICE_UPDATE',
      details: restore
        ? `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id} wiederhergestellt`
        : pflichtangabenIgnored === true
          ? `Pflichtangaben-Prüfung ignoriert für ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id} — Grund: ${pflichtangabenIgnoredReason!.trim()}`
          : pflichtangabenIgnored === false
            ? `Pflichtangaben-Prüfung wieder aktiviert für ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id}`
            : `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id} geändert`,
    })

    // Automatischer Wechsel in den Übergabekorb (Stefan 2026-07-09): sobald
    // alle drei Prüf-Häkchen stehen, muss die Rechnung nicht mehr von Hand
    // (Drag&Drop) dorthin verschoben werden — das war der letzte manuelle
    // Schritt vor der eigentlichen Fibu-Übergabe (die dort ja bereits
    // automatisch feuert, siehe effectiveAccounting oben). Nur wenn der
    // HANDELNDE Nutzer selbst das HANDOVER-Recht auf dem AKTUELLEN Korb hat
    // (dieselbe Regel wie bei einem manuellen Verschieben) — sonst bleibt die
    // Rechnung fertig geprüft liegen, bis jemand mit dem passenden Recht sie
    // verschiebt. Läuft über dieselbe requestMove-Funktion wie Drag&Drop, das
    // Vier-Augen-Prinzip eines Korbs (falls dort aktiviert) gilt also genauso
    // — die "Freigabe" wird dann nur als eine von zwei nötigen Stimmen erfasst.
    let autoMoveApprovalPending: { approvedBy: string[]; approvalsNeeded: number } | null = null
    // Sichtbare Rückmeldung für den automatischen Wechsel (Stefan 2026-07-09):
    // vorher verschwand die Zeile beim router.refresh() einfach kommentarlos
    // aus der Liste — für den Nutzer nicht erkennbar, ob das Absicht war oder
    // ein Fehler. targetBasketName geht ans UI, das daraus eine kurze Meldung zeigt.
    let autoMoved: { targetBasketName: string } | null = null
    if (
      allPriorChecksDone &&
      invoice.basketId &&
      currentBasket?.kind !== 'HANDOVER' &&
      currentBasket?.kind !== 'ARCHIVE' &&
      (await hasBasketRight(ctx.userId, ctx.role, invoice.basketId, 'HANDOVER'))
    ) {
      try {
        const { handoverId } = await ensureSystemBaskets(tenantId)
        const moveResult = await requestMove(tenantId, params.id, handoverId, ctx.userId, ctx.email, ctx.role)
        if (!moveResult.moved) {
          autoMoveApprovalPending = { approvedBy: moveResult.approvedBy, approvalsNeeded: moveResult.approvalsNeeded }
        } else {
          const handoverBasket = await prisma.basket.findUnique({ where: { id: handoverId }, select: { name: true } })
          autoMoved = { targetBasketName: handoverBasket?.name ?? 'Übergabekorb' }
        }
      } catch {
        // Automatischer Korb-Wechsel ist eine Zusatzfunktion — falls er aus
        // irgendeinem Grund fehlschlägt, soll das die eigentliche Häkchen-
        // Änderung oben (bereits gespeichert) nicht rückgängig machen.
      }
    }

    return NextResponse.json({ invoice: toDTO(invoice), autoMoveApprovalPending, autoMoved })
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
    // Korb-Rechte (Stefan 2026-07-08): Löschen aus einem Ablagekorb braucht
    // dasselbe Recht wie "Sachlich freigeben" (APPROVE) auf dem aktuellen Korb.
    if (existing.basketId && !(await hasBasketRight(ctx.userId, ctx.role, existing.basketId, 'APPROVE'))) {
      throw new ApiError(403, 'Kein Recht zum Löschen in diesem Korb.')
    }
    if (await isInvoiceLockedByClosure(existing.createdAt)) {
      throw new ApiError(423, `Diese Rechnung gehört zum abgeschlossenen Prüfungszeitraum ${existing.createdAt.getFullYear()} und ist schreibgeschützt.`)
    }
    if (existing.supersededAt) {
      throw new ApiError(423, 'Diese Rechnung wurde durch eine neuere Version ersetzt und ist schreibgeschützt.')
    }
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
