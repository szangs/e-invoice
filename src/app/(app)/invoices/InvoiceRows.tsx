'use client'

// Suche/Sortierung bei Inhalts-Verschlüsselung (Stefan 2026-07-09, #109):
// Lieferant, Nummer und Beträge stehen bei verschlüsselten Mandanten
// serverseitig nur als Platzhalter/null in der DB (siehe Invoice.contentEnc)
// — eine SQL-Suche/-Sortierung nach diesen Spalten würde für solche
// Mandanten also nur falsche (leere bzw. beliebig geordnete) Ergebnisse
// liefern. Für einen verschlüsselten Mandanten liefert der Server deshalb
// ungefiltert bzw. nach diesen Feldern unsortiert aus (siehe page.tsx), und
// diese Komponente übernimmt Suche/Sortierung hier im Browser, nachdem sie
// die geladenen Zeilen (max. 200, wie bisher) entschlüsselt hat. Ohne im
// Browser zwischengespeicherte Passphrase werden alle Zeilen unverändert in
// normaler Reihenfolge gezeigt (lieber zu viele als versehentlich falsch
// wenige/falsch sortierte Treffer) und ein Hinweis erscheint.
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { useEffect, useMemo, useState } from 'react'
import { FileLink } from '@/components/crypto/FileLink'
import { InvoiceAmountCell } from '@/components/crypto/InvoiceAmountCell'
import { InvoiceNumberCell } from '@/components/crypto/InvoiceNumberCell'
import { InvoiceVendorCell } from '@/components/crypto/InvoiceVendorCell'
import { DEK_UNLOCKED_EVENT } from '@/components/crypto/useDecryptedContent'
import { decryptJson } from '@/lib/clientCrypto'
import { getCachedDek } from '@/lib/keyStore'
import { STATUS_LABELS, type InvoiceDTO } from '@/lib/invoices'
import { CheckBadges } from './CheckBadges'
import { DeleteInvoiceButton } from './DeleteInvoiceButton'
import { DraggableInvoiceRow } from './DraggableInvoiceRow'
import { RowCheckbox } from './InvoiceSelection'
import { RestoreButton } from './RestoreButton'

export type InvoiceRowData = InvoiceDTO & {
  unreadNote: boolean
  pendingApprovalTitle: string | null
  /** Beleg-Eingang fällt in ein abgeschlossenes Audit-Jahr (§18) — schreibgeschützt. */
  locked: boolean
}

type DecryptedContent = {
  vendor?: string | null
  invoiceNumber?: string | null
  amountNet?: string | null
  amountGross?: string | null
  tags?: string | null
}

export const CONTENT_SORT_FIELDS = new Set(['vendor', 'invoiceNumber', 'amountNet', 'amountGross'])

