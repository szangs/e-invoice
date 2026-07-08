// Rechnungsliste mit Suche, Statusfilter und CSV-Export
import { InvoiceStatus, Prisma } from '@prisma/client'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { EncryptionUnlockBanner } from '@/components/crypto/EncryptionUnlockBanner'
import { BasketStrip } from '@/components/baskets/BasketStrip'
import { getBasketRightMap, RIGHT_RANK } from '@/lib/basketRights'
import { ensureSystemBaskets, getBasketCounts, sortBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { STATUS_LABELS, toDTO } from '@/lib/invoices'
import { DatevExportButton } from './DatevExportButton'
import { InterfaceRequestForm } from './InterfaceRequestForm'
import { CONTENT_SORT_FIELDS, InvoiceRows, type InvoiceRowData } from './InvoiceRows'

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
  // Körbe zuerst laden — "Alle Körbe" gibt es nicht mehr (Stefan 2026-07-08):
  // die Liste zeigt immer genau einen Korb, ohne Auswahl fällt sie auf den
  // Eingangskorb zurück (dort landet jede neue Rechnung ohnehin zuerst).
  const [basketsRaw, basketCounts, rightMap, tenantRow] = await Promise.all([
    prisma.basket.findMany({ where: { tenantId, deletedAt: null } }),
    getBasketCounts(tenantId, ctx.userId),
    getBasketRightMap(tenantId, ctx.userId, ctx.role),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { datevFibuEmail: true, encryptionEnabled: true } }),
  ])
  const tenantEncryptionEnabled = Boolean(tenantRow?.encryptionEnabled)
  // Suche/Sortierung bei Inhalts-Verschlüsselung (Stefan 2026-07-09, #109):
  // Lieferant/Nummer/Beträge stehen bei verschlüsselten Mandanten nur als
  // Platzhalter/null in der DB — SQL-Suche/-Sortierung nach diesen Feldern
  // würde falsche Ergebnisse liefern. Für solche Mandanten wird die
  // SQL-seitige Suche/Sortierung nach diesen Feldern deshalb übersprungen;
  // InvoiceRows.tsx übernimmt sie stattdessen client-seitig nach dem
  // Entschlüsseln der (max. 200) geladenen Zeilen.
  const sortIsContentField = sortField !== null && CONTENT_SORT_FIELDS.has(sortField)
  const effectiveSortOrderBy = tenantEncryptionEnabled && sortIsContentField ? null : sortOrderBy
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = effectiveSortOrderBy
    ? [effectiveSortOrderBy]
    : [{ invoiceDate: 'desc' }, { createdAt: 'desc' }]
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
    // Bei verschlüsselten Mandanten stehen vendor/invoiceNumber/tags nur als
    // Platzhalter/null in der DB — die SQL-Suche würde nie etwas finden.
    // InvoiceRows.tsx übernimmt die Suche in dem Fall stattdessen client-seitig.
    ...(q && !tenantEncryptionEnabled
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
  const fibuEmailConfigured = Boolean(tenantRow?.datevFibuEmail)
  if (activeBasket?.kind === 'HANDOVER') {
    // Bei verschlüsselten Mandanten ist amountGross serverseitig immer null
    // (der Betrag steckt nur noch in contentEnc) — der Zähler ist hier daher
    // nur eine Obergrenze (vollständig geprüft, noch nicht übergeben); die
    // genaue Zahl entscheidet sich erst nach dem Entschlüsseln im Browser
    // beim Klick auf den Export-Button (siehe DatevExportButton.tsx).
    datevExportCount = await prisma.invoice.count({
      where: {
        tenantId,
        basketId: activeBasket.id,
        deletedAt: null,
        checkAccountingAt: null,
        ...(tenantEncryptionEnabled ? {} : { amountGross: { not: null } }),
        checkElectronicAt: { not: null },
        checkFormalAt: { not: null },
        checkSubstantiveAt: { not: null },
      },
    })
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

  // Serialisierte Zeilen für die client-seitige Tabelle (InvoiceRows.tsx) —
  // übernimmt Anzeige sowie (bei verschlüsselten Mandanten) Suche/Sortierung
  // nach Lieferant/Nummer/Beträgen (Stefan 2026-07-09, #109).
  const invoiceRows: InvoiceRowData[] = invoices.map((i) => ({
    ...toDTO(i),
    unreadNote: unreadNoteInvoiceIds.has(i.id),
    pendingApprovalTitle: pendingByInvoice.has(i.id)
      ? `Vier-Augen-Freigabe nach „${basketById.get(pendingByInvoice.get(i.id)!.targetBasketId)?.name ?? '?'}“ ausstehend (${pendingByInvoice.get(i.id)!.count}/2) — bisher: ${(approverEmailsByInvoice.get(i.id) ?? []).join(', ')}`
      : null,
  }))

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
            readyForHandover: basketCounts[b.id]?.readyForHandover ?? 0,
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
          {tenantEncryptionEnabled && (
            <p className="mt-1 text-[10px] text-gray-400">
              Bei Verschlüsselung wirkt die Suche erst, sobald oben die Passphrase eingegeben wurde.
            </p>
          )}
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
      {invoices.some((i) => i.contentEnc) && <EncryptionUnlockBanner />}

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
            <InvoiceRows
              rows={invoiceRows}
              showTrash={showTrash}
              canMove={canMove}
              canApprove={canApprove}
              canHandover={canHandover}
              q={q}
              sortField={sortField}
              sortDir={sortDir}
              encryptionEnabled={tenantEncryptionEnabled}
            />
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
