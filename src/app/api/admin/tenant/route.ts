// Mandantenspezifische Schalter durch den lokalen Administrator (§8)
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { COLOR_THEME_KEYS } from '@/lib/colorThemes'
import { prisma } from '@/lib/db'
import { hasFeature } from '@/lib/license'

const schema = z.object({
  // Firmenbezeichnung + Abweichungs-Verhalten (Stefan 2026-08-25) — Grundlage
  // für den Rechnungsempfänger-Abgleich (lib/erechnung.ts buyerNameMismatch).
  legalName: z.string().max(300).optional(),
  buyerNameMismatchBlocksHandover: z.boolean().optional(),
  aiAllowed: z.boolean().optional(),
  ipLoggingAllowed: z.boolean().optional(),
  defaultLanguage: z.string().optional(),
  // Erscheinungsbild (Stefan 2026-08-27) — Whitelist statt freiem String,
  // gegen einen unbekannten/erfundenen [data-theme]-Wert (siehe globals.css).
  colorTheme: z.enum(COLOR_THEME_KEYS as [string, ...string[]]).optional(),
  backupEnabled: z.boolean().optional(),
  mailAllowedDomains: z.string().max(500).optional(),
  mailInGraphEnabled: z.boolean().optional(),
  mailInGraphMailbox: z.string().email().optional().or(z.literal('')),
  mailInGraphFolder: z.string().max(300).optional(),
  mailInGraphMoveToFolder: z.string().max(300).optional(),
  spamReplyEnabled: z.boolean().optional(),
  autoDeleteExactDuplicates: z.boolean().optional(),
  autoSupersedeInvoiceVersions: z.boolean().optional(),
  mailInGraphTenantId: z.string().max(200).optional(),
  mailInGraphClientId: z.string().max(200).optional(),
  mailInGraphClientSecret: z.string().max(500).optional(),
  // E-Mail-Eingang per POP3/IMAP (Stefan 2026-08-27)
  mailInPop3Enabled: z.boolean().optional(),
  mailInPop3Host: z.string().max(300).optional(),
  mailInPop3Port: z.coerce.number().int().min(1).max(65535).optional(),
  mailInPop3Secure: z.boolean().optional(),
  mailInPop3User: z.string().max(300).optional(),
  mailInPop3Pass: z.string().max(500).optional(),
  mailInImapEnabled: z.boolean().optional(),
  mailInImapHost: z.string().max(300).optional(),
  mailInImapPort: z.coerce.number().int().min(1).max(65535).optional(),
  mailInImapSecure: z.boolean().optional(),
  mailInImapUser: z.string().max(300).optional(),
  mailInImapPass: z.string().max(500).optional(),
  mailInImapFolder: z.string().max(300).optional(),
  mailInImapMoveToFolder: z.string().max(300).optional(),
  // Eigenes Poll-Intervall (Stefan 2026-08-27, "bei Mailabholung müssen wir
  // die Pollrate einstellen können") — leer/0 = globaler Betreiber-Standard,
  // siehe lib/mailinSchedule.ts. Untergrenze 30s, damit ein Tippfehler nicht
  // versehentlich Sekundentakt-Dauerabrufe auslöst.
  mailInPollSeconds: z.coerce.number().int().min(0).max(86400).optional(),
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
  // Zahlungsverkehr (Stefan 2026-08-27, SEPA-Sammelüberweisung) — Format
  // (Prüfziffer) wird erst beim tatsächlichen Export geprüft (lib/sepa.ts),
  // hier nur grob die Länge begrenzt, damit ein Speichern nicht an einer
  // Formatprüfung während des Tippens hängen bleibt.
  sepaOwnName: z.string().max(200).optional(),
  sepaOwnIban: z.string().max(40).optional(),
  sepaOwnBic: z.string().max(20).optional(),
  costCenterEnabled: z.boolean().optional(),
  costCarrierEnabled: z.boolean().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const data = schema.parse(await req.json())
    if (data.costCenterEnabled || data.costCarrierEnabled) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant || !hasFeature(tenant, 'COST_CENTERS')) {
        throw new ApiError(403, 'Kostenstellen/Kostenträger sind im aktuellen Tarif nicht enthalten.')
      }
    }
    // E-Mail-Verfahren-Auswahl (Stefan 2026-08-27): immer nur EIN Abrufweg
    // gleichzeitig aktiv (Weiterleitung/SMTP läuft ohnehin immer parallel,
    // hat kein eigenes Ein/Aus) — wird hier eines der drei per Toggle
    // eingeschaltet, schaltet der Server die anderen beiden aus, statt sich
    // auf die UI zu verlassen (die das zwar schon als Radio-Auswahl
    // umsetzt, siehe SettingsHub.tsx, aber ein direkter API-Aufruf könnte es
    // sonst umgehen).
    if (data.mailInGraphEnabled) {
      data.mailInPop3Enabled = false
      data.mailInImapEnabled = false
    } else if (data.mailInPop3Enabled) {
      data.mailInGraphEnabled = false
      data.mailInImapEnabled = false
    } else if (data.mailInImapEnabled) {
      data.mailInGraphEnabled = false
      data.mailInPop3Enabled = false
    }
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...data,
        legalName: data.legalName === '' ? null : data.legalName,
        mailInGraphMailbox: data.mailInGraphMailbox === '' ? null : data.mailInGraphMailbox,
        mailInGraphFolder: data.mailInGraphFolder === '' ? null : data.mailInGraphFolder,
        mailInGraphMoveToFolder: data.mailInGraphMoveToFolder === '' ? null : data.mailInGraphMoveToFolder,
        mailInGraphTenantId: data.mailInGraphTenantId === '' ? null : data.mailInGraphTenantId,
        mailInGraphClientId: data.mailInGraphClientId === '' ? null : data.mailInGraphClientId,
        mailInGraphClientSecret: data.mailInGraphClientSecret === '' ? null : data.mailInGraphClientSecret,
        mailInPop3Host: data.mailInPop3Host === '' ? null : data.mailInPop3Host,
        mailInPop3User: data.mailInPop3User === '' ? null : data.mailInPop3User,
        mailInPop3Pass: data.mailInPop3Pass === '' ? null : data.mailInPop3Pass,
        mailInImapHost: data.mailInImapHost === '' ? null : data.mailInImapHost,
        mailInImapUser: data.mailInImapUser === '' ? null : data.mailInImapUser,
        mailInImapPass: data.mailInImapPass === '' ? null : data.mailInImapPass,
        mailInImapFolder: data.mailInImapFolder === '' ? null : data.mailInImapFolder,
        mailInImapMoveToFolder: data.mailInImapMoveToFolder === '' ? null : data.mailInImapMoveToFolder,
        // 0/leer = globaler Standard (null); sonst mit 30s-Untergrenze
        // klemmen, damit ein Tippfehler keinen Sekundentakt-Dauerabruf auslöst.
        mailInPollSeconds: data.mailInPollSeconds === undefined ? undefined : data.mailInPollSeconds ? Math.max(30, data.mailInPollSeconds) : null,
        backupEmail: data.backupEmail === '' ? null : data.backupEmail,
        backupWebdavUrl: data.backupWebdavUrl === '' ? null : data.backupWebdavUrl,
        backupWebdavUser: data.backupWebdavUser === '' ? null : data.backupWebdavUser,
        backupWebdavPass: data.backupWebdavPass === '' ? null : data.backupWebdavPass,
        reportEmail: data.reportEmail === '' ? null : data.reportEmail,
        datevWjBeginn: data.datevWjBeginn === '' ? null : data.datevWjBeginn,
        datevFibuEmail: data.datevFibuEmail === '' ? null : data.datevFibuEmail,
        sepaOwnName: data.sepaOwnName === '' ? null : data.sepaOwnName,
        sepaOwnIban: data.sepaOwnIban === '' ? null : data.sepaOwnIban?.replace(/\s+/g, '').toUpperCase(),
        sepaOwnBic: data.sepaOwnBic === '' ? null : data.sepaOwnBic?.replace(/\s+/g, '').toUpperCase(),
      },
    })
    // Passwort nie im Klartext ins (für mehrere Personen einsehbare) Audit-Protokoll schreiben
    const SECRET_FIELDS = new Set(['backupWebdavPass', 'mailInGraphClientSecret', 'mailInPop3Pass', 'mailInImapPass'])
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
