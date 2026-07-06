// Einheitliche Fehlerbehandlung für API-Routes (DP-Standard §7)
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { ApiError } from '@/lib/context'

export function jsonError(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message }, { status: e.status })
  }
  if (e instanceof ZodError) {
    const msg = e.errors.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return NextResponse.json({ error: `Eingabe ungültig — ${msg}` }, { status: 400 })
  }
  console.error('API-Fehler:', e)
  return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
}
