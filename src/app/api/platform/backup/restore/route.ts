// Betreiber-Rücksicherung (§17): Mandant (per tenantId) oder Gesamtsystem
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { MAX_RESTORE_BYTES, restoreSystemBackup, restoreTenantBackup } from '@/lib/backup'
import { ApiError, getContext } from '@/lib/context'

export async function POST(req: NextRequest) {
  try {
    await getContext({ operator: true })
    const form = await req.formData()
    const file = form.get('file')
    const tenantId = String(form.get('tenantId') ?? '')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Sicherungsdatei erhalten.')
    if (file.size > MAX_RESTORE_BYTES) throw new ApiError(400, 'Sicherung zu groß (max. 50 MB).')
    let payload: { kind?: string }
    try {
      payload = JSON.parse(Buffer.from(await file.arrayBuffer()).toString('utf8'))
    } catch {
      throw new ApiError(400, 'Ungültiges Format — Datei ist kein gültiges Sicherungs-JSON.')
    }
    const summary =
      payload.kind === 'einvoice-system-backup'
        ? await restoreSystemBackup(payload)
        : tenantId
          ? await restoreTenantBackup(payload, tenantId)
          : (() => {
              throw new ApiError(400, 'Mandantensicherung: bitte Ziel-Mandant angeben.')
            })()
    return NextResponse.json({ ok: true, message: summary })
  } catch (e) {
    if (e instanceof Error && !(e as { status?: number }).status) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    return jsonError(e)
  }
}
