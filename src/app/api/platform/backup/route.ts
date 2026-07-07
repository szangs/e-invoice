// Betreiber-Sicherung (§17): Mandanten-/System-Download + "Fällige jetzt ausführen"
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { buildSystemBackup, buildTenantBackup, runDueBackups } from '@/lib/backup'
import { getContext } from '@/lib/context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext({ operator: true })
    const params = new URL(req.url).searchParams
    const tenantId = params.get('tenantId')
    const { filename, json } = tenantId ? await buildTenantBackup(tenantId) : await buildSystemBackup()
    await audit({
      tenantId: tenantId ?? null,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: tenantId ? 'BACKUP_CREATED' : 'BACKUP_SYSTEM_CREATED',
      details: 'Sicherung durch Betreiber heruntergeladen',
    })
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

/** Führt alle aktivierten Sicherungen sofort aus (unabhängig von der Fälligkeit). */
export async function POST() {
  try {
    await getContext({ operator: true })
    const log = await runDueBackups(true)
    return NextResponse.json({ ok: true, log })
  } catch (e) {
    return jsonError(e)
  }
}
