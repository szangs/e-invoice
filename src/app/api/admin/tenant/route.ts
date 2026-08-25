// Mandantenspezifische Schalter durch den lokalen Administrator (§8)
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { hasFeature } from '@/lib/license'

const schema = z.object({
  aiAllowed: z.boolean().optional(),
  ipLoggingAllowed: z.boolean().optional(),
  defaultLanguage: z.string().optional(),
  backupEnabled: z.boolean().optional(),
  mailAllowedDomains: z.string().max(500).optional(),
  mailInGraphEnabled: z.boolean().optional(),
  mailInGraphMailbox: z.string().email().optional().or(z.literal('')),
  mailInGraphFolder: z.string().max(300).optional(),
  mailInGraphMoveToFolder: z.string().max(300).optional(),
  spamReplyEnabled: z.boolean().optional(),
  mailInGraphTenantId: z.string().max(200).optional(),
  mailInGraphClientId: z.string().max(200).optional(),
  mailInGraphClientSecret: z.string().max(500).optional(),
  backupFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  backupEmail: z.string().email().optional().or(z.literal('')),
  // Sicherungs-Umstellung (Stefan 2026-07-08): Download-Link + Erinnerung + optionales WebDAV-Ziel
  backupReminderDays: z.coerce.number().int().min(0).max(90).optional(),
  backupWebdavUrl: z.string().max(500).optional(),
  backupWebdavUser: z.string().max(200).optional(),
  backupWebdavPass: z.string().max(200).optional(),
  reportEnabled: z.boolean().optional(),
  reportFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  reportEmail: z.string().email().optional().or(z.literal('')),
  // DATEV-Export (Übergabekorb → Fibu, Stefan 2026-07-08)
  datevBeraternr: z.string().max(20).optional(),
  datevMandantnr: z.string().max(20).optional(),
  datevSkr: z.string().max(10).optional(),
  datevSachkontenlaenge: z.number().int().min(4).max(8).optional(),
  datevKreditorenkonto: z.string().max(20).optional(),
  datevGegenkonto: z.string().max(20).optional(),
  datevWjBeginn: z.string().regex(/^\d{4}$/).optional().or(z.literal('')),
  datevFibuEmail: z.string().email().optional().or(z.literal('')),
  costCentersEnabled: z.boolean().optional(),
  // Fälligkeits-Benachrichtigung (Stefan 2026-08-24): leerer String = aus (null in der DB)
  dueReminderDaysAfterReceipt: z.number().int().min(1).max(365).nullable().optional(),
  dueReminderDaysBeforeDue: z.number().int().min(1).max(365).nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const data = schema.parse(await req.json())
    if (data.costCentersEnabled) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant || !hasFeature(tenant, 'COST_CENTERS')) {
        throw new ApiError(403, 'Kostenstellen/Kostenträger sind im aktuellen Tarif nicht enthalten.')
      }
    }
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...data,
        mailInGraphMailbox: data.mailInGraphMailbox === '' ? null : data.mailInGraphMailbox,
        mailInGraphFolder: data.mailInGraphFolder === '' ? null : data.mailInGraphFolder,
        mailInGraphMoveToFolder: data.mailInGraphMoveToFolder === '' ? null : data.mailInGraphMoveToFolder,
        mailInGraphTenantId: data.mailInGraphTenantId === '' ? null : data.mailInGraphTenantId,
        mailInGraphClientId: data.mailInGraphClientId === '' ? null : data.mailInGraphClientId,
        mailInGraphClientSecret: data.mailInGraphClientSecret === '' ? null : data.mailInGraphClientSecret,
        backupEmail: data.backupEmail === '' ? null : data.backupEmail,
        backupWebdavUrl: data.backupWebdavUrl === '' ? null : data.backupWebdavUrl,
        backupWebdavUser: data.backupWebdavUser === '' ? null : data.backupWebdavUser,
        backupWebdavPass: data.backupWebdavPass === '' ? null : data.backupWebdavPass,
        reportEmail: data.reportEmail === '' ? null : data.reportEmail,
        datevWjBeginn: data.datevWjBeginn === '' ? null : data.datevWjBeginn,
        datevFibuEmail: data.datevFibuEmail === '' ? null : data.datevFibuEmail,
      },
    })
    // Passwort nie im Klartext ins (für mehrere Personen einsehbare) Audit-Protokoll schreiben
    const SECRET_FIELDS = new Set(['backupWebdavPass', 'mailInGraphClientSecret'])
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'TENANT_SWITCHES',
      details: `Schalter geändert: ${Object.entries(data)
        .map(([k, v]) => `${k}=${SECRET_FIELDS.has(k) ? '••••' : v}`)
        .join(', ')}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
