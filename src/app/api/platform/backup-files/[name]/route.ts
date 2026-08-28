// Einzeldatei im Sicherungsziel-Verzeichnis: herunterladen (GET) oder
// löschen (DELETE) — siehe api/platform/backup-files/route.ts für die Liste
// und die Scope-Begründung.
import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat, unlink } from 'fs/promises'
import path from 'path'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext } from '@/lib/context'
import { getSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

/**
 * Löst den Dateinamen sicher gegen das konfigurierte Verzeichnis auf —
 * `params.name` ist von Next.js bereits URL-dekodiert. `path.basename`
 * schließt Pfad-Trennzeichen aus; der Vergleich mit dem Original schließt
 * zusätzlich ".."/"." und leere Namen aus (kein Escapen aus dem Verzeichnis
 * möglich, auch nicht über einen manipulierten API-Aufruf).
 */
async function resolveSafePath(rawName: string): Promise<{ dir: string; full: string }> {
  const dir = await getSetting('BACKUP_TARGET_DIR')
  if (!dir) throw new ApiError(404, 'Kein Sicherungsziel konfiguriert.')
  const name = path.basename(rawName)
  if (!name || name !== rawName || name === '.' || name === '..') {
    throw new ApiError(400, 'Ungültiger Dateiname.')
  }
  const resolvedDir = path.resolve(dir)
  const full = path.join(resolvedDir, name)
  if (full !== resolvedDir && !full.startsWith(resolvedDir + path.sep)) {
    throw new ApiError(400, 'Ungültiger Pfad.')
  }
  return { dir: resolvedDir, full }
}

export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  try {
    await getContext({ operator: true })
    const { full } = await resolveSafePath(params.name)
    const st = await stat(full).catch(() => null)
    if (!st || !st.isFile()) throw new ApiError(404, 'Datei nicht gefunden.')
    const buffer = await readFile(full)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${path.basename(full)}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const ctx = await getContext({ operator: true })
    const { full } = await resolveSafePath(params.name)
    const st = await stat(full).catch(() => null)
    if (!st || !st.isFile()) throw new ApiError(404, 'Datei nicht gefunden.')
    await unlink(full)
    await audit({
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BACKUP_FILE_DELETE',
      details: `Datei im Sicherungsziel gelöscht: ${path.basename(full)}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
