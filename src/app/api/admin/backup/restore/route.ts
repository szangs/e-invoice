// Rücksicherung des eigenen Mandanten (§17) — robust mit klaren Meldungen
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { MAX_RESTORE_BYTES, restoreTenantBackup } from '@/lib/backup'
import { ApiError, getContext, requireTenant } from '@/lib/context'

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Sicherungsdatei erhalten.')
    if (file.size > MAX_RESTORE_BYTES) throw new ApiError(400, 'Sicherung zu groß (max. 50 MB).')
    let payload: unknown
    try {
      payload = JSON.parse(Buffer.from(await file.arrayBuffer()).toString('utf8'))
    } catch {
      throw new ApiError(400, 'Ungültiges Format — Datei ist kein gültiges Sicherungs-JSON.')
    }
    const summary = await restoreTenantBackup(payload, tenantId)
    return NextResponse.json({ ok: true, message: summary })
  } catch (e) {
    if (e instanceof Error && !(e as { status?: number }).status) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    return jsonError(e)
  }
}
