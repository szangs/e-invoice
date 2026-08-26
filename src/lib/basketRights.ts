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
  // Wirksames Recht (Stefan 2026-08-26, "Gruppenrechte werden von
  // Mitarbeiterrechten überschrieben"): ein explizit für den Mitarbeiter
  // gesetztes individuelles Recht (BasketUserRight) ist auf diesem Korb
  // ALLEIN maßgeblich — Gruppenrechte gelten für ihn dort dann gar nicht
  // mehr, auch nicht ergänzend. Nur wenn KEIN individuelles Recht auf einem
  // Korb existiert, zählt das höchste Gruppenrecht (über alle Gruppen, in
  // denen er Mitglied ist) — vorher wurde immer das jeweils höhere von
  // beidem genommen, was eine gezielte Einschränkung unter das Gruppenrecht
  // unmöglich machte.
  const [userRows, groupRows] = await Promise.all([
    prisma.basketUserRight.findMany({
      where: { userId, basket: { tenantId } },
      select: { basketId: true, right: true },
    }),
    prisma.basketGroupRight.findMany({
      where: { group: { tenantId, members: { some: { userId } } } },
      select: { basketId: true, right: true },
    }),
  ])
  const map: Record<string, number> = {}
  for (const r of groupRows) {
    const rank = RIGHT_RANK[r.right]
    if (!map[r.basketId] || rank > map[r.basketId]) map[r.basketId] = rank
  }
  // Individuelle Rechte überschreiben etwaige Gruppenrechte auf demselben Korb komplett.
  for (const r of userRows) {
    map[r.basketId] = RIGHT_RANK[r.right]
  }
  return map
}

/** Prüft, ob ein Nutzer mindestens `min` auf dem angegebenen Korb hat. */
export async function hasBasketRight(userId: string, role: Role, basketId: string, min: BasketRight): Promise<boolean> {
  if (alwaysFullAccess(role)) return true
  const userRow = await prisma.basketUserRight.findUnique({ where: { basketId_userId: { basketId, userId } } })
  // Individuelles Recht vorhanden → allein maßgeblich, Gruppenrechte werden
  // dafür gar nicht erst abgefragt (siehe Kommentar in getBasketRightMap).
  if (userRow) return RIGHT_RANK[userRow.right] >= RIGHT_RANK[min]
  const groupRows = await prisma.basketGroupRight.findMany({
    where: { basketId, group: { members: { some: { userId } } } },
    select: { right: true },
  })
  const best = Math.max(...groupRows.map((r) => RIGHT_RANK[r.right]), 0)
  return best >= RIGHT_RANK[min]
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
