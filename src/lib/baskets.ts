// Körbe (Rechnungseingangsverarbeitung, Stefan 2026-07-08): Rechnungen
// wandern durch benannte "Körbe" statt einer einzigen flachen Liste — analog
// zu klassischer Rechnungseingangs-Bearbeitung mit Postkörben je Team/Schritt.
// Jeder Mandant hat automatisch einen Eingangskorb (INBOX) und einen
// Übergabekorb (HANDOVER); dazwischen beliebig viele frei anlegbare Körbe
// (CUSTOM). Optionales Vier-Augen-Gate je Korb: zwei UNTERSCHIEDLICHE
// Mitarbeiter müssen den Wechsel in einen Zielkorb freigeben, bevor er
// ausgeführt wird — unabhängig von der Rechnungsprüfung (4 Häkchen) auf der
// Rechnung selbst.
import { BasketKind } from '@prisma/client'
import { audit } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'

/** Legt Eingangs-/Übergabekorb an, falls für den Mandanten noch nicht vorhanden. */
export async function ensureSystemBaskets(tenantId: string): Promise<{ inboxId: string; handoverId: string }> {
  const [inbox, handover] = await Promise.all([
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.INBOX } }),
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.HANDOVER } }),
  ])
  const inboxId = inbox
    ? inbox.id
    : (await prisma.basket.create({
        data: { tenantId, name: 'Eingangskorb', kind: BasketKind.INBOX, position: 0 },
      })).id
  const handoverId = handover
    ? handover.id
    : (await prisma.basket.create({
        data: { tenantId, name: 'Übergabekorb', kind: BasketKind.HANDOVER, position: 999 },
      })).id
  return { inboxId, handoverId }
}

/** Bequemer Zugriff für die Rechnungs-Anlage: liefert nur die Eingangskorb-ID. */
export async function getInboxBasketId(tenantId: string): Promise<string> {
  const { inboxId } = await ensureSystemBaskets(tenantId)
  return inboxId
}

export type MoveResult =
  | { moved: true }
  | { moved: false; approvalsNeeded: number; approvedBy: string[] }

/**
 * Verschiebt eine Rechnung in einen Zielkorb — direkt, oder (falls der
 * AKTUELLE Korb Vier-Augen-Prinzip verlangt) als Freigabe, die erst beim
 * zweiten, abweichenden Nutzer tatsächlich ausgeführt wird.
 */
export async function requestMove(
  tenantId: string,
  invoiceId: string,
  targetBasketId: string,
  userId: string,
  userEmail: string,
): Promise<MoveResult> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { id: true, vendor: true, invoiceNumber: true, basketId: true },
  })
  if (!invoice) throw new Error('Rechnung nicht gefunden')

  const target = await prisma.basket.findFirst({ where: { id: targetBasketId, tenantId } })
  if (!target) throw new Error('Zielkorb nicht gefunden')

  const fromBasket = invoice.basketId
    ? await prisma.basket.findFirst({ where: { id: invoice.basketId, tenantId } })
    : null

  const gate = fromBasket?.fourEyesEnabled === true

  if (!gate || !fromBasket) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { basketId: targetBasketId } })
    await audit({
      tenantId,
      actorId: userId,
      actorName: userEmail,
      action: 'BASKET_MOVE',
      details: `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? ''} → Korb "${target.name}"`,
    })
    return { moved: true }
  }

  // Vier-Augen-Gate: eigene Freigabe eintragen (falls noch nicht vorhanden), dann zählen
  await prisma.basketApproval.upsert({
    where: {
      invoiceId_fromBasketId_targetBasketId_userId: {
        invoiceId, fromBasketId: fromBasket.id, targetBasketId, userId,
      },
    },
    update: {},
    create: { invoiceId, fromBasketId: fromBasket.id, targetBasketId, userId },
  })
  const approvals = await prisma.basketApproval.findMany({
    where: { invoiceId, fromBasketId: fromBasket.id, targetBasketId },
    select: { userId: true, user: { select: { email: true } } },
  })
  const distinctUserIds = Array.from(new Set(approvals.map((a) => a.userId)))

  if (distinctUserIds.length >= 2) {
    await prisma.$transaction([
      prisma.invoice.update({ where: { id: invoiceId }, data: { basketId: targetBasketId } }),
      // Alle offenen Freigaben für diese Rechnung aus dem verlassenen Korb löschen
      // (unabhängig vom Zielkorb — sie ist ja jetzt woanders).
      prisma.basketApproval.deleteMany({ where: { invoiceId, fromBasketId: fromBasket.id } }),
    ])
    await audit({
      tenantId,
      actorId: userId,
      actorName: userEmail,
      action: 'BASKET_MOVE',
      details: `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? ''} → Korb "${target.name}" ` +
        `(Vier-Augen-Freigabe durch ${approvals.map((a) => a.user.email).join(', ')})`,
    })
    return { moved: true }
  }

  await audit({
    tenantId,
    actorId: userId,
    actorName: userEmail,
    action: 'BASKET_APPROVAL',
    details: `Freigabe für Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? ''} → Korb "${target.name}" ` +
      `erteilt (${distinctUserIds.length}/2, Vier-Augen-Korb "${fromBasket.name}")`,
  })
  return {
    moved: false,
    approvalsNeeded: 2 - distinctUserIds.length,
    approvedBy: approvals.map((a) => a.user.email),
  }
}

