// Rechnungsliste mit Suche, Statusfilter und CSV-Export
import { InvoiceStatus, Prisma } from '@prisma/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileLink } from '@/components/crypto/FileLink'
import { BasketStrip } from '@/components/baskets/BasketStrip'
import { getBasketRightMap, RIGHT_RANK } from '@/lib/basketRights'
import { ensureSystemBaskets, getBasketCounts, sortBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { formatAmount, STATUS_LABELS } from '@/lib/invoices'
import { CheckBadges } from './CheckBadges'
import { DatevExportButton } from './DatevExportButton'
import { DeleteInvoiceButton } from './DeleteInvoiceButton'
import { DraggableInvoiceRow } from './DraggableInvoiceRow'
import { InterfaceRequestForm } from './InterfaceRequestForm'
import { RestoreButton } from './RestoreButton'

export const dynamic = 'force-dynamic'

// Frei wählbare Sortierung (Stefan 2026-07-08): Spaltenüberschriften klickbar,
// Feld + Richtung landen in den Query-Parametern sort/dir, damit der Link
// teilbar/lesezeichenfähig bleibt statt client-seitigem State.
function orderByFor(field: string, dir: 'asc' | 'desc'): Prisma.InvoiceOrderByWithRelationInput | null {
  switch (field) {
    case 'docId': return { docId: dir }
    case 'vendor': return { vendor: dir }
    case 'invoiceNumber': return { invoiceNumber: dir }
    case 'invoiceDate': return { invoiceDate: dir }
    case 'dueDate': return { dueDate: dir }
    case 'createdAt': return { createdAt: dir }
    case 'amountNet': return { amountNet: dir }
    case 'amountGross': return { amountGross: dir }
    case 'status': return { status: dir }
    default: return null
  }
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; dup?: string; trash?: string; basket?: string; sort?: string; dir?: string }
}) {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  const tenantId = ctx.tenantId
  await ensureSystemBaskets(tenantId)
  const q = searchParams.q ?? ''
  const status = Object.values(InvoiceStatus).includes(searchParams.status as InvoiceStatus)
    ? (searchParams.status as InvoiceStatus)
    : undefined

  const hideDuplicates = searchParams.dup === 'hide'
  // Papierkorb: weich gelöschte Rechnungen sind normalerweise ausgeblendet
  const showTrash = searchParams.trash === '1'
  const requestedBasket = searchParams.basket || undefined
  const sortDir: 'asc' | 'desc' = searchParams.dir === 'asc' ? 'asc' : 'desc'
  const sortOrderBy = searchParams.sort ? orderByFor(searchParams.sort, sortDir) : null
  const sortField = sortOrderBy ? searchParams.sort ?? null : null
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = sortOrderBy
    ? [sortOrderBy]
    : [{ invoiceDate: 'desc' }, { createdAt: 'desc' }]
  // Körbe zuerst laden — "Alle Körbe" gibt es nicht mehr (Stefan 2026-07-08):
  // die Liste zeigt immer genau einen Korb, ohne Auswahl fällt sie auf den
  // Eingangskorb zurück (dort landet jede neue Rechnung ohnehin zuerst).
  const [basketsRaw, basketCounts, rightMap] = await Promise.all([
    prisma.basket.findMany({ where: { tenantId, deletedAt: null } }),
    getBasketCounts(tenantId, ctx.userId),
    getBasketRightMap(tenantId, ctx.userId, ctx.role),
  ])
  const baskets = sortBaskets(basketsRaw)
  const basketById = new Map(baskets.map((b) => [b.id, b]))
  const inboxBasket = baskets.find((b) => b.kind === 'INBOX') ?? null

  // Korb-Rechte (Stefan 2026-07-08): Körbe ohne mindestens VIEW werden nicht
  // einmal angezeigt; ein ausgewählter Korb ohne mindestens CONTENT weicht
  // auf den ersten zugänglichen Korb aus (bzw. bleibt leer, falls keiner da ist).
  function rank(id: string | null | undefined): number {
    return id ? (rightMap[id] ?? 0) : 0
  }
  const visibleBaskets = baskets.filter((b) => rank(b.id) >= RIGHT_RANK.VIEW)

  let basketFilter: string | undefined = showTrash ? undefined : (requestedBasket || inboxBasket?.id)
  if (!showTrash && rank(basketFilter) < RIGHT_RANK.CONTENT) {
    basketFilter = visibleBaskets.find((b) => rank(b.id) >= RIGHT_RANK.CONTENT)?.id
  }
  const noBasketAccess = !showTrash && !basketFilter
  const activeBasket = basketFilter ? basketById.get(basketFilter) ?? null : null
  const activeRank = rank(basketFilter)
  const canMove = activeRank >= RIGHT_RANK.MOVE
  const canApprove = activeRank >= RIGHT_RANK.APPROVE
  // "An Buchhaltung übergeben" darf nur im Übergabekorb selbst passieren
  // (Stefan 2026-07-09) — das HANDOVER-Recht allein reicht nicht, sonst
  // könnte jemand mit diesem Recht auf einem anderen Korb die Rechnung schon
  // dort als "übergeben" markieren, bevor sie den Übergabekorb je erreicht hat.
  const canHandover = activeRank >= RIGHT_RANK.HANDOVER && activeBasket?.kind === 'HANDOVER'
  const canFibu = activeRank >= RIGHT_RANK.FIBU

  // Basis-Query-Parameter für Sortier-/Papierkorb-Links — bestehende Filter erhalten
  const baseParams: Record<string, string> = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(hideDuplicates ? { dup: 'hide' } : {}),
    ...(basketFilter ? { basket: basketFilter } : {}),
  }
  function sortHref(field: string): string {
    const dir = sortField === field && sortDir === 'desc' ? 'asc' : 'desc'
    const params = new URLSearchParams({ ...baseParams, sort: field, dir })
    return `/invoices?${params.toString()}`
  }
  function sortArrow(field: string): string {
    if (sortField !== field) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }
  const where: Prisma.InvoiceWhereInput = {
    tenantId: ctx.tenantId,
    deletedAt: showTrash ? { not: null } : null,
    // Kein zugänglicher Korb (Korb-Rechte) → erzwungenermaßen leeres Ergebnis,
    // statt ohne Korb-Filter versehentlich alle Rechnungen des Mandanten zu zeigen.
    ...(noBasketAccess ? { id: '__no_basket_access__' } : {}),
    ...(hideDuplicates ? { duplicateOfId: null } : {}),
    ...(status ? { status } : {}),
    ...(basketFilter ? { basketId: basketFilter } : {}),
    ...(q
      ? {
          OR: [
            { vendor: { contains: q, mode: 'insensitive' } },
            { invoiceNumber: { contains: q, mode: 'insensitive' } },
            { tags: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const [invoices, trashCount] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy, take: 200 }),
    prisma.invoice.count({ where: { tenantId, deletedAt: { not: null } } }),
  ])
  // Zähler + Fibu-Mail-Konfiguration für den DATEV-Export-Button — nur relevant im Übergabekorb
  let datevExportCount = 0
  let fibuEmailConfigured = false
  let tenantEncryptionEnabled = false
  if (activeBasket?.kind === 'HANDOVER') {
    const [count, tenantRow] = await Promise.all([
      prisma.invoice.count({
        where: {
          tenantId,
          basketId: activeBasket.id,
          deletedAt: null,
          checkAccountingAt: null,
          amountGross: { not: null },
          checkElectronicAt: { not: null },
          checkFormalAt: { not: null },
          checkSubstantiveAt: { not: null },
        },
      }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { datevFibuEmail: true, encryptionEnabled: true } }),
    ])
    datevExportCount = count
    fibuEmailConfigured = Boolean(tenantRow?.datevFibuEmail)
    tenantEncryptionEnabled = Boolean(tenantRow?.encryptionEnabled)
  }

  // Ungelesene, an mich adressierte Nachrichten (Stefan 2026-07-08) — kleiner
  // Hinweis in der Liste, damit die Nachricht auch auffällt, ohne jede
  // Rechnung einzeln öffnen zu müssen.
  const unreadNoteRows = ctx.userId
    ? await prisma.invoiceNote.findMany({
        where: { invoiceId: { in: invoices.map((i) => i.id) }, toUserId: ctx.userId, readAt: null },
        select: { invoiceId: true },
      })
    : []
  const unreadNoteInvoiceIds = new Set(unreadNoteRows.map((r) => r.invoiceId))

  const pendingApprovals = showTrash
    ? []
    : await prisma.basketApproval.groupBy({
        by: ['invoiceId', 'targetBasketId'],
        where: { invoiceId: { in: invoices.map((i) => i.id) } },
        _count: { userId: true },
      })
  const pendingByInvoice = new Map<string, { targetBasketId: string; count: number }>()
  for (const p of pendingApprovals) pendingByInvoice.set(p.invoiceId, { targetBasketId: p.targetBasketId, count: p._count.userId })
  const approverEmailsByInvoice = new Map<string, string[]>()
  if (pendingApprovals.length > 0) {
    const rows = await prisma.basketApproval.findMany({
      where: { invoiceId: { in: invoices.map((i) => i.id) } },
      select: { invoiceId: true, user: { select: { email: true } } },
    })
    for (const r of rows) {
      const list = approverEmailsByInvoice.get(r.invoiceId) ?? []
      list.push(r.user.email)
      approverEmailsByInvoice.set(r.invoiceId, list)
    }
  }

  const exportUrl = `/api/invoices/export?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`
  const trashParams = new URLSearchParams({ ...baseParams, ...(showTrash ? {} : { trash: '1' }) })
  const trashHref = `/invoices?${trashParams.toString()}`
  // Basis für die Korb-Kacheln — Filter/Sortierung bleiben beim Wechsel erhalten
  const basketBaseParams: Record<string, string> = {
    ...(q ? { q } : {}), ...(status ? { status } : {}), ...(hideDuplicates ? { dup: 'hide' } : {}),
  }

  return (
    <div className="space-y-4">
      <div className="dp-card">
        <h2 className="mb-3 font-serif text-lg font-semibold text-gray-800" title="Rechnungen wandern durch Körbe wie in der klassischen Rechnungseingangsverarbeitung — die Liste unten zeigt den ausgewählten Korb. Eine Rechnungszeile lässt sich per Drag&Drop auf einen Korb ziehen, um sie zu verschieben.">
          🗂️ Körbe
        </h2>
        <BasketStrip
          baskets={visibleBaskets.map((b) => ({
            id: b.id, name: b.name, kind: b.kind,
            unprocessed: basketCounts[b.id]?.unprocessed ?? 0,
            processed: basketCounts[b.id]?.processed ?? 0,
            dueSoon: basketCounts[b.id]?.dueSoon ?? 0,
            overdue: basketCounts[b.id]?.overdue ?? 0,
            unreadNotes: basketCounts[b.id]?.unreadNotes ?? 0,
          }))}
          activeBasketId={basketFilter ?? null}
          basePath="/invoices"
          baseParams={basketBaseParams}
          allowDrop={!showTrash}
          trash={{ href: trashHref, active: showTrash, count: trashCount, canDelete: canApprove }}
        />
      </div>
      <form className="dp-card flex flex-wrap items-end gap-3" method="get">
        {basketFilter && <input type="hidden" name="basket" value={basketFilter} />}
        <div className="min-w-[220px] flex-1">
          <label className="dp-label" htmlFor="q" title="Durchsucht Lieferant, Rechnungsnummer und Tags gleichzeitig">
            Suche (Lieferant, Nummer, Tags)
          </label>
          <input id="q" name="q" className="dp-input mt-1" defaultValue={q}
            title="Durchsucht Lieferant, Rechnungsnummer und Tags gleichzeitig" />
        </div>
        <div>
          <label className="dp-label" htmlFor="status">Status</label>
          <select id="status" name="status" className="dp-input mt-1" defaultValue={status ?? ''}
            title="Nur Rechnungen mit diesem Bearbeitungsstatus anzeigen">
            <option value="">Alle</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-700"
          title="Als Dublette markierte Rechnungen aus der Liste ausblenden">
          <input type="checkbox" name="dup" value="hide" defaultChecked={hideDuplicates} />
          Dubletten ausblenden
        </label>
        <button className="btn-secondary" type="submit" title="Suche und Filter anwenden">Filtern</button>
        <a className="btn-secondary" href={exportUrl} title="Aktuelle Filterauswahl als CSV-Datei herunterladen">
          CSV-Export
        </a>
        {/* Erfassen/Scannen macht nur im Eingangskorb Sinn — dort landet ohnehin
            jede neue Rechnung zuerst (Stefan 2026-07-08). In anderen Körben
            steht stattdessen die passende Aktion (z. B. Übergabe an die Fibu). */}
        {!showTrash && activeBasket?.kind === 'INBOX' && (
          <>
            <Link className="btn-primary" href="/invoices/new" title="Elektronische Rechnung (PDF, XML, ZUGFeRD/XRechnung, Foto) hochladen">
              Rechnung hinzufügen
            </Link>
            <Link className="btn-secondary" href="/invoices/new/scan" title="Papierbeleg per Handy-Kamera oder Scanner erfassen">
              Papierrechnung scannen
            </Link>
          </>
        )}
        {!showTrash && activeBasket?.kind === 'HANDOVER' && canFibu && (
          <DatevExportButton
            basketId={activeBasket.id}
            count={datevExportCount}
            fibuEmailConfigured={fibuEmailConfigured}
            encryptionEnabled={tenantEncryptionEnabled}
          />
        )}
        {!showTrash && activeBasket?.kind === 'HANDOVER' && !canFibu && (
          <span className="text-xs text-gray-400" title="Kein Recht zur Übergabe an die Fibu — in der Körbe-Verwaltung einstellbar">
            Übergabe an die Fibu — kein Zugriff
          </span>
        )}
      </form>
      {!showTrash && activeBasket?.kind === 'HANDOVER' && (
        <div className="-mt-2">
          <InterfaceRequestForm />
        </div>
      )}
      {showTrash && (
        <p className="text-xs text-gray-500">
          Gelöschte Rechnungen — nur als gelöscht markiert, nicht endgültig entfernt. Beleg bleibt erhalten.
        </p>
      )}
      {noBasketAccess && (
        <p className="dp-card text-sm text-[var(--warn-strong)]">
          Kein Zugriff auf einen Korb — bitte beim Mandanten-Admin die Korb-Rechte für Ihre Rolle einrichten lassen.
        </p>
      )}

      {/* Korb-Name gut lesbar über der Liste statt einer eigenen Spalte
          (Stefan 2026-07-09) — die Liste zeigt ohnehin immer nur die Belege
          des oben gewählten Korbs, eine zusätzliche "Korb"-Spalte war daher
          redundant. Der Verschieben-Button entfällt ebenfalls: Belege lassen
          sich per Drag&Drop auf eine Korb-Kachel oben ziehen; nach der
          Übergabe wandern sie ohnehin automatisch in die Ablage. */}
      <h3 className="px-1 font-serif text-xl font-semibold text-gray-800">
        {showTrash ? 'Papierkorb' : activeBasket?.name ?? 'Rechnungen'}
      </h3>

      <div className="dp-card overflow-x-auto p-0">
        <table className="w-full min-w-[1120px]">
          <thead>
            <tr className="dp-tr">
              <SortTh label="Dok-ID" href={sortHref('docId')} arrow={sortArrow('docId')} />
              <SortTh label="Lieferant" href={sortHref('vendor')} arrow={sortArrow('vendor')} />
              <SortTh label="Nummer" href={sortHref('invoiceNumber')} arrow={sortArrow('invoiceNumber')} />
              <SortTh label="Datum" href={sortHref('invoiceDate')} arrow={sortArrow('invoiceDate')} />
              <SortTh label="Fällig" href={sortHref('dueDate')} arrow={sortArrow('dueDate')} />
              <SortTh label="Eingang" href={sortHref('createdAt')} arrow={sortArrow('createdAt')} />
              <SortTh label="Netto" href={sortHref('amountNet')} arrow={sortArrow('amountNet')} />
              <SortTh label="Brutto" href={sortHref('amountGross')} arrow={sortArrow('amountGross')} />
              <SortTh label="Status" href={sortHref('status')} arrow={sortArrow('status')} />
              <th className="dp-th" title="Beleg-Format und Erfassungsart (elektronisch/Scan, KI/manuell)">Inhalt</th>
              {!showTrash && <th className="dp-th" title="Elektronische Vorprüfung und Formal richtig — Sachlich richtig/An Buchhaltung übergeben direkt anklickbar">Prüfung</th>}
              <th className="dp-th">Beleg</th>
              <th className="dp-th">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <DraggableInvoiceRow key={i.id} invoiceId={i.id} className="dp-tr" disabled={showTrash || !canMove}>
                <td className="dp-td font-mono text-[11px] text-gray-500">{i.docId ?? '—'}</td>
                <td className="dp-td">
                  <Link className="font-medium text-[var(--accent)] hover:underline" href={`/invoices/${i.id}`}>
                    {i.vendor}
                  </Link>
                  {unreadNoteInvoiceIds.has(i.id) && (
                    <span className="ml-1.5" title="Ungelesene Nachricht an Sie — Rechnung öffnen zum Lesen">💬</span>
                  )}
                  {pendingByInvoice.has(i.id) && (
                    <span
                      className="ml-1.5 rounded-full bg-[var(--warn-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn-strong)]"
                      title={`Vier-Augen-Freigabe nach „${basketById.get(pendingByInvoice.get(i.id)!.targetBasketId)?.name ?? '?'}“ ausstehend (${pendingByInvoice.get(i.id)!.count}/2) — bisher: ${(approverEmailsByInvoice.get(i.id) ?? []).join(', ')}`}
                    >
                      ⏳ Freigabe ausstehend
                    </span>
                  )}
                  {i.duplicateOfId && (
                    <span className="ml-1.5 rounded-full bg-[var(--warn-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn-strong)]">
                      Dublette
                    </span>
                  )}
                  {i.tags && <p className="text-[10px] text-gray-400">{i.tags}</p>}
                </td>
                <td className="dp-td font-mono text-xs">{i.invoiceNumber ?? '—'}</td>
                <td className="dp-td text-xs">{i.invoiceDate ? format(i.invoiceDate, 'dd.MM.yyyy', { locale: de }) : '—'}</td>
                <td className="dp-td text-xs">
                  {i.directDebitByVendor
                    ? <span className="text-gray-500" title="Lieferant bucht per Lastschrift/Abbuchung selbst ab">wird abgebucht</span>
                    : i.dueDate ? format(i.dueDate, 'dd.MM.yyyy', { locale: de }) : '—'}
                </td>
                <td className="dp-td whitespace-nowrap text-xs" title="Eingang in E-Invoice">
                  {format(i.createdAt, 'dd.MM.yyyy HH:mm', { locale: de })}
                </td>
                <td className="dp-td">{formatAmount(i.amountNet ? Number(i.amountNet) : null, i.currency)}</td>
                <td className="dp-td">{formatAmount(i.amountGross ? Number(i.amountGross) : null, i.currency)}</td>
                <td className="dp-td">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    i.status === 'REJECTED'
                      ? 'bg-red-50 text-[var(--danger)]'
                      : i.status === 'NEW'
                        ? 'bg-[var(--warn-bg)] text-[var(--warn-strong)]'
                        : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  }`}>{STATUS_LABELS[i.status]}</span>
                </td>
                <td className="dp-td">
                  <div className="flex flex-col items-start gap-0.5">
                    {i.docFormat === 'ZUGFERD' || i.docFormat?.startsWith('XRECHNUNG') ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
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
                      <span className="text-[10px] text-gray-400" title="Inhalt verschlüsselt — nur der Kunde kann ihn lesen">🔒</span>
                    ) : i.source === 'SCAN' ? (
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-semibold text-gray-600" title="Papierrechnung gescannt/fotografiert">
                        📷 Scan
                      </span>
                    ) : i.fileName ? (
                      <span className="text-[10px] text-gray-400">nur PDF</span>
                    ) : (
                      <span className="text-[10px] text-gray-400">—</span>
                    )}
                    {i.source === 'SCAN' && (
                      <span
                        className={`text-[10px] ${i.aiAssisted ? 'text-[var(--accent)]' : 'text-gray-400'}`}
                        title={i.aiAssisted ? 'Felder per KI übernommen — bitte trotzdem gegenprüfen' : 'Felder von Hand erfasst'}
                      >
                        {i.aiAssisted ? '✨ KI' : '✋ manuell'}
                      </span>
                    )}
                  </div>
                </td>
                {!showTrash && (
                  <td className="dp-td">
                    <CheckBadges
                      invoiceId={i.id}
                      electronicAt={i.checkElectronicAt ? i.checkElectronicAt.toISOString() : null}
                      electronicBy={i.checkElectronicBy}
                      formalAt={i.checkFormalAt ? i.checkFormalAt.toISOString() : null}
                      formalBy={i.checkFormalBy}
                      substantiveAt={i.checkSubstantiveAt ? i.checkSubstantiveAt.toISOString() : null}
                      substantiveBy={i.checkSubstantiveBy}
                      accountingAt={i.checkAccountingAt ? i.checkAccountingAt.toISOString() : null}
                      accountingBy={i.checkAccountingBy}
                      canApprove={canApprove}
                      canAccounting={canHandover}
                    />
                  </td>
                )}
                <td className="dp-td text-xs">
                  {i.fileName ? (
                    <FileLink invoiceId={i.id} encrypted={i.encrypted} origMime={i.encOrigMime} />
                  ) : '—'}
                </td>
                {showTrash ? (
                  <td className="dp-td">
                    <RestoreButton invoiceId={i.id} />
                  </td>
                ) : (
                  <td className="dp-td">
                    {canApprove ? (
                      <DeleteInvoiceButton invoiceId={i.id} />
                    ) : (
                      <span className="text-[10px] text-gray-400" title="Kein Recht zum Löschen in diesem Korb">kein Zugriff</span>
                    )}
                  </td>
                )}
              </DraggableInvoiceRow>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td className="dp-td py-8 text-center text-gray-400" colSpan={showTrash ? 12 : 13}>
                  {showTrash ? 'Papierkorb ist leer.' : 'Keine Rechnungen gefunden.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortTh({ label, href, arrow }: { label: string; href: string; arrow: string }) {
  return (
    <th className="dp-th">
      <Link href={href} className="hover:text-[var(--accent)]" title={`Nach ${label} sortieren`}>
        {label}{arrow}
      </Link>
    </th>
  )
}
