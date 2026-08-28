// Zertifikat-PDF für einen abgeschlossenen Audit-Zeitraum DIESES Mandanten
// (Stefan 2026-08-27) — wird bei jedem Aufruf deterministisch aus der
// gespeicherten Closure neu gerendert statt als Datei abgelegt.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { buildAuditCertificatePdf } from '@/lib/auditCertificate'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { year: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const year = Number(params.year)
    const closure = await prisma.auditPeriodClosure.findUnique({ where: { tenantId_year: { tenantId, year } } })
    if (!closure) throw new ApiError(404, 'Für dieses Jahr liegt kein Abschluss vor.')

    const pdf = await buildAuditCertificatePdf({ ...closure, tenantName: ctx.tenantName ?? '' })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Audit-Zertifikat-${year}.pdf"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
