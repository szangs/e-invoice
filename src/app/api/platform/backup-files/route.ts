// Dateimanager fürs Sicherungsziel-Verzeichnis (Stefan 2026-08-27, Review-
// Fund "unter dem Systemadmin einen Dateimanager einbauen") — bewusst NUR
// das konfigurierte BACKUP_TARGET_DIR (bisher ausschließlich per SSH
// einsehbar, sobald die automatische System-/Mandanten-Sicherung dorthin
// schreibt, siehe lib/backup.ts), NICHT ein allgemeiner Datei-Browser über
// beliebige Server-Pfade — bewusste Scope-Entscheidung (geringstes Risiko
// bei kompromittiertem Betreiber-Konto, siehe AskUserQuestion-Antwort).
import { NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import path from 'path'
import { jsonError } from '@/lib/api'
import { getContext } from '@/lib/context'
import { getSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export type BackupFileEntry = { name: string; sizeBytes: number; mtime: string }

export async function GET() {
  try {
    await getContext({ operator: true })
    const dir = await getSetting('BACKUP_TARGET_DIR')
    if (!dir) return NextResponse.json({ dir: null, files: [] })

    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (e) {
      return NextResponse.json({
        dir,
        files: [],
        error: `Verzeichnis nicht lesbar (${e instanceof Error ? e.message : String(e)})`,
      })
    }

    const files = (
      await Promise.all(
        entries.map(async (name): Promise<BackupFileEntry | null> => {
          try {
            const st = await stat(path.join(dir, name))
            if (!st.isFile()) return null
            return { name, sizeBytes: st.size, mtime: st.mtime.toISOString() }
          } catch {
            return null
          }
        }),
      )
    ).filter((f): f is BackupFileEntry => f !== null)
    files.sort((a, b) => b.mtime.localeCompare(a.mtime))

    return NextResponse.json({ dir, files })
  } catch (e) {
    return jsonError(e)
  }
}
