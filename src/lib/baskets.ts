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
import { isInvoiceLockedByClosure } from '@/lib/auditClosure'
import { getBasketRightMap, hasBasketRight, RIGHT_RANK } from '@/lib/basketRights'
import { ApiError } from '@/lib/context'
import { prisma } from '@/lib/db'
import { buyerNameMismatch, parseInvoiceXml } from '@/lib/erechnung'
import { assertNotHandedOffToSomeoneElse } from '@/lib/invoiceHandoff'
import { sendSystemMail } from '@/lib/mail'

/** Legt Eingangs-/Übergabe-/Ablage-/Spam-Verdacht-Korb an, falls für den Mandanten noch nicht vorhanden. */
export async function ensureSystemBaskets(
  tenantId: string,
): Promise<{ inboxId: string; handoverId: string; archiveId: string; quarantineId: string }> {
  const [inbox, handover, archive, quarantine] = await Promise.all([
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.INBOX, deletedAt: null } }),
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.HANDOVER, deletedAt: null } }),
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.ARCHIVE, deletedAt: null } }),
    prisma.basket.findFirst({ where: { tenantId, kind: BasketKind.QUARANTINE, deletedAt: null } }),
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
  // Spam-Verdacht (Stefan 2026-08-25): Mail-Eingang-Dokumente, die die
  // automatische Klassifikation eindeutig als KEINE Rechnung einstuft,
  // landen hier statt im Eingangskorb (siehe lib/mailin.ts).
  const quarantineId = quarantine
    ? quarantine.id
    : (await prisma.basket.create({
        data: { tenantId, name: 'Spam/Fehlleitung', kind: BasketKind.QUARANTINE, position: 500 },
      })).id
  return { inboxId, handoverId, archiveId, quarantineId }
}

/** Bequemer Zugriff für die Rechnungs-Anlage: liefert nur die Eingangskorb-ID. */
export async function getInboxBasketId(tenantId: string): Promise<string> {
  const { inboxId } = await ensureSystemBaskets(tenantId)
  return inboxId
}

/** Bequemer Zugriff für den Mail-Eingang: liefert nur die Spam-Verdacht-Korb-ID. */
export async function getQuarantineBasketId(tenantId: string): Promise<string> {
  const { quarantineId } = await ensureSystemBaskets(tenantId)
  return quarantineId
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
    k === BasketKind.INBOX
      ? 0
      : k === BasketKind.HANDOVER
        ? 3
        : k === BasketKind.ARCHIVE
          ? 4
          : k === BasketKind.QUARANTINE
            ? 2
            : 1 // CUSTOM
  return [...baskets].sort((a, b) => rank(a.kind) - rank(b.kind) || a.position - b.position)
}

