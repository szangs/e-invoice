// Lieferanten-Gedächtnis (Stefan 2026-08-25): einmal von einem Menschen
// bestätigte/ergänzte Angaben zu einem Lieferanten sollen bei der nächsten
// Rechnung DESSELBEN Lieferanten nicht erneut von Hand nachgetragen werden
// müssen. Bewusst NUR für zwei Zwecke, keine automatische Übernahme von
// Beträgen/Datum/Rechnungsnummer (die sind je Rechnung unterschiedlich — ein
// falscher Autofill dort würde genau das Risiko schaffen, das die
// Vier-Augen-Prüfung eigentlich verhindern soll):
//
// 1. getVendorDefaults: Workflow-Felder, die bei einem Lieferanten praktisch
//    immer gleich sind (Kostenstelle/-träger, Tags, Zahlungsart, Währung) —
//    werden als Vorschlag übernommen, wenn die aktuelle Rechnung dazu selbst
//    nichts geliefert hat.
// 2. getVendorReferenceExample: ein Referenzbeispiel (Lieferant/Kategorie/
//    Währung) einer früheren, bereits geprüften Rechnung DESSELBEN Absenders
//    wird der KI-Erkennung als Orientierung mitgegeben — macht die Erkennung
//    konsistenter (z. B. immer derselbe Lieferanten-Schreibweise), ohne dass
//    die KI die Werte blind übernimmt (Beträge/Datum liest sie weiterhin
//    eigenständig aus dem aktuellen Beleg).
//
// "Bereits geprüft" heißt hier: entweder ganz ohne KI erfasst (aiAssisted
// false, z. B. manueller Upload) oder KI-Werte wurden von einem Menschen
// bestätigt (aiConfirmedAt gesetzt) — eine noch unbestätigte KI-Vermutung
// soll sich nicht selbst als "gelernter" Standard festsetzen.
import { prisma } from '@/lib/db'

const CONFIRMED_SOURCE = [{ aiAssisted: false }, { aiConfirmedAt: { not: null } }] as const

export type VendorDefaults = {
  costCenterCode: string | null
  costCarrierCode: string | null
  tags: string | null
  directDebitByVendor: boolean
  currency: string
}

export async function getVendorDefaults(tenantId: string, vendorName: string): Promise<VendorDefaults | null> {
  if (!vendorName.trim()) return null
  return prisma.invoice.findFirst({
    where: {
      tenantId,
      vendor: { equals: vendorName, mode: 'insensitive' },
      deletedAt: null,
      OR: [...CONFIRMED_SOURCE],
    },
    orderBy: { createdAt: 'desc' },
    select: { costCenterCode: true, costCarrierCode: true, tags: true, directDebitByVendor: true, currency: true },
  })
}

export type VendorReferenceExample = {
  vendor: string
  tags: string | null
  currency: string
}

export async function getVendorReferenceExample(tenantId: string, senderEmail: string): Promise<VendorReferenceExample | null> {
  const email = senderEmail.trim().toLowerCase()
  if (!email) return null
  return prisma.invoice.findFirst({
    where: {
      tenantId,
      senderEmail: email,
      deletedAt: null,
      OR: [...CONFIRMED_SOURCE],
    },
    orderBy: { createdAt: 'desc' },
    select: { vendor: true, tags: true, currency: true },
  })
}

/** Baut den KI-Prompt-Zusatztext aus einem Referenzbeispiel — leerer String, wenn keins vorhanden. */
export function buildVendorReferenceHint(ref: VendorReferenceExample | null, senderEmail: string): string {
  if (!ref) return ''
  return (
    `Hinweis: Eine frühere, bereits geprüfte Rechnung desselben Absenders (${senderEmail}) ergab ` +
    `Lieferant "${ref.vendor}"${ref.tags ? `, Kategorie "${ref.tags}"` : ''}, Währung ${ref.currency}. ` +
    `Nutze das NUR als Orientierung für Lieferant/Kategorie/Währung — alle anderen Felder, ` +
    `insbesondere Beträge, Datum und Rechnungsnummer, bitte unabhängig aus DIESEM Beleg lesen.`
  )
}

/**
 * Lieferanten-Adressregister nachführen (Stefan 2026-08-26): bei jeder
 * Rechnung mit lesbarer Anschrift wird der aktuellste Stand für diesen
 * Lieferanten gespeichert — Grundlage für den eigenständigen Adress-Export
 * an die Fibu (api/invoices/export/vendor-addresses). Bewusst ohne
 * Validierung/Deutung der Anschrift — reines "zuletzt gesehen".
 * Läuft nur mit KLARTEXT-Anschrift (bei aktiver Inhalts-Verschlüsselung
 * kommt hier serverseitig ohnehin nie ein Wert an, siehe schema.prisma).
 */
export async function upsertVendorAddress(tenantId: string, vendorName: string, address: string | null | undefined): Promise<void> {
  if (!vendorName.trim() || !address?.trim()) return
  await prisma.vendorAddress.upsert({
    where: { tenantId_vendorName: { tenantId, vendorName } },
    update: { address: address.trim() },
    create: { tenantId, vendorName, address: address.trim() },
  })
}
