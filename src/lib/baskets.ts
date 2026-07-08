// Körbe (Rechnungseingangsverarbeitung, Stefan 2026-07-08): Rechnungen
// wandern durch benannte "Körbe" statt einer einzigen flachen Liste — analog
// zu klassischer Rechnungseingangs-Bearbeitung mit Postkörben je Team/Schritt.
// Jeder Mandant hat automatisch einen Eingangskorb (INBOX) und einen
// Übergabekorb (HANDOVER); dazwischen beliebig viele frei anlegbare Körbe
// (CUSTOM). Optionales Vier-Augen-Gate je Korb: zwei UNTERSCHIEDLICHE
// Mitarbeiter müssen den Wechsel in einen Zielkorb freigeben, bevor er
// ausgeführt wird — unabhängig von der Rechnungsprüfung (4 Häkchen) auf der
// Rechnung selbst.
import { BasketKind, Role } from '@prisma/client'
import { audit } from '@/lib/audit'
import { hasBasketRight } from '@/lib/basketRights'
import { ApiError } from '@/lib/context'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'

/** Legt Eingangs-/Übergabe-/Ablagekorb an, falls für den Mandanten noch nicht vorhanden. */
export async function ensureSystemBaskets(
  tenantId: string,
): Promise<{ inboxId: string; handoverId: string; archiveId: string }> {
  const [inbox, handover, archive] = await Promise.all([
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.INBOX, deletedAt: null } }),
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.HANDOVER, deletedAt: null } }),
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.ARCHIVE, deletedAt: null } }),
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
  // Ablage (Stefan 2026-07-09): landet ganz am Ende, nach dem Übergabekorb —
  // Rechnungen kommen hier automatisch an, sobald sie vollständig übergeben sind.
  const archiveId = archive
    ? archive.id
    : (await prisma.basket.create({
        data: { tenantId, name: 'Ablage', kind: BasketKind.ARCHIVE, position: 1000 },
      })).id
  return { inboxId, handoverId, archiveId }
}

/** Bequemer Zugriff für die Rechnungs-Anlage: liefert nur die Eingangskorb-ID. */
export async function getInboxBasketId(tenantId: string): Promise<string> {
  const { inboxId } = await ensureSystemBaskets(tenantId)
  return inboxId
}

/**
 * Feste Reihenfolge für die Anzeige (Stefan 2026-07-08): Eingangskorb immer
 * zuerst (oben), Übergabekorb an FiBu immer zuletzt (unten) — dazwischen die
 * frei anlegbaren Körbe nach ihrer eigenen `position`. Wird überall verwendet,
 * wo Körbe für die Anzeige geladen werden, statt sich auf eine reine
 * DB-Sortierung nach `position` zu verlassen (die beiden System-Körbe haben
 * zwar auch eine feste position 0/999, aber diese Funktion macht die Regel
 * explizit und ist robust, falls das mal geändert wird).
 */
export function sortBaskets<T extends { kind: BasketKind; position: number }>(baskets: T[]): T[] {
  const rank = (k: BasketKind) =>
    k === BasketKind.INBOX ? 0 : k === BasketKind.HANDOVER ? 2 : k === BasketKind.ARCHIVE ? 3 : 1
  return [...baskets].sort((a, b) => rank(a.kind) - rank(b.kind) || a.position - b.position)
}

export type BasketCounts = {
  unprocessed: number
  processed: number
  total: number
  dueSoon: number
  overdue: number
  /** Ungelesene, an DIESEN Nutzer adressierte Nachrichten in diesem Korb (Stefan 2026-07-08). */
  unreadNotes: number
  /** Vollständig geprüft (Elektronisch+Formal+Sachlich) und noch nicht an die
   * Fibu übergeben (Stefan 2026-07-09) — im Übergabekorb aussagekräftiger als
   * "offen/bearbeitet", das dort nach den Vorprüf-Häkchen zählt. */
  readyForHandover: number
}

// Zahlungsziel-Vorwarnung (Stefan 2026-07-08): "bald fällig" = Zahlungsbedingungs-
// datum (dueDate) liegt innerhalb der nächsten N Tage. Feste Schwelle statt
// Mandanten-Einstellung, damit die Körbe-Kacheln ohne Zusatzkonfiguration sofort
// nutzbar sind — kann bei Bedarf später in ein Tenant-Feld verlegt werden.
const DUE_SOON_DAYS = 7

/**
 * Bearbeitet/unbearbeitet je Korb für Dashboard und Rechnungsliste (Stefan
 * 2026-07-08): "bearbeitet" = mindestens eines der beiden ersten
 * Prüfschritte (Elektronische Vorprüfung ODER Formal richtig) ist gesetzt —
 * die Rechnung wurde also schon angefasst, auch wenn die Buchhaltungs-Schritte
 * (Sachlich richtig/An Buchhaltung übergeben) noch offen sind.
 *
 * "bald fällig"/"überfällig" je Korb (Stefan 2026-07-08): anhand des
 * Zahlungsbedingungsdatums (dueDate). Ausgenommen sind Rechnungen, die per
 * Lastschrift vom Lieferanten selbst abgebucht werden (directDebitByVendor —
 * kein Zahlungsziel, das WIR einhalten müssen) sowie bereits an die
 * Buchhaltung übergebene Rechnungen (checkAccountingAt gesetzt — Fälligkeit
 * ist dann Sache der Fibu, nicht mehr der Körbe-Bearbeitung).
 *
 * `userId` (optional): wenn gesetzt, zusätzlich ungelesene, an DIESEN Nutzer
 * gerichtete Nachrichten je Korb zählen (Stefan 2026-07-08) — dasselbe
 * 💬-Symbol wie in der Rechnungsliste, hier auf Korb-Ebene aggregiert, damit
 * eine Nachricht auffällt, ohne den Korb erst öffnen zu müssen.
 */
