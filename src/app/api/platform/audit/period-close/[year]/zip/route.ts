// ZIP-Paket zu einem abgeschlossenen Audit-Zeitraum: Zertifikat-PDF + CSV-
// Export aller Audit-Einträge des Jahres, zum vollständigen Archivieren.
import AdmZip from 'adm-zip'
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { buildAuditCertificatePdf } from '@/lib/auditCertificate'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

function csvEscape(v: string): string {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export async function GET(_req: NextRequest, { params }: { params: { year: string } }) {
  try {
    await getContext({ operator: true })
    const year = Number(params.year)
    const closure = await prisma.auditPeriodClosure.findUnique({ where: { year } })
    if (!closure) throw new ApiError(404, 'Für dieses Jahr liegt kein Abschluss vor.')

    const periodStart = new Date(year, 0, 1)
    const periodEnd = new Date(year + 1, 0, 1)
    const [entries, tenants] = await Promise.all([
      prisma.auditLog.findMany({
        where: { createdAt: { gte: periodStart, lt: periodEnd } },
        orderBy: { id: 'asc' },
      }),
      prisma.tenant.findMany({ select: { id: true, name: true } }),
    ])
    const tenantName = new Map(tenants.map((t) => [t.id, t.name]))

    const header = ['ID', 'Zeit', 'Aktion', 'Mandant', 'Akteur', 'Details', 'PrevHash', 'Hash'].join(';')
    const rows = entries.map((e) =>
      [
        String(e.id),
        e.createdAt.toISOString(),
        e.action,
        e.tenantId ? (tenantName.get(e.tenantId) ?? e.tenantId) : '',
        e.actorName,
        e.details ?? '',
        e.prevHash,
        e.hash,
      ]
        .map(csvEscape)
        .join(';'),
    )
    const csv = [header, ...rows].join('\n')

    const pdf = await buildAuditCertificatePdf(closure)

    const zip = new AdmZip()
    zip.addFile(`Audit-Zertifikat-${year}.pdf`, Buffer.from(pdf))
    zip.addFile(`Audit-Protokoll-${year}.csv`, Buffer.from(csv, 'utf8'))
    zip.addFile(
      'LIESMICH.txt',
      Buffer.from(
        `Audit-Protokoll-Archiv ${year}\n\n` +
          `Enthält das Abschluss-Zertifikat sowie alle ${entries.length} Audit-Protokoll-Einträge dieses Jahres als CSV.\n` +
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