function dueForHours(last: Date | null, hours: number | null): boolean {
  if (!hours || hours <= 0) return false
  if (!last) return true
  return Date.now() - last.getTime() >= hours * 60 * 60 * 1000
}

/**
 * Sammel-Benachrichtigung je Korb (statt einer Mail pro Rechnung): schickt an
 * jedes zugeordnete Mitglied eine Übersicht der aktuell im Korb liegenden
 * Rechnungen, wenn das eingestellte Stunden-Intervall verstrichen ist.
 * Läuft im selben Scheduler-Takt wie Sicherung/Bericht (stündliche Prüfung).
 */
export async function runDueBasketNotifications(force = false): Promise<string[]> {
  const log: string[] = []
  const baskets = await prisma.basket.findMany({
    where: { notificationEnabled: true },
    include: {
      members: { include: { user: { select: { email: true, active: true } } } },
      tenant: { select: { name: true, active: true } },
    },
  })
  for (const b of baskets) {
    if (!b.tenant.active) continue
    if (!force && !dueForHours(b.lastNotifiedAt, b.notificationIntervalHours)) continue
    const recipients = b.members.map((m) => m.user).filter((u) => u.active)
    if (recipients.length === 0) {
      log.push(`${b.name}: keine Mitarbeiter zugeordnet — übersprungen`)
      continue
    }
    const invoices = await prisma.invoice.findMany({
      where: { basketId: b.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { docId: true, vendor: true, invoiceNumber: true, createdAt: true },
    })
    const body =
      `Guten Tag,\n\nin Korb "${b.name}" (${b.tenant.name}) liegen aktuell ${invoices.length} Rechnung(en):\n\n` +
      invoices
        .map((i) => `- ${i.docId ?? '—'} · ${i.vendor}${i.invoiceNumber ? ' · ' + i.invoiceNumber : ''}`)
        .join('\n') +
      `\n\nDiese Übersicht kommt automatisch alle ${b.notificationIntervalHours} Stunde(n).\n`
    let anySent = false
    for (const r of recipients) {
      const mail = await sendSystemMail(r.email, `E-Invoice — Korb "${b.name}": ${invoices.length} Rechnung(en)`, body)
      if (mail.sent) anySent = true
    }
    if (anySent) {
      await prisma.basket.update({ where: { id: b.id }, data: { lastNotifiedAt: new Date() } })
      log.push(`${b.name}: Benachrichtigung an ${recipients.length} Mitarbeiter — versendet`)
    } else {
      log.push(`${b.name}: Benachrichtigung — Versand fehlgeschlagen (SMTP prüfen)`)
    }
  }
  return log
}