export async function getBasketCounts(tenantId: string, userId?: string): Promise<Record<string, BasketCounts>> {
  const now = new Date()
  const soonThreshold = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)
  const [unprocessed, processed, readyForHandover, overdue, dueSoon, unreadNoteRows] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['basketId'],
      where: { tenantId, deletedAt: null, checkElectronicAt: null, checkFormalAt: null },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['basketId'],
      where: {
        tenantId, deletedAt: null,
        OR: [{ checkElectronicAt: { not: null } }, { checkFormalAt: { not: null } }],
      },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['basketId'],
      where: {
        tenantId, deletedAt: null, checkAccountingAt: null,
        checkElectronicAt: { not: null }, checkFormalAt: { not: null }, checkSubstantiveAt: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['basketId'],
      where: {
        tenantId, deletedAt: null, checkAccountingAt: null, directDebitByVendor: false,
        dueDate: { lt: now },
      },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['basketId'],
      where: {
        tenantId, deletedAt: null, checkAccountingAt: null, directDebitByVendor: false,
        dueDate: { gte: now, lte: soonThreshold },
      },
      _count: { _all: true },
    }),
    userId
      ? prisma.invoiceNote.findMany({
          where: { tenantId, toUserId: userId, readAt: null, invoice: { deletedAt: null } },
          select: { invoice: { select: { basketId: true } } },
        })
      : Promise.resolve([]),
  ])
  const result: Record<string, BasketCounts> = {}
  function ensure(basketId: string): BasketCounts {
    if (!result[basketId]) result[basketId] = { unprocessed: 0, processed: 0, total: 0, dueSoon: 0, overdue: 0, unreadNotes: 0, readyForHandover: 0 }
    return result[basketId]
  }
  for (const row of unprocessed) {
    if (!row.basketId) continue
    ensure(row.basketId).unprocessed = row._count._all
    ensure(row.basketId).total += row._count._all
  }
  for (const row of processed) {
    if (!row.basketId) continue
    ensure(row.basketId).processed = row._count._all
    ensure(row.basketId).total += row._count._all
  }
  for (const row of readyForHandover) {
    if (!row.basketId) continue
    ensure(row.basketId).readyForHandover = row._count._all
  }
  for (const row of overdue) {
    if (!row.basketId) continue
    ensure(row.basketId).overdue = row._count._all
  }
  for (const row of dueSoon) {
    if (!row.basketId) continue
    ensure(row.basketId).dueSoon = row._count._all
  }
  for (const row of unreadNoteRows) {
    const basketId = row.invoice.basketId
    if (!basketId) continue
    ensure(basketId).unreadNotes += 1
  }
  return result
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
  userRole: Role,
): Promise<MoveResult> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: {
      id: true, vendor: true, invoiceNumber: true, basketId: true,
      checkElectronicAt: true, checkFormalAt: true, checkSubstantiveAt: true,
    },
  })
  if (!invoice) throw new Error('Rechnung nicht gefunden')

  const target = await prisma.basket.findFirst({ where: { id: targetBasketId, tenantId, deletedAt: null } })
  if (!target) throw new Error('Zielkorb nicht gefunden')

  // Übergabekorb nur bei vollständiger Prüfung erreichbar (Stefan 2026-07-09):
  // der einzige vorgesehene Weg ist der automatische Wechsel, sobald alle
  // drei Häkchen stehen (siehe api/invoices/[id]/route.ts) — ein manuelles
  // Verschieben (Drag&Drop) darf diese Prüfung nicht umgehen können, selbst
  // mit dem HANDOVER-Recht auf dem Ausgangskorb.
  if (target.kind === BasketKind.HANDOVER) {
    const fullyChecked = invoice.checkElectronicAt && invoice.checkFormalAt && invoice.checkSubstantiveAt
    if (!fullyChecked) {
      throw new ApiError(400, 'Diese Rechnung ist noch nicht vollständig geprüft — der Übergabekorb wird erst nach allen drei Häkchen automatisch erreicht.')
    }
  }

  const fromBasket = invoice.basketId
    ? await prisma.basket.findFirst({ where: { id: invoice.basketId, tenantId } })
    : null

  // Korb-Rechte (Stefan 2026-07-08): Verschieben braucht mindestens MOVE auf
  // dem AUSGANGSKORB — bei Verschiebung IN den Übergabekorb sogar HANDOVER
  // (das ist die höhere Stufe "Übergabe an den Übergabekorb"). Ohne
  // Ausgangskorb (Bestandsrechnung ohne basketId) wird nicht eingeschränkt.
  if (fromBasket) {
    const required = target.kind === BasketKind.HANDOVER ? 'HANDOVER' : 'MOVE'
    const allowed = await hasBasketRight(userId, userRole, fromBasket.id, required)
    if (!allowed) {
      throw new ApiError(403, target.kind === BasketKind.HANDOVER
        ? 'Kein Recht zur Übergabe an den Übergabekorb.'
        : 'Kein Recht zum Verschieben aus diesem Korb.')
    }
  }

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
    // ARCHIVE ausgeschlossen (Stefan 2026-07-09): fester Endlager-Korb ohne
    // Bearbeitung — eine Erinnerungsmail ergibt dort keinen Sinn. Bereits vor
    // dieser Änderung aktivierte Flags werden hier defensiv mit ausgefiltert.
    where: { notificationEnabled: true, deletedAt: null, kind: { not: BasketKind.ARCHIVE } },
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
