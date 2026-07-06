// Betreiber-Systemeinstellungen (§24): GET liefert maskierte Secrets, PUT speichert.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { getSettings, mask, SECRET_KEYS, SETTING_KEYS, SettingKey, setSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await getContext({ operator: true })
    const values = await getSettings()
    const out: Record<string, string> = { ...values }
    for (const key of SECRET_KEYS) out[key] = mask(values[key])
    return NextResponse.json({ settings: out, devFromEnv: process.env.NODE_ENV === 'development' })
  } catch (e) {
    return jsonError(e)
  }
}

const putSchema = z.record(z.string(), z.string())

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getContext({ operator: true })
    const body = putSchema.parse(await req.json())
    const changed: string[] = []
    for (const [key, value] of Object.entries(body)) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) continue
      const k = key as SettingKey
      // Maskierte, unveränderte Secrets nicht überschreiben
      if (SECRET_KEYS.includes(k) && value.includes('*')) continue
      await setSetting(k, value)
      changed.push(key)
    }
    await audit({
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'SETTINGS_UPDATE',
      details: `Systemeinstellungen geändert: ${changed.join(', ') || '—'}`,
    })
    return NextResponse.json({ ok: true, changed })
  } catch (e) {
    return jsonError(e)
  }
}
