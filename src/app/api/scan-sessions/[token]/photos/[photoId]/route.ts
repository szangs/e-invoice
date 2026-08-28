// Rohe Foto-Bytes herunterladen — von der PC-Seite genutzt, um jedes neu
// gemeldete Foto zu holen und (bei aktiver Verschlüsselung) lokal mit dem
// sitzungseigenen Einmal-Schlüssel zu entschlüsseln. Token-geschützt wie
// die Nachbar-Routen, kein Login nötig.
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { ApiError } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getValidScanSession } from '@/lib/scanSession'
import { readScanSessionPhoto } from '@/lib/storage'

export async function GET(_req: NextRequest, { params }: { params: { token: string; photoId: string } }) {
  try {
    const session = await getValidScanSession(params.token)
    const photo = await prisma.scanSessionPhoto.findFirst({
      where: { id: params.photoId, sessionId: session.id },
    })
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.')
    const buffer = await readScanSessionPhoto(session.tenantId, session.id, photo.fileName)
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        // Verschlüsselte Fotos sind für den Server ohnehin nur Chiffrat —
        // kein Sinn, hier einen Bild-MIME-Typ vorzutäuschen.
        'Content-Type': photo.encrypted ? 'application/octet-stream' : photo.mimeType,
        'X-Photo-Encrypted': photo.encrypted ? '1' : '0',
        'X-Photo-Mime': photo.mimeType,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
