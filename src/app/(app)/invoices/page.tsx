// Rechnungsliste mit Suche, Statusfilter und CSV-Export
import { InvoiceStatus, Prisma } from '@prisma/client'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { EncryptionUnlockBanner } from '@/components/crypto/EncryptionUnlockBanner'
import { BasketStrip } from '@/components/baskets/BasketStrip'
import { getClosedYears } from '@/lib/auditClosure'
import { getBasketRightMap, RIGHT_RANK } from '@/lib/basketRights'
import { ensureSystemBaskets, getBasketCounts, sortBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { STATUS_LABELS, toDTO } from '@/lib/invoices'
import { ColumnSettingsButton } from './ColumnSettingsButton'
import { ColumnVisibilityProvider } from './columnVisibility'
import { DatevExportButton } from './DatevExportButton'
import { SepaExportButton } from './SepaExportButton'
import { InterfaceRequestForm } from './InterfaceRequestForm'
import { InvoiceTableHead } from './InvoiceTableHead'
import { CONTENT_SORT_FIELDS, InvoiceRows, type InvoiceRowData } from './InvoiceRows'
import { SearchInput } from './SearchInput'
import { BulkActionBar, InvoiceSelectionProvider } from './InvoiceSelection'

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

// Volltextsuche für unverschlüsselte Mandanten (Stefan 2026-08-27, "eine
// Volltextsuche kann ich mit der Verschlüsselung vergessen oder?") — nutzt
// die generierte tsvector-Spalte (Invoice.searchVector, deckt Lieferant/
// Rechnungsnummer/Tags/Notizen/Mailtext ab) PLUS weiterhin ILIKE auf
// Lieferant/Rechnungsnummer (Teilstring-Treffer, z. B. eine unvollständig
// getippte Rechnungsnummer — das kann eine reine Wort-Volltextsuche nicht).
async function getFullTextMatchIds(tenantId: string, q: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Invoice"
    WHERE "tenantId" = ${tenantId}
      AND (
        "searchVector" @@ websearch_to_tsquery('german', ${q})
        OR vendor ILIKE '%' || ${q} || '%'
        OR "invoiceNumber" ILIKE '%' || ${q} || '%'
      )
    LIMIT 500
  `
  return rows.map((r) => r.id)
}

// Blind-Index-Suche für VERSCHLÜSSELTE Mandanten (Stefan 2026-08-27) — der
// Browser hat die Suchbegriffe bereits zu Hashes verarbeitet (siehe
// lib/clientCrypto.ts computeSearchTokens); hier nur noch Hash-gegen-Hash-
// Abgleich, nie Klartext. UND-Verknüpfung bei mehreren Tokens (Mehrwort-
// Suche): eine Rechnung muss ALLE übergebenen Tokens tragen.
async function getBlindIndexMatchIds(tenantId: string, tokens: string[]): Promise<string[]> {
  if (tokens.length === 0) return []
  const rows = await prisma.invoiceSearchToken.groupBy({
    by: ['invoiceId'],
    where: { tenantId, token: { in: tokens } },
    _count: { token: true },
  })
  return rows.filter((r) => r._count.token === tokens.length).map((r) => r.invoiceId)
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { q?: string; token?: string; status?: string; dup?: string; trash?: string; basket?: string; sort?: string; dir?: string }
}) {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  const tenantId = ctx.tenantId
  await ensureSystemBaskets(tenantId)
  const q = searchParams.q ?? ''
  // Blind-Index-Tokens (Stefan 2026-08-27) — kommagetrennte Hex-Hashes, vom
  // Browser bereits aus dem Suchtext berechnet (siehe SearchForm.tsx).
  const blindTokens = (searchParams.token ?? '').split(',').map((t) => t.trim()).filter(Boolean)
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
  const [basketsRaw, basketCounts, rightMap, tenantRow, closedYears] = await Promise.all([
    prisma.basket.findMany({ where: { tenantId, deletedAt: null } }),
    getBasketCounts(tenantId, ctx.userId, ctx.role),
    getBasketRightMap(tenantId, ctx.userId, ctx.role),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { datevFibuEmail: true, encryptionEnabled: true } }),
    getClosedYears(tenantId),
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
  const canFibu = activeRank >= RIGHT_RANK.FIBU

  // Basis-Query-Parameter für Sortier-/Papierkorb-Links — bestehende Filter erhalten
  const baseParams: Record<string, string> = {
    ...(q ? { q } : {}),
    ...(blindTokens.length > 0 ? { token: blindTokens.join(',') } : {}),
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
  // Suche (Stefan 2026-08-27, siehe getFullTextMatchIds/getBlindIndexMatchIds
  // oben): für unverschlüsselte Mandanten eine echte Volltextsuche (tsvector,
  // deckt jetzt auch Notizen/Mailtext ab, nicht mehr nur drei Spalten); für
  // verschlüsselte Mandanten ein Blind-Index-Abgleich über bereits vom
  // Browser gehashte Suchbegriffe — beide liefern nur eine ID-Liste, die wie
  // jeder andere Filter unten in die normale Abfrage einfließt (Sortierung/
  // Korb-/Status-Filter bleiben unverändert erhalten, egal welcher Suchweg).
  const fullTextMatchIds = q && !tenantEncryptionEnabled ? await getFullTextMatchIds(tenantId, q) : null
  const blindMatchIds = blindTokens.length > 0 && tenantEncryptionEnabled ? await getBlindIndexMatchIds(tenantId, blindTokens) : null
  const searchMatchIds = fullTextMatchIds ?? blindMatchIds

  const where: Prisma.InvoiceWhereInput = {
    tenantId: ctx.tenantId,
    deletedAt: showTrash ? { not: null } : null,
    // Kein zugänglicher Korb (Korb-Rechte) → erzwungenermaßen leeres Ergebnis,
    // statt ohne Korb-Filter versehentlich alle Rechnungen des Mandanten zu zeigen.
    ...(noBasketAccess ? { id: '__no_basket_access__' } : {}),
    ...(hideDuplicates ? { duplicateOfId: null } : {}),
    ...(status ? { status } : {}),
    ...(basketFilter ? { basketId: basketFilter } : {}),
    ...(searchMatchIds ? { id: { in: searchMatchIds } } : {}),
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

  // Offene (nicht erledigte), an mich adressierte oder "an alle" gerichtete
  // Nachrichten (Stefan 2026-07-08, erweitert 2026-08-26 um den Erledigt-
  // Status statt nur den Lesestatus — "gehört zum Dokument", bleibt also
  // sichtbar bis abgehakt, nicht nur bis zum ersten Öffnen) — kleiner Hinweis
  // in der Liste, damit die Nachricht auch auffällt, ohne jede Rechnung
  // einzeln öffnen zu müssen.
  const unreadNoteRows = ctx.userId
    ? await prisma.invoiceNote.findMany({
        where: {
          invoiceId: { in: invoices.map((i) => i.id) },
          doneAt: null,
          OR: [{ toUserId: ctx.userId }, { toUserId: null }],
        },
        select: { invoiceId: true },
      })
    : []
  const unreadNoteInvoiceIds = new Set(unreadNoteRows.map((r) => r.invoiceId))

  // "Zur Prüfung weitergeben" (Stefan 2026-08-27, siehe lib/invoiceHandoff.ts)
  // — Status in der Liste sichtbar machen, nicht erst beim Öffnen der
  // Rechnung. Höchstens ein aktiver Handoff je Rechnung (serverseitig
  // erzwungen, siehe api/invoices/[id]/notes/route.ts POST).
  const activeHandoffRows = await prisma.invoiceNote.findMany({
    where: { invoiceId: { in: invoices.map((i) => i.id) }, isHandoff: true, doneAt: null },
    select: { invoiceId: true, toUserId: true, toUser: { select: { email: true, firstName: true, lastName: true } } },
  })
  const handoffByInvoiceId = new Map(
    activeHandoffRows.map((r) => [
      r.invoiceId,
      {
        toUserName: [r.toUser?.firstName, r.toUser?.lastName].filter(Boolean).join(' ') || r.toUser?.email || '—',
        isRecipient: r.toUserId === ctx.userId,
      },
    ]),
  )

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

  // Sammel-Mail-Split sichtbar machen (Stefan 2026-08-25): mehrere PDF-Anhänge
  // in einer Mail werden automatisch in getrennte Vorgänge aufgeteilt (siehe
  // lib/mailin.ts) — ohne diesen Hinweis war in der Liste nicht erkennbar,
  // dass eine Zeile zu einer Sammel-Mail gehört. Zählung unabhängig von der
  // aktuellen Seite/Filterung, damit ein Geschwister außerhalb der Seite
  // trotzdem erkannt wird.
  const sourceMessageIds = Array.from(
    new Set(invoices.map((i) => i.sourceMessageId).filter((x): x is string => Boolean(x))),
  )
  const siblingCounts = sourceMessageIds.length > 0
    ? await prisma.invoice.groupBy({
        by: ['sourceMessageId'],
        where: { tenantId, sourceMessageId: { in: sourceMessageIds }, deletedAt: null },
        _count: { id: true },
      })
    : []
  const siblingCountMap = new Map(siblingCounts.map((s) => [s.sourceMessageId, s._count.id]))

  // Serialisierte Zeilen für die client-seitige Tabelle (InvoiceRows.tsx) —
  // übernimmt Anzeige sowie (bei verschlüsselten Mandanten) Suche/Sortierung
  // nach Lieferant/Nummer/Beträgen (Stefan 2026-07-09, #109).
  const invoiceRows: InvoiceRowData[] = invoices.map((i) => ({
    ...toDTO(i),
    unreadNote: unreadNoteInvoiceIds.has(i.id),
    pendingApprovalTitle: pendingByInvoice.has(i.id)
      ? `Vier-Augen-Freigabe nach „${basketById.get(pendingByInvoice.get(i.id)!.targetBasketId)?.name ?? '?'}“ ausstehend (${pendingByInvoice.get(i.id)!.count}/2) — bisher: ${(approverEmailsByInvoice.get(i.id) ?? []).join(', ')}`
      : null,
    // Perioden-Abschluss (§18, Stefan 2026-08-25): Beleg-Eingang fällt in ein
    // bereits abgeschlossenes Jahr → schreibgeschützt (siehe lib/auditClosure.ts).
    // Rechnungsversionierung: eine überholte, ältere Version ist ebenfalls
    // gesperrt (siehe schema.prisma Invoice.supersededAt) — unterscheidet
    // sich in InvoiceRows.tsx nur im Icon/Tooltip.
    locked:
      closedYears.has(i.createdAt.getFullYear()) ||
      i.supersededAt !== null ||
      Boolean(handoffByInvoiceId.get(i.id) && !handoffByInvoiceId.get(i.id)!.isRecipient),
    hasSiblings: Boolean(i.sourceMessageId) && (siblingCountMap.get(i.sourceMessageId!) ?? 0) > 1,
    handoff: handoffByInvoiceId.get(i.id) ?? null,
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
          livePulse={!showTrash}
        />
      </div>
      <form className="dp-card flex flex-wrap items-end gap-3" method="get">
        {basketFilter && <input type="hidden" name="basket" value={basketFilter} />}
        <div className="min-w-[220px] flex-1">
          <label className="dp-label" htmlFor="q"
            title={tenantEncryptionEnabled
              ? 'Durchsucht Lieferant und Rechnungsnummer (Wort-Treffer)'
              : 'Durchsucht Lieferant, Rechnungsnummer, Tags und Notizen'}>
            {tenantEncryptionEnabled ? 'Suche (Lieferant, Nummer)' : 'Suche (Lieferant, Nummer, Tags, Notizen)'}
          </label>
          <SearchInput q={q} encryptionEnabled={tenantEncryptionEnabled} />
          {tenantEncryptionEnabled && (
            <p className="mt-1 text-[10px] text-gray-400">
              Bei Verschlüsselung wirkt die Suche erst, sobald oben die Passphrase eingegeben wurde — dann als
              Wort-Treffer (kein Teilstring wie bei unverschlüsselten Mandanten).
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
          <>
            <DatevExportButton
              basketId={activeBasket.id}
              count={datevExportCount}
              fibuEmailConfigured={fibuEmailConfigured}
              encryptionEnabled={tenantEncryptionEnabled}
            />
            <SepaExportButton basketId={activeBasket.id} encryptionEnabled={tenantEncryptionEnabled} />
          </>
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

      <InvoiceSelectionProvider>
      <ColumnVisibilityProvider scopeKey={showTrash ? 'trash' : basketFilter ?? 'all'}>
      {!showTrash && (
        <BulkActionBar
          baskets={visibleBaskets.map((b) => ({ id: b.id, name: b.name }))}
          currentBasketId={basketFilter ?? null}
          canMove={canMove}
          canApprove={canApprove}
        />
      )}
      <div className="flex justify-end">
        <ColumnSettingsButton />
      </div>
      <div className="dp-card overflow-x-auto p-0">
        <table className="w-full min-w-[1120px]">
          <InvoiceTableHead
            showTrash={showTrash}
            invoiceIds={invoiceRows.map((r) => r.id)}
            sorts={{
              docId: { label: 'Dok-ID', href: sortHref('docId'), arrow: sortArrow('docId') },
              vendor: { label: 'Lieferant', href: sortHref('vendor'), arrow: sortArrow('vendor') },
              invoiceNumber: { label: 'Nummer', href: sortHref('invoiceNumber'), arrow: sortArrow('invoiceNumber') },
              invoiceDate: { label: 'Datum', href: sortHref('invoiceDate'), arrow: sortArrow('invoiceDate') },
              dueDate: { label: 'Fällig', href: sortHref('dueDate'), arrow: sortArrow('dueDate') },
              createdAt: { label: 'Eingang', href: sortHref('createdAt'), arrow: sortArrow('createdAt') },
              amountNet: { label: 'Netto', href: sortHref('amountNet'), arrow: sortArrow('amountNet') },
              amountGross: { label: 'Brutto', href: sortHref('amountGross'), arrow: sortArrow('amountGross') },
              status: { label: 'Status', href: sortHref('status'), arrow: sortArrow('status') },
            }}
          />
          <tbody>
            <InvoiceRows
              rows={invoiceRows}
              showTrash={showTrash}
              canMove={canMove}
              canApprove={canApprove}
              q={q}
              serverMatched={blindMatchIds !== null}
              sortField={sortField}
              sortDir={sortDir}
              encryptionEnabled={tenantEncryptionEnabled}
            />
          </tbody>
        </table>
      </div>
      </ColumnVisibilityProvider>
      </InvoiceSelectionProvider>
    </div>
  )
}
