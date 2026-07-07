// Dubletten-Vorabprüfung: wird VOR dem eigentlichen Speichern aufgerufen, damit
// der Nutzer gefragt werden kann "möchten Sie diese Rechnung wirklich noch
// einmal übernehmen?" statt die Dublette stillschweigend zu markieren.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { getContext, requireTenant } from '@/lib/context'
import { findDuplicateInvoice } from '@/lib/duplicates'

const schema = z.object({
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  invoiceNumber: z.string().optional(),
  vendor: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const body = schema.parse(await req.json())
    const duplicate = await findDuplicateInvoice(tenantId, body)
    return NextResponse.json({ duplicate })
  } catch (e) {
    return jsonError(e)
  }
}
