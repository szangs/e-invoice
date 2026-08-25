// Verbindungs-/Ordner-Test für den Graph-basierten Mail-Eingang (Mandanten-Einstellungen)
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { testGraphMailbox } from '@/lib/graphMailin'

const schema = z.object({
  mailbox: z.string().email(),
  folder: z.string().max(300).optional(),
  moveToFolder: z.string().max(300).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { mailbox, folder, moveToFolder } = schema.parse(await req.json())
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { mailInGraphTenantId: true, mailInGraphClientId: true, mailInGraphClientSecret: true },
    })
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden')
    try {
      const result = await testGraphMailbox(tenant, mailbox, folder, moveToFolder)
      const warn = result.source === 'operator-test' ? ' ⚠ Entwicklungsmodus: Betreiber-Zugangsdaten verwendet, da keine eigenen hinterlegt sind.' : ''
      const moveNote = moveToFolder ? (result.moveToFolderResolved ? ' Zielordner für Verschieben gefunden.' : '') : ''
      return NextResponse.json({
        ok: true,
        message: `Ordner gefunden (${result.folderId === 'inbox' ? 'Posteingang' : result.folderId}) — ${result.messageCount} Nachricht(en) der letzten Abfrage.${moveNote}${warn}`,
      })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      return NextResponse.json({ ok: false, message: detail })
    }
  } catch (e) {
    return jsonError(e)
  }
}
