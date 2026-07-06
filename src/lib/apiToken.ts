// API-Token-Auth für die Browser-Extension: Bearer-Token je Mandant,
// gespeichert nur als SHA-256-Hash. Mandantensperre wird serverseitig erzwungen.
import { createHash, randomBytes } from 'crypto'
import { ApiToken, Tenant } from '@prisma/client'
import { ApiError } from '@/lib/context'
import { prisma } from '@/lib/db'

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateToken(): string {
  return `einv_${randomBytes(24).toString('hex')}`
}

export async function resolveToken(req: Request): Promise<ApiToken & { tenant: Tenant }> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new ApiError(401, 'API-Token fehlt')
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { tenant: true },
  })
  if (!row) throw new ApiError(401, 'API-Token ungültig')
  if (!row.tenant.active) throw new ApiError(403, 'Mandant ist gesperrt')
  prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined)
  return row
}
