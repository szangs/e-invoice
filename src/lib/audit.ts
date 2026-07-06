// Revisionssichere Protokollierung mit verketteten Prüfsummen (§18)
import { createHash } from 'crypto'
import { prisma } from '@/lib/db'

export type AuditEntry = {
  tenantId?: string | null
  actorId?: string | null
  actorName: string
  action: string
  details?: string
  ip?: string | null
}

/** Schreibt einen Audit-Eintrag mit Hash-Kette. Fehler hier dürfen den Hauptvorgang nie abbrechen. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const last = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } })
    const prevHash = last?.hash ?? 'GENESIS'
    const payload = JSON.stringify({
      prevHash,
      tenantId: entry.tenantId ?? null,
      actorId: entry.actorId ?? null,
      actorName: entry.actorName,
      action: entry.action,
      details: entry.details ?? null,
      ts: new Date().toISOString(),
    })
    const hash = createHash('sha256').update(payload).digest('hex')
    await prisma.auditLog.create({
      data: {
        tenantId: entry.tenantId ?? null,
        actorId: entry.actorId ?? null,
        actorName: entry.actorName,
        action: entry.action,
        details: entry.details ?? null,
        ip: entry.ip ?? null,
        prevHash,
        hash,
      },
    })
  } catch (e) {
    console.error('Audit-Log fehlgeschlagen:', e)
  }
}
