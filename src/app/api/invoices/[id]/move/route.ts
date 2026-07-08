// Rechnung in einen anderen Korb verschieben — direkt, oder als Freigabe
// (Vier-Augen-Prinzip), siehe lib/baskets.ts.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { requestMove } from '@/lib/baskets'
import { getContext, requireTenant } from '@/lib/context'

const schema = z.object({ targetBasketId: z.string().min(1) })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const { targetBasketId } = schema.parse(await req.json())
    const result = await requestMove(tenantId, params.id, targetBasketId, ctx.userId, ctx.email, ctx.role)
    return NextResponse.json(result)
  } catch (e) {
    return jsonError(e)
  }
}
