// Öffentlicher Download-Link für Sicherungspakete (Stefan 2026-07-08): das
// Zufalls-Token selbst ist der Berechtigungsnachweis (wie ein signierter
// Link) — kein Anmelde-Kontext nötig, damit der Link auch aus einer
// E-Mail-App heraus ohne Login funktioniert. Erster Abruf markiert das Paket
// als heruntergeladen (beendet die Erinnerungs-Mails).
import { NextRequest, NextResponse } from 'next/server'
import { audit } from '@/lib/audit'
import { readBackupPackageFile } from '@/lib/backupPackage'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const pkg = await prisma.backupPackage.findUnique({ where: { downloadToken: params.token } })
  if (!pkg) {
    return NextResponse.json({ error: 'Unbekannter oder ungültiger Download-Link.' }, { status: 404 })
  }
  if (pkg.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Dieser Download-Link ist abgelaufen.' }, { status: 410 })
  }

  let buffer: Buffer
  try {
    buffer = await readBackupPackageFile(pkg)
  } catch {
    return NextResponse.json({ error: 'Datei nicht (mehr) auf dem Server vorhanden.' }, { status: 404 })
  }

  if (!pkg.downloadedAt) {
    await prisma.backupPackage.update({ where: { id: pkg.id }, data: { downloadedAt: new Date() } })
    await audit({
      tenantId: pkg.tenantId,
      actorName: 'Download-Link',
      action: 'BACKUP_DOWNLOADED',
      details: `Sicherungspaket ${pkg.originalName} heruntergeladen (SHA-256 ${pkg.sha256.slice(0, 16)}…)`,
    })
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${pkg.originalName}"`,
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
