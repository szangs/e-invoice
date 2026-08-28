// ZIP-Paket zu einem abgeschlossenen Audit-Zeitraum DIESES Mandanten
// (Stefan 2026-08-27): Zertifikat-PDF + CSV-Export aller Audit-Einträge des
// Mandanten in diesem Jahr, zum vollständigen Archivieren.
import AdmZip from 'adm-zip'
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { buildAuditCertificatePdf } from '@/lib/auditCertificate'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

function csvEscape(v: string): string {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export async function GET(_req: NextRequest, { params }: { params: { year: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const year = Number(params.year)
    const closure = await prisma.auditPeriodClosure.findUnique({ where: { tenantId_year: { tenantId, year } } })
    if (!closure) throw new ApiError(404, 'Für dieses Jahr liegt kein Abschluss vor.')

    const periodStart = new Date(year, 0, 1)
    const periodEnd = new Date(year + 1, 0, 1)
    const entries = await prisma.auditLog.findMany({
      where: { tenantId, createdAt: { gte: periodStart, lt: periodEnd } },
      orderBy: { id: 'asc' },
    })

    // Kein "Mandant"-Spalte mehr nötig — anders als im früheren, systemweiten
    // Betreiber-Export sind hier immer nur die Einträge EINES Mandanten enthalten.
    const header = ['ID', 'Zeit', 'Aktion', 'Akteur', 'Details', 'PrevHash', 'Hash'].join(';')
    const rows = entries.map((e) =>
      [e.id.toString(), e.createdAt.toISOString(), e.action, e.actorName, e.details ?? '', e.prevHash, e.hash]
        .map(csvEscape)
        .join(';'),
    )
    const csv = [header, ...rows].join('\n')

    const tenantName = ctx.tenantName ?? ''
    const pdf = await buildAuditCertificatePdf({ ...closure, tenantName })

    const zip = new AdmZip()
    zip.addFile(`Audit-Zertifikat-${year}.pdf`, Buffer.from(pdf))
    zip.addFile(`Audit-Protokoll-${year}.csv`, Buffer.from(csv, 'utf8'))
    zip.addFile(
      'LIESMICH.txt',
      Buffer.from(
        `Audit-Protokoll-Archiv ${year} · ${tenantName}\n\n` +
          `Enthält das Abschluss-Zertifikat sowie alle ${entries.length} Audit-Protokoll-Einträge dieses Mandanten aus diesem Jahr als CSV.\n` +
          `Abgeschlossen am ${closure.closedAt.toLocaleString('de-DE')} von "${closure.closedByName}" (${closure.closedByEmail}).\n` +
          `Prüfsumme der Kette bis zu diesem Zeitpunkt (Eintrag #${closure.lastEntryId}): ${closure.chainHash}\n`,
        'utf8',
      ),
    )

    return new NextResponse(new Uint8Array(zip.toBuffer()), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="Audit-Archiv-${year}.zip"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
