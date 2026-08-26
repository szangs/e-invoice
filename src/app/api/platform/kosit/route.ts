// KoSIT-Validator: Status + Update auslösen (Stefan 2026-08-26) — die
// Installation (JRE + validator.jar + Regelwerk) liegt serverweit unter
// tools/kosit/, nicht je Mandant — deshalb Betreiber-Cockpit statt
// Mandanten-Einstellungen, siehe lib/kositSetup.ts.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { checkForKositUpdates, installOrUpdateKositValidator, isKositInstalled, readInstalledVersions } from '@/lib/kositSetup'

export async function GET() {
  try {
    await getContext({ operator: true })
    const installed = await readInstalledVersions()
    const check = await checkForKositUpdates().catch((e) => ({ error: e instanceof Error ? e.message : 'GitHub nicht erreichbar' }))
    return NextResponse.json({ installedFiles: isKositInstalled(), installed, check })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST() {
  try {
    const ctx = await getContext({ operator: true })
    const versions = await installOrUpdateKositValidator()
    await audit({
      tenantId: null,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'KOSIT_UPDATE',
      details: `KoSIT-Validator aktualisiert: Validator ${versions.validatorVersion}, Regelwerk ${versions.configVersion}`,
    })
    return NextResponse.json({ ok: true, versions })
  } catch (e) {
    return jsonError(e)
  }
}
