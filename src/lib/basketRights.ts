// Korb-Rechte je Mitarbeiter (Stefan 2026-07-08, umgestellt von Rolle auf
// direkte Mitarbeiter-Auswahl — die Rollen-Zuordnung hat in der Praxis nur
// verwirrt). Sechsstufige Rangfolge, jede Stufe schließt alle darunter
// liegenden Rechte ein. Nur der Mandanten-Admin kann die Zuordnung in der
// Körbe-Verwaltung ändern (siehe API-Route admin/baskets/[id]/rights);
// Mandanten-Admin und Betreiber selbst haben immer alle Rechte auf jeden
// Korb, ohne dass dafür eine Zeile in der Datenbank nötig ist. Mitarbeiter
// OHNE Eintrag zu einem Korb gilt: kein Zugriff — auch nicht "sehen".
import { BasketRight, Role } from '@prisma/client'
import { ApiError } from '@/lib/context'
import { prisma } from '@/lib/db'

export const RIGHT_RANK: Record<BasketRight, number> = {
  VIEW: 1,
  CONTENT: 2,
  MOVE: 3,
  APPROVE: 4,
  HANDOVER: 5,
  FIBU: 6,
}

export const RIGHT_LABELS: Record<BasketRight, string> = {
  VIEW: 'Korb sehen',
  CONTENT: 'Inhalt anzeigen',
  MOVE: 'Verschieben',
  APPROVE: 'Sachlich freigeben',
  HANDOVER: 'Übergabe an den Übergabekorb',
  FIBU: 'Übergabe an die Fibu',
}

// Reihenfolge für Auswahlfelder (niedrigste zuerst)
export const RIGHT_ORDER: BasketRight[] = ['VIEW', 'CONTENT', 'MOVE', 'APPROVE', 'HANDOVER', 'FIBU']

export function alwaysFullAccess(role: Role): boolean {
  return role === Role.TENANT_ADMIN || role === Role.OPERATOR_ADMIN
}

/** Höchste erlaubte Rechtsstufe (als Rang-Zahl) je Korb-ID für den übergebenen Nutzer. */
export async function getBasketRightMap(tenantId: string, userId: string, role: Role): Promise<Record<string, number>> {
  if (alwaysFullAccess(role)) {
    const baskets = await prisma.basket.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } })
    return Object.fromEntries(baskets.map((b) => [b.id, RIGHT_RANK.FIBU]))
  }
  const rows = await prisma.basketUserRight.findMany({
    where: { userId, basket: { tenantId } },
    select: { basketId: true, right: true },
  })
  return Object.fromEntries(rows.map((r) => [r.basketId, RIGHT_RANK[r.right]]))
}

/** Prüft, ob ein Nutzer mindestens `min` auf dem angegebenen Korb hat. */
export async function hasBasketRight(userId: string, role: Role, basketId: string, min: BasketRight): Promise<boolean> {
  if (alwaysFullAccess(role)) return true
  const row = await prisma.basketUserRight.findUnique({
    where: { basketId_userId: { basketId, userId } },
  })
  if (!row) return false
  return RIGHT_RANK[row.right] >= RIGHT_RANK[min]
}

/**
 * Zentraler Zugriffs-Wächter (Stefan 2026-07-09): bislang prüften nur
 * Verschieben/Sachlich-freigeben/Übergabe/Fibu-Export ein Korb-Recht — die
 * Rechnungsdetailseite, der Datei-Download, Anhänge, Notizen und die
 * KI-Routen prüften nur Mandantenzugehörigkeit, kein Korb-Recht. Wer die
 * Rechnungs-ID kennt, konnte sie also unabhängig von seinen Korb-Rechten
 * öffnen/bearbeiten. Diese Funktion schließt die Lücke: mindestens CONTENT
 * ("Inhalt anzeigen") nötig, um eine Rechnung überhaupt zu sehen oder
 * anzufassen. Rechnungen ohne Korb (z. B. sehr alter Bestand) bleiben
 * unbeschränkt, da es dort kein Korb-Recht geben kann.
 */
export async function requireInvoiceContentAccess(
  ctx: { userId: string; role: Role },
  basketId: string | null,
): Promise<void> {
  if (!basketId) return
  if (!(await hasBasketRight(ctx.userId, ctx.role, basketId, 'CONTENT'))) {
    throw new ApiError(403, 'Kein Recht, diese Rechnung einzusehen.')
  }
}