export type BasketCounts = {
  unprocessed: number
  processed: number
  total: number
  dueSoon: number
  overdue: number
  /** Offene (nicht als erledigt markierte) Nachrichten in diesem Korb, an
   * DIESEN Nutzer adressiert oder "an alle" (Stefan 2026-07-08, erweitert
   * 2026-08-26 um den Erledigt-Status statt nur den Lesestatus). */
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
 * `userId` (optional): wenn gesetzt, zusätzlich offene (nicht erledigte), an
 * DIESEN Nutzer oder "an alle" gerichtete Nachrichten je Korb zählen (Stefan
 * 2026-07-08, erweitert 2026-08-26) — dasselbe 💬-Symbol wie in der
 * Rechnungsliste, hier auf Korb-Ebene aggregiert, damit eine Nachricht
 * auffällt, ohne den Korb erst öffnen zu müssen. Zählt bewusst bis zum
 * Erledigt-Haken, nicht nur bis zum ersten Lesen.
 *
 * `role` (Stefan 2026-08-26, Review-Fund): Ergebnis wird auf Körbe mit
 * mindestens CONTENT-Recht eingeschränkt — vorher lieferte diese Funktion
 * ungefiltert Zahlen (unbearbeitet/überfällig/etc.) für ALLE Körbe des
 * Mandanten, auch für Körbe, die der Nutzer nur mit VIEW (Kachel sichtbar,
 * Inhalt aber gesperrt) sieht. Die Kacheln selbst wurden zwar schon nach
 * VIEW gefiltert (dashboard/page.tsx, invoices/page.tsx), die angezeigten
 * ZAHLEN darauf kamen aber weiterhin aus dieser ungefilterten Quelle — ein
 * echtes Datenleck (Rückschluss auf Menge/Dringlichkeit fremder Rechnungen).
 */
export async function getBasketCounts(tenantId: string, userId: string, role: Role): Promise<Record<string, BasketCounts>> {
  const now = new Date()
  const soonThreshold = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)
  const [unprocessed, processed, readyForHandover, overdue, dueSoon, unreadNoteRows, rightMap] = await Promise.all([
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
          where: {
            tenantId,
            doneAt: null,
            OR: [{ toUserId: userId }, { toUserId: null }],
            invoice: { deletedAt: null },
          },
          select: { invoice: { select: { basketId: true } } },
        })
      : Promise.resolve([]),
    getBasketRightMap(tenantId, userId, role),
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
  // Rechte-Filter (Stefan 2026-08-26, Review-Fund) — siehe Kommentar oben an
  // der Funktion: nur Körbe mit mindestens CONTENT-Recht behalten ihre Zahlen,
  // alles andere raus, statt es den Aufrufern zu überlassen, das zu filtern.
  for (const basketId of Object.keys(result)) {
    if ((rightMap[basketId] ?? 0) < RIGHT_RANK.CONTENT) delete result[basketId]
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
      id: true, vendor: true, invoiceNumber: true, basketId: true, createdAt: true,
      checkElectronicAt: true, checkFormalAt: true, checkSubstantiveAt: true,
      aiAssisted: true, aiConfirmedAt: true, supersededAt: true,
      xmlData: true, buyerNameMismatchAcknowledged: true,
    },
  })
  if (!invoice) throw new Error('Rechnung nicht gefunden')

  // Perioden-Abschluss (§18, Stefan 2026-08-25): Belege aus einem
  // abgeschlossenen Jahr dürfen auch nicht mehr zwischen Körben verschoben
  // werden (siehe lib/auditClosure.ts).
  if (await isInvoiceLockedByClosure(tenantId, invoice.createdAt)) {
    throw new ApiError(423, `Diese Rechnung gehört zum abgeschlossenen Prüfungszeitraum ${invoice.createdAt.getFullYear()} und ist schreibgeschützt.`)
  }
  // "Zur Prüfung weitergeben" (Stefan 2026-08-27, siehe lib/invoiceHandoff.ts)
  // — solange aktiv, darf nur der Empfänger verschieben.
  await assertNotHandedOffToSomeoneElse(invoice.id, userId)
  // Rechnungsversionierung (Stefan 2026-08-25): eine ältere, bereits
  // überholte Version darf ebenfalls nicht mehr verschoben werden — die
  // aktuelle Version übernimmt den Workflow.
  if (invoice.supersededAt) {
    throw new ApiError(423, 'Diese Rechnung wurde durch eine neuere Version ersetzt und ist schreibgeschützt.')
  }

  // KI-erkannte Werte müssen erst von einem Menschen bestätigt werden (Tab-
  // Bestätigungs-Flow im Formular), bevor die Rechnung irgendwohin verschoben
  // werden darf — verhindert, dass eine ungeprüfte KI-Vermutung unbemerkt
  // weiterläuft (siehe InvoiceEditForm.tsx / lib/mailin.ts).
  if (invoice.aiAssisted && !invoice.aiConfirmedAt) {
    throw new ApiError(400, 'Von der KI erkannte Werte müssen erst bestätigt werden, bevor die Rechnung verschoben werden kann.')
  }

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
    // Rechnungsempfänger-Abgleich (Stefan 2026-08-25, Tenant.legalName) —
    // optional, per Mandanten-Einstellung: eine unbestätigte Abweichung
    // sperrt die Übergabe an die Fibu, bis sie per "Passt trotzdem"
    // akzeptiert wurde (siehe BuyerNameMismatchWarning.tsx). Nur bei
    // E-Rechnung prüfbar (buyerName kommt strukturiert aus dem XML).
    if (!invoice.buyerNameMismatchAcknowledged && invoice.xmlData) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { legalName: true, buyerNameMismatchBlocksHandover: true } })
      if (tenant?.buyerNameMismatchBlocksHandover) {
        const parsed = parseInvoiceXml(invoice.xmlData)
        if (parsed && buyerNameMismatch(tenant.legalName, parsed.data.buyerName)) {
          throw new ApiError(400, `Rechnungsempfänger weicht von der hinterlegten Firmenbezeichnung „${tenant.legalName}" ab — bitte auf der Detailseite prüfen und ggf. "Passt trotzdem" bestätigen, bevor an die Fibu übergeben wird.`)
        }
      }
    }
  }

  const fromBasket = invoice.basketId
    ? await prisma.basket.findFirst({ where: { id: invoice.basketId, tenantId } })
    : null

  // Korb-Rechte (Stefan 2026-07-08): Verschieben braucht mindestens MOVE auf
  // dem AUSGANGSKORB — bei Verschiebung IN den Übergabekorb sogar HANDOVER
  // (das ist die höhere Stufe "Übergabe an den Übergabekorb").
  if (fromBasket) {
    const required = target.kind === BasketKind.HANDOVER ? 'HANDOVER' : 'MOVE'
    const allowed = await hasBasketRight(userId, userRole, fromBasket.id, required)
    if (!allowed) {
      throw new ApiError(403, target.kind === BasketKind.HANDOVER
        ? 'Kein Recht zur Übergabe an den Übergabekorb.'
        : 'Kein Recht zum Verschieben aus diesem Korb.')
    }

    // Belegfluss (Stefan 2026-08-25): solange für den Ausgangskorb KEIN
    // Eintrag existiert, bleibt das Verschieben uneingeschränkt (Opt-in, kein
    // Bruch für bestehende Mandanten) — siehe BasketAdmin.tsx.
    const allowedTargets = await prisma.basketTransition.findMany({
      where: { fromBasketId: fromBasket.id },
      select: { toBasketId: true },
    })
    if (allowedTargets.length > 0 && !allowedTargets.some((t) => t.toBasketId === targetBasketId)) {
      throw new ApiError(400, `Verschieben von "${fromBasket.name}" nach "${target.name}" ist im Belegfluss nicht vorgesehen.`)
    }
  } else {
    // Ohne Ausgangskorb (Bestandsrechnung ohne basketId, aus der Zeit vor den
    // Körben) gibt es keinen Ausgangskorb, dessen Recht man prüfen könnte —
    // vorher blieb das Verschieben deshalb komplett uneingeschränkt (Stefan
    // 2026-08-26, Review-Fund "korblose Rechnungen umgehen Korb-Rechte"): ein
    // Nutzer ganz ohne jedes Korb-Recht konnte so direkt in einen beliebigen
    // Korb verschieben, inklusive Übergabekorb. Stattdessen jetzt mindestens
    // dasselbe Recht auf dem ZIELKORB verlangen wie bei einem normalen
    // Verschieben dorthin.
    const required = target.kind === BasketKind.HANDOVER ? 'HANDOVER' : 'MOVE'
    const allowed = await hasBasketRight(userId, userRole, target.id, required)
    if (!allowed) {
      throw new ApiError(403, target.kind === BasketKind.HANDOVER
        ? 'Kein Recht zur Übergabe an den Übergabekorb.'
        : 'Kein Recht, in diesen Korb zu verschieben.')
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
  const now = new Date()
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
      select: { docId: true, vendor: true, invoiceNumber: true, createdAt: true, dueDate: true, directDebitByVendor: true, checkAccountingAt: true },
    })
    // Fälligkeit direkt in die Korb-Sammelmail integriert (Stefan 2026-08-26,
    // "eine Benachrichtigung statt zwei" — ersetzt die vorherige separate
    // lib/dueReminders.ts) — dieselbe Definition von "überfällig"/"bald
    // fällig" (DUE_SOON_DAYS, dieselben Ausnahmen) wie die Kachel-Zahlen in
    // getBasketCounts oben, damit App-weit ein einheitlicher Maßstab gilt.
    // Direktabbucher und schon an die Fibu übergebene Rechnungen zählen nie
    // als fällig (kein Zahlungsziel, das WIR einhalten müssen, bzw. nicht
    // mehr Sache der Körbe-Bearbeitung).
    const soonThreshold = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)
    const urgency = (i: (typeof invoices)[number]): 'overdue' | 'soon' | null => {
      if (!i.dueDate || i.directDebitByVendor || i.checkAccountingAt) return null
      if (i.dueDate < now) return 'overdue'
      if (i.dueDate <= soonThreshold) return 'soon'
      return null
    }
    const overdueList = invoices.filter((i) => urgency(i) === 'overdue')
    const soonList = invoices.filter((i) => urgency(i) === 'soon')
    const restList = invoices.filter((i) => urgency(i) === null)
    const line = (i: (typeof invoices)[number]): string => {
      const u = urgency(i)
      const mark = u === 'overdue' ? '⚠ ÜBERFÄLLIG — ' : u === 'soon' ? '⚠ bald fällig — ' : ''
      const due = i.dueDate ? ` (fällig ${i.dueDate.toISOString().slice(0, 10)})` : ''
      return `- ${mark}${i.docId ?? '—'} · ${i.vendor}${i.invoiceNumber ? ' · ' + i.invoiceNumber : ''}${due}`
    }
    const urgencyNote =
      overdueList.length > 0 || soonList.length > 0
        ? `Davon ${overdueList.length} überfällig, ${soonList.length} bald fällig.\n\n`
        : ''
    const body =
      `Guten Tag,\n\nin Korb "${b.name}" (${b.tenant.name}) liegen aktuell ${invoices.length} Rechnung(en):\n\n` +
      urgencyNote +
      [...overdueList, ...soonList, ...restList].map(line).join('\n') +
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
