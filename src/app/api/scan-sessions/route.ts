// Handy-als-Kamera-Kopplung (Stefan 2026-08-27, siehe lib/scanSession.ts):
// nur dieser Weg erzeugt eine Sitzung — braucht eine normale, angemeldete
// PC-Sitzung. Alles Weitere (Foto-Upload, Abfrage, Status) läuft danach nur
// noch über den Token, ohne Login (das Handy meldet sich nie an).
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { newScanSessionToken, SCAN_SESSION_TTL_MINUTES } from '@/lib/scanSession'

export async function POST() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const token = newScanSessionToken()
    const expiresAt = new Date(Date.now() + SCAN_SESSION_TTL_MINUTES * 60_000)
    await prisma.scanSession.create({
      data: { tenantId, createdByUserId: ctx.userId, token, expiresAt },
    })
    return NextResponse.json({ token, expiresAt })
  } catch (e) {
    return jsonError(e)
  }
}
