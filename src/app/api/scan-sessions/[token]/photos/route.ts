// Foto-Upload (Handy) + Abfrage neuer Fotos (PC-Polling) — beides bewusst
// nur token-geschützt, kein Login (siehe [token]/route.ts). Der eigentliche
// Datei-Inhalt ist bei aktiver Verschlüsselung bereits im Handy-Browser mit
// dem sitzungseigenen Einmal-Schlüssel verschlüsselt worden (siehe
// scan-pair/[token]/page.tsx) — dieser Server bekommt hier nie den
// Schlüssel und bei aktiver Verschlüsselung nie den Klartext zu Gesicht.
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { ApiError } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getValidScanSession, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_SESSION } from '@/lib/scanSession'
import { saveScanSessionPhoto } from '@/lib/storage'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const session = await getValidScanSession(params.token)
    const count = await prisma.scanSessionPhoto.count({ where: { sessionId: session.id } })
    if (count >= MAX_PHOTOS_PER_SESSION) {
      throw new ApiError(429, `Maximal ${MAX_PHOTOS_PER_SESSION} Fotos pro Sitzung — bitte am PC übernehmen und ggf. eine neue Sitzung starten.`)
    }
    const form = await req.formData()
    const file = form.get('file')
    const mimeType = String(form.get('mimeType') ?? 'application/octet-stream')
    const encrypted = form.get('encrypted') === '1'
    if (!(file instanceof Blob)) throw new ApiError(400, 'Keine Datei übermittelt.')
    if (file.size > MAX_PHOTO_BYTES) throw new ApiError(413, 'Foto zu groß.')
    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = await saveScanSessionPhoto(session.tenantId, session.id, buffer)
    const photo = await prisma.scanSessionPhoto.create({
      data: { sessionId: session.id, fileName, mimeType, encrypted },
    })
    return NextResponse.json({ id: photo.id, createdAt: photo.createdAt })
  } catch (e) {
    return jsonError(e)
  }
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const session = await getValidScanSession(params.token)
    const since = req.nextUrl.searchParams.get('since')
    const photos = await prisma.scanSessionPhoto.findMany({
      where: {
        sessionId: session.id,
        ...(since ? { createdAt: { gt: new Date(since) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, mimeType: true, encrypted: true, createdAt: true },
    })
    return NextResponse.json({ photos })
  } catch (e) {
    return jsonError(e)
  }
}
