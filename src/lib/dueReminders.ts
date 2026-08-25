// Fälligkeits-Benachrichtigung ("Bearbeitungswarnung"), pro Mandant einstellbar
// (Tenant.dueReminderDaysAfterReceipt / dueReminderDaysBeforeDue). Zwei Fälle,
// je nachdem ob die Fälligkeit bekannt ist:
//   A) UNBEKANNT (kein dueDate — weder E-Rechnung noch KI-Erkennung hatte eins):
//      Erinnerung X Tage NACH Eingang (wir wissen ja nicht, wann sie fällig ist).
//   B) BEKANNT (dueDate gesetzt — E-Rechnung und KI-erkannte Fälligkeit werden
//      hier bewusst gleich behandelt, die Herkunft des Datums spielt keine Rolle):
//      Erinnerung X Tage VOR Fälligkeit.
// Ausgenommen: per Lastschrift vom Lieferanten selbst abgebuchte Rechnungen
// (kein Zahlungsziel, das wir einhalten müssen) und bereits an die Buchhaltung
// übergebene (Fälligkeit ist dann Sache der Fibu) — dieselben Ausschlüsse wie
// bei "bald fällig"/"überfällig" in getBasketCounts (lib/baskets.ts).
// Empfänger: dieselben Korb-Mitarbeiter wie bei der Korb-Sammel-Benachrichtigung
// (Basket.members) — eine Mail pro Mitarbeiter mit allen fälligen Rechnungen
// SEINES Korbs. Wird nur EINMAL pro Rechnung verschickt (dueReminderSentAt),
// keine wiederholte Eskalation.
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'

export async function runDueReminders(): Promise<string[]> {
  const log: string[] = []
  const now = new Date()

  const tenants = await prisma.tenant.findMany({
    where: {
      active: true,
      OR: [{ dueReminderDaysAfterReceipt: { not: null } }, { dueReminderDaysBeforeDue: { not: null } }],
    },
  })
  if (tenants.length === 0) return ['Kein Mandant hat eine Fälligkeits-Benachrichtigung aktiviert.']

  for (const tenant of tenants) {
    const orConditions: { dueDate: null | { not: null; lte: Date }; createdAt?: { lte: Date } }[] = []
    if (tenant.dueReminderDaysAfterReceipt) {
      const receivedBefore = new Date(now.getTime() - tenant.dueReminderDaysAfterReceipt * 24 * 60 * 60 * 1000)
      orConditions.push({ dueDate: null, createdAt: { lte: receivedBefore } })
    }
    if (tenant.dueReminderDaysBeforeDue) {
      const dueBefore = new Date(now.getTime() + tenant.dueReminderDaysBeforeDue * 24 * 60 * 60 * 1000)
      orConditions.push({ dueDate: { not: null, lte: dueBefore } })
    }
    if (orConditions.length === 0) continue

    const invoices = await prisma.invoice.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        checkAccountingAt: null,
        directDebitByVendor: false,
        dueReminderSentAt: null,
        basketId: { not: null },
        OR: orConditions,
      },
      include: {
        basket: { include: { members: { include: { user: { select: { email: true, active: true } } } } } },
      },
    })
    if (invoices.length === 0) continue

    // Gruppieren nach Korb: EINE Mail pro Mitarbeiter mit allen fälligen
    // Rechnungen seines Korbs statt einer Mail je Rechnung.
    const byBasket = new Map<string, typeof invoices>()
    for (const inv of invoices) {
      if (!inv.basketId) continue
      const list = byBasket.get(inv.basketId) ?? []
      list.push(inv)
      byBasket.set(inv.basketId, list)
    }

    for (const list of Array.from(byBasket.values())) {
      const basket = list[0].basket
      if (!basket) continue
      const recipients = basket.members.map((m) => m.user).filter((u) => u.active)
      if (recipients.length === 0) {
        log.push(`${tenant.name} / ${basket.name}: ${list.length} fällige Rechnung(en), aber keine Mitarbeiter für Benachrichtigungen zugeordnet — übersprungen`)
        continue
      }
      const body =
        `Guten Tag,\n\nfür folgende Rechnung(en) in Korb "${basket.name}" (${tenant.name}) steht eine ` +
        `Fälligkeitsprüfung an:\n\n` +
        list
          .map((i) => {
            const reason = i.dueDate
              ? `fällig am ${i.dueDate.toISOString().slice(0, 10)}`
              : `Eingang am ${i.createdAt.toISOString().slice(0, 10)}, Fälligkeit unbekannt`
            return `- ${i.docId ?? '—'} · ${i.vendor}${i.invoiceNumber ? ' · ' + i.invoiceNumber : ''} (${reason})`
          })
          .join('\n') +
        `\n\nBitte zeitnah bearbeiten.\n`
      let anySent = false
      for (const r of recipients) {
        const mail = await sendSystemMail(r.email, `E-Invoice — Fälligkeitswarnung: ${list.length} Rechnung(en) in "${basket.name}"`, body)
        if (mail.sent) anySent = true
      }
      if (anySent) {
        await prisma.invoice.updateMany({ where: { id: { in: list.map((i) => i.id) } }, data: { dueReminderSentAt: now } })
        log.push(`${tenant.name} / ${basket.name}: Fälligkeitswarnung für ${list.length} Rechnung(en) an ${recipients.length} Mitarbeiter versendet`)
      } else {
        log.push(`${tenant.name} / ${basket.name}: Fälligkeitswarnung — Versand fehlgeschlagen (SMTP/Mailversand prüfen)`)
      }
    }
  }
  return log
}
