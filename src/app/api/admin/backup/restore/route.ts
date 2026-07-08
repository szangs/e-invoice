// Rücksicherung des eigenen Mandanten (§17) — robust mit klaren Meldungen.
// Akzeptiert seit der Umstellung auf ZIP-Sicherungspakete (Stefan 2026-07-08)
// sowohl das neue .zip-Format als auch ältere, bereits heruntergeladene
// .json-Sicherungen (Abwärtskompatibilität).
import { NextRequest, NextResponse } from 'next/server'
import AdmZip from 'adm-zip'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { MAX_RESTORE_BYTES, restoreTenantBackup } from '@/lib/backup'
import { ApiError, getContext, requireTenant } from '@/lib/context'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseZipPayload(buf: Buffer): any {
  const zip = new AdmZip(buf)
  const dataEntry = zip.getEntry('daten.json')
  if (!dataEntry) throw new ApiError(400, 'Ungültiges ZIP — daten.json fehlt im Paket.')
  const payload = JSON.parse(zip.readAsText(dataEntry, 'utf8'))
  const files: Record<string, string> = {}
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('belege/')) continue
    const name = entry.entryName.slice('belege/'.length)
    files[name] = entry.getData().toString('base64')
  }
  payload.files = files
  return payload
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Sicherungsdatei erhalten.')
    if (file.size > MAX_RESTORE_BYTES) throw new ApiError(400, 'Sicherung zu groß (max. 50 MB).')

    const buf = Buffer.from(await file.arrayBuffer())
    const isZip = buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b // Magic Bytes "PK"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any
    try {
      payload = isZip ? parseZipPayload(buf) : JSON.parse(buf.toString('utf8'))
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(400, 'Ungültiges Format — Datei ist weder ein gültiges Sicherungs-ZIP noch -JSON.')
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
