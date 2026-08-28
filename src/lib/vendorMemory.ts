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
 *
 * IBAN/BIC (Stefan 2026-08-27, SEPA-Sammelüberweisung, siehe lib/sepa.ts):
 * werden genauso als "zuletzt gesehen" nachgeführt, ABER: ist die
 * Kontoverbindung dieses Lieferanten bereits von einem Menschen bestätigt
 * (ibanVerifiedAt gesetzt), wird sie hier NICHT mehr automatisch
 * überschrieben — sonst könnte eine gefälschte oder fehlerhafte Rechnung
 * eine geprüfte, für Zahlungen freigegebene Kontoverbindung unbemerkt
 * kapern. Eine neue, abweichende IBAN auf einer Folgerechnung erscheint erst
 * wieder als Vorschlag, wenn die Bestätigung manuell zurückgesetzt wird.
 */
export async function upsertVendorAddress(
  tenantId: string,
  vendorName: string,
  address: string | null | undefined,
  iban?: string | null,
  bic?: string | null,
  // Pflichtangaben (Stefan 2026-08-27, Schnellausfüllung) — genauso "zuletzt
  // gesehen" wie address, siehe schema.prisma Modell-Kommentar.
  vatId?: string | null,
  taxNumber?: string | null,
  countryCode?: string | null,
): Promise<void> {
  const trimmedAddress = address?.trim() || null
  const trimmedIban = iban?.trim().toUpperCase().replace(/\s+/g, '') || null
  const trimmedVatId = vatId?.trim() || null
  const trimmedTaxNumber = taxNumber?.trim() || null
  const trimmedCountryCode = countryCode?.trim().toUpperCase() || null
  if (!vendorName.trim() || (!trimmedAddress && !trimmedIban && !trimmedVatId && !trimmedTaxNumber && !trimmedCountryCode)) return

  const existing = await prisma.vendorAddress.findUnique({
    where: { tenantId_vendorName: { tenantId, vendorName } },
    select: { ibanVerifiedAt: true },
  })
  const canUpdateIban = trimmedIban && !existing?.ibanVerifiedAt

  await prisma.vendorAddress.upsert({
    where: { tenantId_vendorName: { tenantId, vendorName } },
    update: {
      ...(trimmedAddress ? { address: trimmedAddress } : {}),
      ...(canUpdateIban ? { iban: trimmedIban, bic: bic?.trim().toUpperCase() || null } : {}),
      ...(trimmedVatId ? { vatId: trimmedVatId } : {}),
      ...(trimmedTaxNumber ? { taxNumber: trimmedTaxNumber } : {}),
      ...(trimmedCountryCode ? { countryCode: trimmedCountryCode } : {}),
    },
    create: {
      tenantId,
      vendorName,
      address: trimmedAddress,
      iban: trimmedIban,
      bic: bic?.trim().toUpperCase() || null,
      vatId: trimmedVatId,
      taxNumber: trimmedTaxNumber,
      countryCode: trimmedCountryCode,
    },
  })
}

export type VendorAddressSuggestion = {
  address: string | null
  vatId: string | null
  taxNumber: string | null
  countryCode: string | null
  updatedAt: Date
}

/**
 * Vorschlag für die Pflichtangaben-Schnellausfüllung (Stefan 2026-08-27,
 * "Schnellausfüllung bei den Anschriftdaten, wenn er den Lieferant schon
 * kennt") — null, wenn zu diesem Lieferanten noch nichts hinterlegt ist,
 * oder wenn gar keins der vier Felder einen Wert hat (z. B. nur IBAN/BIC
 * bekannt). Bei aktiver Inhalts-Verschlüsselung liefert das hier ohnehin
 * nichts, da die Tabelle für solche Mandanten serverseitig nie befüllt wird
 * (siehe upsertVendorAddress-Aufrufstellen).
 */
export async function getVendorAddressSuggestion(tenantId: string, vendorName: string): Promise<VendorAddressSuggestion | null> {
  if (!vendorName.trim()) return null
  const row = await prisma.vendorAddress.findUnique({
    where: { tenantId_vendorName: { tenantId, vendorName } },
    select: { address: true, vatId: true, taxNumber: true, countryCode: true, updatedAt: true },
  })
  if (!row || (!row.address && !row.vatId && !row.taxNumber && !row.countryCode)) return null
  return row
}