function fmtDateOnly(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** Kurzer, einzeiliger Auszug aus dem Mailtext für die Listenspalte (Stefan
 * 2026-08-25) — Leerzeilen/Mehrfach-Whitespace zusammengefasst, damit die
 * Spalte klein bleibt und nicht durch Formatierungsreste aufgebläht wird. */
function mailExcerpt(text: string | null, maxLen = 220): string | null {
  if (!text) return null
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (!collapsed) return null
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen).trimEnd()}…` : collapsed
}

function toNumber(v?: string | null): number | null {
  if (!v) return null
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function InvoiceRows({
  rows,
  showTrash,
  canMove,
  canApprove,
  canHandover,
  q,
  sortField,
  sortDir,
  encryptionEnabled,
}: {
  rows: InvoiceRowData[]
  showTrash: boolean
  canMove: boolean
  canApprove: boolean
  canHandover: boolean
  q: string
  sortField: string | null
  sortDir: 'asc' | 'desc'
  encryptionEnabled: boolean
}) {
  const rowIds = rows.map((r) => r.id).join(',')
  const needsClientWork =
    encryptionEnabled && (Boolean(q) || (sortField !== null && CONTENT_SORT_FIELDS.has(sortField)))
  const [decrypted, setDecrypted] = useState<Map<string, DecryptedContent>>(new Map())
  const [dekMissing, setDekMissing] = useState(false)

  useEffect(() => {
    if (!needsClientWork) return
    let stop = false
    async function run() {
      const dek = await getCachedDek()
      if (!dek) {
        if (!stop) setDekMissing(true)
        return
      }
      const next = new Map<string, DecryptedContent>()
      for (const r of rows) {
        if (!r.contentEnc) continue
        try {
          next.set(r.id, await decryptJson<DecryptedContent>(dek, r.contentEnc))
        } catch {
          // falsche/abgelaufene Passphrase — Zeile bleibt beim Fallback, kein Absturz
        }
      }
      if (!stop) {
        setDecrypted(next)
        setDekMissing(false)
      }
    }
    run()
    window.addEventListener(DEK_UNLOCKED_EVENT, run)
    return () => {
      stop = true
      window.removeEventListener(DEK_UNLOCKED_EVENT, run)
    }
    // rows-Inhalte ändern sich nur durch Neuladen der Seite — die ID-Liste reicht als Abhängigkeit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsClientWork, rowIds])

  function fieldValue(r: InvoiceRowData, field: string): { text: string; num: number | null } {
    const dec = r.contentEnc ? decrypted.get(r.id) : undefined
    switch (field) {
      case 'vendor':
        return { text: (r.contentEnc ? dec?.vendor ?? '' : r.vendor ?? '').toLowerCase(), num: null }
      case 'invoiceNumber':
        return { text: (r.contentEnc ? dec?.invoiceNumber ?? '' : r.invoiceNumber ?? '').toLowerCase(), num: null }
      case 'amountNet':
        return { text: '', num: r.contentEnc ? toNumber(dec?.amountNet) : r.amountNet }
      case 'amountGross':
        return { text: '', num: r.contentEnc ? toNumber(dec?.amountGross) : r.amountGross }
      default:
        return { text: '', num: null }
    }
  }

  const decryptionPending = needsClientWork && dekMissing

  const visibleRows = useMemo(() => {
    let list = rows
    if (encryptionEnabled && q && !decryptionPending) {
      const needle = q.toLowerCase()
      list = rows.filter((r) => {
        if (r.contentEnc) {
          const dec = decrypted.get(r.id)
          const hay = [dec?.vendor, dec?.invoiceNumber, dec?.tags].filter(Boolean).join(' ').toLowerCase()
          return hay.includes(needle)
        }
        const hay = [r.vendor, r.invoiceNumber, r.tags].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(needle)
      })
    }
    if (encryptionEnabled && sortField && CONTENT_SORT_FIELDS.has(sortField) && !decryptionPending) {
      list = [...list].sort((a, b) => {
        const va = fieldValue(a, sortField)
        const vb = fieldValue(b, sortField)
        const cmp =
          va.num !== null || vb.num !== null
            ? (va.num ?? -Infinity) - (vb.num ?? -Infinity)
            : va.text.localeCompare(vb.text, 'de')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sortField, sortDir, encryptionEnabled, decrypted, decryptionPending])

  const colSpan = showTrash ? 12 : 16

  return (
    <>
      {decryptionPending && (
        <tr>
          <td colSpan={colSpan} className="bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
            Suche/Sortierung nach Lieferant, Nummer oder Betrag wirkt erst, nachdem oben die Passphrase eingegeben
            wurde — bis dahin werden alle Zeilen in normaler Reihenfolge gezeigt.
          </td>
        </tr>
      )}
      {visibleRows.map((i) => {
        // KI-erkannte, noch nicht bestätigte Werte: andere Schriftfarbe + nicht
        // per Drag&Drop verschiebbar (serverseitig zusätzlich in lib/baskets.ts
        // requestMove erzwungen — hier nur die UI-Vorabsperre/Kennzeichnung).
        const needsAiConfirm = i.aiAssisted && !i.aiConfirmedAt
        return (
        <DraggableInvoiceRow key={i.id} invoiceId={i.id}
          className={i.locked ? 'dp-tr text-gray-400' : needsAiConfirm ? 'dp-tr text-[var(--warn-strong)]' : 'dp-tr'}
          disabled={showTrash || !canMove || needsAiConfirm || i.locked}>
          {!showTrash && (
            <td className="dp-td">
              <RowCheckbox id={i.id} />
            </td>
          )}
          <td className="dp-td font-mono text-[11px] text-gray-500">
            {i.locked && (
              <span title={`Abgeschlossener Prüfungszeitraum ${new Date(i.createdAt).getFullYear()} — schreibgeschützt`}>🔒 </span>
            )}
            {i.docId ?? '—'}
          </td>
          <td className="dp-td">
            <InvoiceVendorCell
              invoiceId={i.id}
              contentEnc={i.contentEnc}
              fallbackVendor={i.vendor}
              fallbackTags={i.tags}
              hasUnreadNote={i.unreadNote}
              pendingApprovalTitle={i.pendingApprovalTitle}
              isDuplicate={Boolean(i.duplicateOfId)}
            />
          </td>
          <td className="dp-td font-mono text-xs">
            <InvoiceNumberCell contentEnc={i.contentEnc} fallbackInvoiceNumber={i.invoiceNumber} />
          </td>
          <td className="dp-td text-xs">{fmtDateOnly(i.invoiceDate)}</td>
          <td className="dp-td text-xs">
            {i.directDebitByVendor ? (
              <span className="text-gray-500" title="Lieferant bucht per Lastschrift/Abbuchung selbst ab">
                wird abgebucht
              </span>
            ) : (
              fmtDateOnly(i.dueDate)
            )}
          </td>
          <td className="dp-td whitespace-nowrap text-xs" title="Eingang in E-Invoice">
            {format(new Date(i.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })}
          </td>
          <td className="dp-td">
            <InvoiceAmountCell
              contentEnc={i.contentEnc}
              field="amountNet"
              fallbackAmount={i.amountNet}
              fallbackCurrency={i.currency}
            />
          </td>
          <td className="dp-td">
            <InvoiceAmountCell
              contentEnc={i.contentEnc}
              field="amountGross"
              fallbackAmount={i.amountGross}
              fallbackCurrency={i.currency}
            />
          </td>
          <td className="dp-td">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                i.status === 'REJECTED'
                  ? 'bg-red-50 text-[var(--danger)]'
                  : i.status === 'NEW'
                    ? 'bg-[var(--warn-bg)] text-[var(--warn-strong)]'
                    : 'bg-[var(--accent-bg)] text-[var(--accent)]'
              }`}
            >
              {STATUS_LABELS[i.status]}
            </span>
          </td>
          <td className="dp-td">
            <div className="flex flex-col items-start gap-0.5">
              {i.docFormat === 'ZUGFERD' || i.docFormat?.startsWith('XRECHNUNG') ? (
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    i.validationOk === false
                      ? 'bg-red-50 text-[var(--danger)]'
                      : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  }`}
                  title={i.validationIssues ? `Fehlend: ${i.validationIssues}` : 'Pflichtangaben vollständig'}
                >
                  {i.docFormat === 'ZUGFERD' ? 'ZUGFeRD' : 'XRechnung'}
                  {i.validationOk === false ? ' ✗' : i.validationOk ? ' ✓' : ''}
                </span>
              ) : i.encrypted ? (
                <span className="whitespace-nowrap text-[10px] text-gray-400" title="Inhalt verschlüsselt — nur der Kunde kann ihn lesen">
                  🔒
                </span>
              ) : i.source === 'SCAN' ? (
                <span className="whitespace-nowrap rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-semibold text-gray-600" title="Papierrechnung gescannt/fotografiert">
                  📷 Scan
                </span>
              ) : i.htmlRendered ? (
                <span
                  className="whitespace-nowrap rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]"
                  title="Kein vom Lieferanten mitgeschicktes Original — diese PDF wurde automatisch aus dem HTML-Mailtext erzeugt (Rechnung kam ohne Anhang, direkt als Mailtext)"
                >
                  ✉️ aus Dokumenten-Text
                </span>
              ) : i.hasFile ? (
                <span className="text-[10px] text-gray-400">nur PDF</span>
              ) : (
                <span className="text-[10px] text-gray-400">—</span>
              )}
              {(i.source === 'SCAN' || i.aiAssisted) && (
                i.aiAssisted && !i.aiConfirmedAt ? (
                  <span
                    className="whitespace-nowrap rounded-full bg-[var(--warn-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn-strong)]"
                    title="Von der KI automatisch erkannt — bitte auf der Detailseite prüfen und bestätigen (erst danach verschiebbar)"
                  >
                    ⏳ KI ungeprüft
                  </span>
                ) : (
                  <span
                    className={`whitespace-nowrap text-[10px] ${i.aiAssisted ? 'text-[var(--accent)]' : 'text-gray-400'}`}
                    title={i.aiAssisted ? 'Felder per KI übernommen und bestätigt' : 'Felder von Hand erfasst'}
                  >
                    {i.aiAssisted ? '✨ KI' : '✋ manuell'}
                  </span>
                )
              )}
            </div>
          </td>
          {!showTrash && (
            <td className="dp-td w-[220px] max-w-[220px]">
              {mailExcerpt(i.mailBodyText) ? (
                <span className="line-clamp-3 whitespace-normal break-words text-[10px] leading-snug text-gray-500" title={i.mailBodyText ?? undefined}>
                  {mailExcerpt(i.mailBodyText)}
                </span>
              ) : (
                <span className="text-[10px] text-gray-300">—</span>
              )}
            </td>
          )}
          {!showTrash && (
            <td className="dp-td">
              {i.hasFile && !i.encrypted ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/invoices/${i.id}/thumbnail`}
                  alt=""
                  loading="lazy"
                  title="Mini-Vorschau des Belegs"
                  className="h-10 w-10 rounded border border-[var(--line)] object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <span className="text-[10px] text-gray-300">—</span>
              )}
            </td>
          )}
          {!showTrash && (
            <td className="dp-td">
              <CheckBadges
                invoiceId={i.id}
                electronicAt={i.checkElectronicAt}
                electronicBy={i.checkElectronicBy}
                formalAt={i.checkFormalAt}
                formalBy={i.checkFormalBy}
                substantiveAt={i.checkSubstantiveAt}
                substantiveBy={i.checkSubstantiveBy}
                accountingAt={i.checkAccountingAt}
                accountingBy={i.checkAccountingBy}
                canApprove={canApprove}
                canAccounting={canHandover}
              />
            </td>
          )}
          <td className="dp-td text-xs">
            {i.hasFile ? <FileLink invoiceId={i.id} encrypted={i.encrypted} origMime={i.origMime} /> : '—'}
          </td>
          {showTrash ? (
            <td className="dp-td">
              <RestoreButton invoiceId={i.id} />
            </td>
          ) : (
            <td className="dp-td">
              {i.locked ? (
                <span className="text-[10px] text-gray-400" title={`Abgeschlossener Prüfungszeitraum ${new Date(i.createdAt).getFullYear()} — schreibgeschützt`}>
                  🔒 gesperrt
                </span>
              ) : canApprove ? (
                <DeleteInvoiceButton invoiceId={i.id} />
              ) : (
                <span className="text-[10px] text-gray-400" title="Kein Recht zum Löschen in diesem Korb">
                  kein Zugriff
                </span>
              )}
            </td>
          )}
        </DraggableInvoiceRow>
        )
      })}
      {visibleRows.length === 0 && (
        <tr>
          <td className="dp-td py-8 text-center text-gray-400" colSpan={colSpan}>
            {showTrash ? 'Papierkorb ist leer.' : 'Keine Rechnungen gefunden.'}
          </td>
        </tr>
      )}
    </>
  )
}
