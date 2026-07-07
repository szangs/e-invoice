// Revisionssicherer Hash-Bericht (Whitepaper-Preismodell Punkt 4: "revisionssichere
// Hash-Protokollierung, tägliche/monatliche Läufe" — Teil der kostenlosen Basis).
// Anders als die Sicherung (§17, lib/backup.ts): kein vollständiger Datenexport zur
// Wiederherstellung, sondern ein schlankes, menschenlesbares Protokoll (CSV) mit der
// Rechnungsliste und den Beleg-Hashes je Rechnung, das an eine feste Kunden-Adresse
// geht — zur eigenen Ablage/Dokumentation, unabhängig von E-Invoice als Programm.
// Die Berichte sind wie das Audit-Protokoll (§18, lib/audit.ts) verkettet
// (lastReportHash → nächster Bericht enthält den vorherigen Hash), damit der Kunde
// auch ohne Zugriff auf E-Invoice erkennen kann, ob ein Bericht fehlt oder verändert
// wurde.
import { createHash } from 'crypto'
import { audit } from '@/lib/audit'
import { isDue } from '@/lib/backup'
import { prisma } from '@/lib/db'
import { STATUS_LABELS } from '@/lib/invoices'
import { sendSystemMail } from '@/lib/mail'

function csvField(v: string | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function num(v: unknown): string {
  if (v === null || v === undefined) return ''
  return Number(v).toFixed(2).replace('.', ',')
}

/** Baut den Bericht (CSV) für einen Mandanten und verkettet ihn mit dem letzten Bericht-Hash. */
export async function buildHashReport(
  tenantId: string,
): Promise<{ filename: string; csv: string; hash: string; count: number }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new Error('Mandant nicht gefunden')
  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
  })

  const header = [
    'Dokumenten-ID', 'Lieferant', 'Rechnungsnummer', 'Rechnungsdatum', 'Fälligkeit',
    'Netto', 'Steuer', 'Brutto', 'Währung', 'Status', 'Beleg-Hash (SHA-256)', 'Erfasst am',
  ].join(';')
  const rows = invoices
    .map((i) =>
      [
        csvField(i.docId),
        csvField(i.vendor),
        csvField(i.invoiceNumber),
        i.invoiceDate ? i.invoiceDate.toISOString().slice(0, 10) : '',
        i.directDebitByVendor ? 'wird abgebucht' : i.dueDate ? i.dueDate.toISOString().slice(0, 10) : '',
        num(i.amountNet),
        num(i.amountTax),
        num(i.amountGross),
        i.currency,
        STATUS_LABELS[i.status],
        i.fileHash ?? '',
        i.createdAt.toISOString(),
      ].join(';'),
    )
    .join('\r\n')

  const createdAt = new Date().toISOString()
  const prevHash = tenant.lastReportHash ?? 'GENESIS'
  // Verkettung wie beim Audit-Log (§18): Hash aus vorherigem Bericht-Hash + Inhalt.
  const hash = createHash('sha256').update(`${prevHash}\n${header}\n${rows}`).digest('hex')

  const meta = [
    'E-Invoice — Revisionssicherer Bericht',
    `Mandant;${tenant.name}`,
    `Erstellt am;${createdAt}`,
    `Anzahl Rechnungen;${invoices.length}`,
    `Bericht-Hash (vorheriger);${prevHash}`,
    `Bericht-Hash (dieser);${hash}`,
    '',
  ].join('\r\n')

  const csv = '﻿' + meta + header + '\r\n' + rows
  const date = createdAt.slice(0, 10)
  return { filename: `einvoice-bericht-${tenant.slug}-${date}.csv`, csv, hash, count: invoices.length }
}

/** Führt alle fälligen (oder bei force=true alle aktivierten) Berichte aus. */
export async function runDueReports(force = false): Promise<string[]> {
  const log: string[] = []
  const tenants = await prisma.tenant.findMany({ where: { reportEnabled: true, active: true } })
  for (const t of tenants) {
    if (!force && !isDue(t.lastReportAt, t.reportFrequency)) continue
    if (!t.reportEmail) {
      log.push(`${t.slug}: Bericht — kein Ziel konfiguriert (E-Mail fehlt)`)
      continue
    }
    try {
      const { filename, csv, hash, count } = await buildHashReport(t.id)
      const mail = await sendSystemMail(
        t.reportEmail,
        `E-Invoice Revisionssicherer Bericht — ${t.name}`,
        `Guten Tag,\n\nanbei der revisionssichere Bericht Ihrer Rechnungen (${count}) mit ` +
          `Prüfsumme je Beleg — zur eigenen Ablage/Dokumentation, unabhängig von E-Invoice.\n\n` +
          `Bericht-Hash: ${hash}\n`,
        [{ filename, content: csv }],
      )
      if (mail.sent) {
        await prisma.tenant.update({
          where: { id: t.id },
          data: { lastReportAt: new Date(), lastReportHash: hash },
        })
        await audit({
          tenantId: t.id,
          actorName: 'Bericht',
          action: 'REPORT_SENT',
          details: `Revisionssicherer Bericht versendet an ${t.reportEmail} (${count} Rechnungen)`,
        })
        log.push(`${t.slug}: Bericht an ${t.reportEmail} — versendet`)
      } else {
        log.push(`${t.slug}: Bericht — ${mail.reason}`)
      }
    } catch (e) {
      log.push(`${t.slug}: Bericht — FEHLER: ${e instanceof Error ? e.message : 'unbekannt'}`)
    }
  }
  return log
}
