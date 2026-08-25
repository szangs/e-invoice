// Zertifikat-PDF für einen abgeschlossenen Audit-Zeitraum — wird bei jedem
// Aufruf deterministisch aus der gespeicherten Closure neu gerendert statt
// als Datei abgelegt (keine Duplikation, immer aktuelles Layout).
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { buildAuditCertificatePdf } from '@/lib/auditCertificate'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { year: string } }) {
  try {
    await getContext({ operator: true })
    const year = Number(params.year)
    const closure = await prisma.auditPeriodClosure.findUnique({ where: { year } })
    if (!closure) throw new ApiError(404, 'Für dieses Jahr liegt kein Abschluss vor.')

    const pdf = await buildAuditCertificatePdf(closure)
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
