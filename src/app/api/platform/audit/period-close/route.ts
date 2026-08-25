// Perioden-Abschluss des Audit-Protokolls (§18, Stefan 2026-08-25): sealt
// ein vollständig abgelaufenes Kalenderjahr — siehe lib/auditClosure.ts für
// die Auswirkung (gesperrte Belege) und lib/auditCertificate.ts fürs Zertifikat.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({
  year: z.number().int().min(2000).max(2100),
  closedByName: z.string().trim().min(2, 'Bitte einen Namen als Unterschrift eingeben.').max(200),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ operator: true })
    const { year, closedByName } = schema.parse(await req.json())

    // Nur vollständig abgelaufene Jahre dürfen abgeschlossen werden — sonst
    // könnten danach noch Ereignisse aus demselben Jahr entstehen, die dann
    // NICHT mehr Teil der versiegelten Periode wären (widerspräche dem Sinn
    // eines Periodenabschlusses).
    const periodEnd = new Date(year + 1, 0, 1)
    if (new Date() < periodEnd) {
      throw new ApiError(400, `Das Jahr ${year} ist noch nicht vollständig abgelaufen.`)
    }

    const existing = await prisma.auditPeriodClosure.findUnique({ where: { year } })
    if (existing) {
      throw new ApiError(409, `Jahr ${year} wurde bereits am ${existing.closedAt.toLocaleDateString('de-DE')} abgeschlossen.`)
    }

    const periodStart = new Date(year, 0, 1)
    const [firstEntry, lastEntry, entryCount] = await Promise.all([
      prisma.auditLog.findFirst({
        where: { createdAt: { gte: periodStart, lt: periodEnd } },
        orderBy: { id: 'asc' },
        select: { id: true },
      }),
      // Letzter Eintrag der GESAMTEN Kette bis Periodenende (nicht nur dieses
      // Jahr) — dessen Hash bezeugt durch die Verkettung bereits alle
      // vorangegangenen Einträge, auch aus früheren, noch nicht abgeschlossenen Jahren.
      prisma.auditLog.findFirst({
        where: { createdAt: { lt: periodEnd } },
        orderBy: { id: 'desc' },
        select: { id: true, hash: true },
      }),
      prisma.auditLog.count({ where: { createdAt: { gte: periodStart, lt: periodEnd } } }),
    ])
    if (!lastEntry) {
      throw new ApiError(400, `Keine Audit-Einträge bis Ende ${year} vorhanden — nichts abzuschließen.`)
    }

    const closure = await prisma.auditPeriodClosure.create({
      data: {
        year,
        closedByName,
        closedByEmail: ctx.email,
        entryCount,
        firstEntryId: firstEntry?.id ?? null,
        lastEntryId: lastEntry.id,
        chainHash: lastEntry.hash,
      },
    })

    // Der Abschluss selbst wird protokolliert wie jede andere Betreiber-Aktion
    // — bewusst NACH dem Erstellen der Closure, damit dieser Eintrag nicht
    // versehentlich Teil der gerade versiegelten Periode wird.
    await audit({
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'AUDIT_PERIOD_CLOSE',
      details: `Audit-Protokoll für ${year} abgeschlossen (${entryCount} Einträge im Jahr, Kette bis Eintrag #${lastEntry.id}) — unterschrieben von "${closedByName}"`,
    })

    return NextResponse.json({ ok: true, closure })
  } catch (e) {
    return jsonError(e)
  }
}
