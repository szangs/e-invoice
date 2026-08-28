// Rechnungsdetail — E-Rechnungs-Ansicht (Rechnungsbild) + Bearbeitungsformular
import { notFound, redirect } from 'next/navigation'
import { FileLink } from '@/components/crypto/FileLink'
import { isInvoiceLockedByClosure } from '@/lib/auditClosure'
import { getActiveHandoff } from '@/lib/invoiceHandoff'
import { hasBasketRight } from '@/lib/basketRights'
import { ensureSystemBaskets, sortBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import {
  buyerNameMismatch, classifyTaxRegion, parseInvoiceXml, validateData,
  type DocFormat, type ParsedInvoiceData, type TaxRegion,
} from '@/lib/erechnung'
import { formatAmount, toDTO } from '@/lib/invoices'
import { getVendorAddressSuggestion } from '@/lib/vendorMemory'
import { AttachmentsPanel } from './AttachmentsPanel'
import { BelegPreview } from './BelegPreview'
import { InvoiceEditForm } from './InvoiceEditForm'
import { InvoiceNavigator } from './InvoiceNavigator'
import { InvoiceNotes } from './InvoiceNotes'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  const tenantId = ctx.tenantId
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, tenantId },
  })
  if (!invoice) notFound()

  // Korb-Recht CONTENT nötig, um die Rechnung überhaupt zu öffnen (Stefan
  // 2026-07-09) — sonst könnte jeder Mandanten-Mitarbeiter eine fremde
  // Rechnungs-ID direkt aufrufen, unabhängig von seinen Korb-Rechten.
  // AUSNAHME (Stefan 2026-08-27, Fehlerbericht "weitergegebene Belege
  // kommen nicht an"): die Handoff-Funktion verschiebt die Rechnung bewusst
  // NICHT in einen anderen Korb (siehe lib/invoiceHandoff.ts) — ohne diese
  // Ausnahme würde ein Empfänger ohne Korb-Recht auf den (unveränderten)
  // aktuellen Korb hier sofort wieder rausfliegen, obwohl ihm die Rechnung
  // gerade gezielt übergeben wurde. Wer adressierter Empfänger einer noch
  // offenen Übergabe ist, darf deshalb IMMER rein, unabhängig vom Korb-Recht.
  const activeHandoff = await getActiveHandoff(invoice.id)
  const isHandoffRecipient = activeHandoff?.toUserId === ctx.userId
  if (
    invoice.basketId
    && !isHandoffRecipient
    && !(await hasBasketRight(ctx.userId, ctx.role, invoice.basketId, 'CONTENT'))
  ) {
    redirect('/invoices')
  }

  await ensureSystemBaskets(tenantId)
  const baskets = sortBaskets(await prisma.basket.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, kind: true, position: true },
  }))
  // Freigeben jetzt auch auf der Detailseite (Stefan 2026-08-25) — bisher nur
  // in der Rechnungsliste möglich (CheckBadges.tsx). Korb-Recht APPROVE für
  // "Sachlich richtig" — hier direkt am tatsächlichen aktuellen Korb der
  // Rechnung geprüft, nicht am Listen-Filter. "An Buchhaltung übergeben" gibt
  // es hier NICHT mehr einzeln (Stefan 2026-08-26, "wir machen so immer mehr
  // Buchungsstapel") — nur noch über die Sammelfunktion (DATEV-Export).
  const canApprove = invoice.basketId ? await hasBasketRight(ctx.userId, ctx.role, invoice.basketId, 'APPROVE') : false

  // Pflichtangaben-Schnellausfüllung (Stefan 2026-08-27, "wenn er den
  // Lieferant schon kennt") — liefert null bei aktiver Verschlüsselung
  // (dort serverseitig ohnehin nie befüllt, siehe lib/vendorMemory.ts).
  const vendorSuggestion = await getVendorAddressSuggestion(tenantId, invoice.vendor)

  const approvals = await prisma.basketApproval.findMany({
    where: { invoiceId: invoice.id },
    select: { targetBasketId: true, user: { select: { email: true } } },
  })
  const pending = approvals.length > 0
    ? {
        targetName: baskets.find((b) => b.id === approvals[0].targetBasketId)?.name ?? '?',
        approvedBy: approvals.map((a) => a.user.email),
        needed: Math.max(0, 2 - approvals.length),
      }
    : null

  // Belegfluss (Stefan 2026-08-25): Verschieben-Auswahl auf die für den
  // AKTUELLEN Korb erlaubten Ziele einschränken — nur wenn für ihn überhaupt
  // etwas konfiguriert ist (siehe lib/baskets.ts requestMove, gleiche Regel).
  const transitionsFromCurrent = invoice.basketId
    ? await prisma.basketTransition.findMany({ where: { fromBasketId: invoice.basketId }, select: { toBasketId: true } })
    : []
  const allowedTargetIds = transitionsFromCurrent.length > 0
    ? new Set(transitionsFromCurrent.map((t) => t.toBasketId))
    : null
  const moveTargetBaskets = allowedTargetIds
    ? baskets.filter((b) => b.id === invoice.basketId || allowedTargetIds.has(b.id))
    : baskets

  const [tenant, colleaguesRaw] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { encryptionEnabled: true, costCenterEnabled: true, costCarrierEnabled: true, legalName: true, buyerNameMismatchBlocksHandover: true } }),
    prisma.user.findMany({
      where: { tenantId, active: true },
      select: { id: true, email: true, firstName: true, lastName: true },
      orderBy: { email: 'asc' },
    }),
  ])
  const colleagues = colleaguesRaw.map((u) => ({
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
  }))

  // Rechnungsbild: bei digitalen Formaten die XML-Daten visualisieren
  const parsed = invoice.xmlData ? parseInvoiceXml(invoice.xmlData) : null
  const data = parsed?.data ?? null
  const format = (invoice.docFormat as DocFormat | null) ?? parsed?.format ?? null
  const dto = toDTO(invoice)
  // Inland/EU/Drittland (Stefan 2026-08-25) — Invoice.taxRegion (manuelle
  // Überschreibung) hat Vorrang, sonst automatisch aus dem Länder-Code
  // abgeleitet (aus dem XML bei E-Rechnung, aus der KI-Erkennung sonst).
  // null, wenn beides fehlt — dann fragt die Anzeige den Menschen (siehe
  // ERechnungView.tsx), statt eine falsche Regel stillschweigend anzuwenden.
  const effectiveRegion: TaxRegion | null =
    (dto.taxRegion as TaxRegion | null) ?? classifyTaxRegion(data?.sellerCountryCode ?? dto.sellerCountryCode)
  const validation = data ? validateData(data, effectiveRegion) : null
  // Ruhige Kopfzeilen-Zusammenfassung (Stefan 2026-08-25): früher zeigte NUR
  // eine E-Rechnung oben die ruhige ERechnungView, bei einer per KI/manuell
  // erkannten Rechnung ging es direkt ins dichte Bearbeitungsformular — das
  // fühlte sich wie ein Bruch zwischen den beiden Rechnungsarten an. Jetzt
  // bekommt jede Rechnung dieselbe Kopfzeile, bei fehlenden strukturierten
  // Daten (kein XML) eben aus den gespeicherten Feldern statt aus dem XML —
  // gleiche Komponente, gleicher Aufbau, keine Fallunterscheidung im Layout.
  const fallbackData: ParsedInvoiceData | null = data
    ? null
    : {
        number: dto.invoiceNumber,
        issueDate: dto.invoiceDate,
        dueDate: dto.dueDate,
        deliveryDate: null,
        deliveryPeriodStart: null,
        deliveryPeriodEnd: null,
        sellerName: dto.vendor,
        sellerAddress: dto.sellerAddress,
        buyerAddress: null,
        sellerVatId: dto.sellerVatId,
        sellerTaxNumber: dto.sellerTaxNumber,
        sellerCountryCode: dto.sellerCountryCode,
        buyerName: null,
        net: dto.amountNet,
        tax: dto.amountTax,
        gross: dto.amountGross,
        currency: dto.currency,
        paymentTerms: null,
        discountDueDate: dto.discountDueDate,
        discountPercent: dto.discountPercent,
        taxRates: [],
        documentAllowance: null,
        // KI-Erkennung liest aktuell keine Bankverbindung aus (siehe
        // lib/erechnung.ts sellerIban/sellerBic-Kommentar) — nur bei
        // E-Rechnung (data-Zweig oben) strukturiert verfügbar.
        sellerIban: null,
        sellerBic: null,
        // Von der KI gelesene Positionszeilen (Stefan 2026-08-27, "die
        // Positionszeilen gehören immer zwischen Kopf und Summe, exakt so wie
        // bei den E-Rechnungen"): vorher hier immer leer und stattdessen als
        // eigene, separat platzierte Karte in InvoiceEditForm.tsx gerendert —
        // dadurch sprang die Dateiansicht je nach Rechnungstyp unterschiedlich
        // hoch/niedrig. Jetzt an genau derselben Stelle wie bei E-Rechnungen
        // (zwischen Kopfzeile und Summenblock, siehe ERechnungView.tsx).
        // unitPrice hat InvoiceLine (E-Rechnungs-Format) nicht — geht hier
        // bewusst verloren, damit beide Rechnungstypen exakt dieselbe
        // Tabelle (Position/Menge/Rabatt/Betrag) zeigen.
        lines: (dto.lineItems ?? []).map((l) => ({
          name: l.name, quantity: l.qty, lineTotal: l.total, discount: l.discount,
        })),
      }
  const displayData = data ?? fallbackData

  // Mail-Metadaten (Stefan 2026-08-25): Von/An/Betreff/Empfangen am über das
  // Protokoll des Mail-Eingangs (MailIntake, 1:1 je Rechnung, siehe
  // lib/mailin.ts) — bisher stand im obersten rechten Kasten nur der reine
  // Mailtext ohne jeden Absender-/Betreff-Kontext.
  const mailIntake = invoice.source === 'EMAIL'
    ? await prisma.mailIntake.findFirst({
        where: { invoiceId: invoice.id },
        select: { fromAddress: true, toAddress: true, subject: true, createdAt: true },
      })
    : null
  // Rechnungsversionierung (Stefan 2026-08-25): eine ältere, überholte
  // Version ist ebenfalls schreibgeschützt — dieselbe fieldset-Sperre wie
  // beim Perioden-Abschluss, aber mit eigener Bannermeldung (siehe
  // InvoiceEditForm.tsx, unterschieden über supersededByInvoiceId).
  // "Zur Prüfung weitergeben" (Stefan 2026-08-27, siehe lib/invoiceHandoff.ts)
  // — solange aktiv, ist die Rechnung für jeden außer dem Empfänger
  // schreibgeschützt, genau wie bei Perioden-Abschluss/Versionierung.
  // (activeHandoff/isHandoffRecipient bereits oben ermittelt, für die
  // Korb-Recht-Ausnahme beim Öffnen der Seite.)
  const locked =
    (await isInvoiceLockedByClosure(tenantId, invoice.createdAt)) ||
    invoice.supersededAt !== null ||
    (activeHandoff !== null && !isHandoffRecipient)
  // Vorschlags-Absenderadresse für "Korrektur anfordern" (Stefan 2026-08-25)
  // — aus dem echten senderEmail-Feld (nur bei source=EMAIL gesetzt), der
  // Nutzer sieht/bestätigt sie vor dem Senden im Formular.
  const suggestedVendorEmail = invoice.senderEmail
  // Firmenbezeichnung-Abgleich (Stefan 2026-08-25) — nur relevant, wenn der
  // Mandant eine exakte Firmenbezeichnung hinterlegt hat UND die Rechnung
  // einen strukturierten Rechnungsempfänger enthält. Zusätzlich (Stefan
  // 2026-08-26, Review-Fund "Client ignoriert Mandanten-Einstellung"): nur
  // wenn buyerNameMismatchBlocksHandover aktiv ist — dieselbe Bedingung wie
  // bei der serverseitigen Sperre (getApprovalBlockers, lib/erechnung.ts).
  // Vorher zeigte die Detailseite bei abgeschalteter Einstellung trotzdem
  // "Klärung nötig" für jede Abweichung, obwohl der Server sie längst nicht
  // mehr blockierte.
  const hasBuyerMismatch = Boolean(tenant?.buyerNameMismatchBlocksHandover) && buyerNameMismatch(tenant?.legalName ?? null, data?.buyerName ?? null)
  const buyerNameCheck = hasBuyerMismatch
    ? {
        invoiceId: invoice.id,
        expected: tenant!.legalName!,
        actual: data!.buyerName!,
        acknowledged: invoice.buyerNameMismatchAcknowledged,
        locked,
      }
    : null

  // Weitere Rechnungen aus derselben E-Mail (Stefan 2026-08-25): mehrere
  // PDF-Anhänge in einer Sammel-Mail werden bereits beim Mail-Eingang in
  // getrennte, eigenständige Vorgänge aufgeteilt (lib/mailin.ts
  // processInboundAttachments) — vorher aber ohne jede Verknüpfung
  // untereinander sichtbar, sodass man auf der Detailseite nicht erkennen
  // konnte, dass noch weitere Rechnungen aus derselben Mail existieren.
  // Stefan 2026-08-26: zeigte vorher NUR die anderen Rechnungen (ohne die
  // gerade geöffnete) — bei einer aufgeteilten Mail wirkte das wie "die
  // falsche wird angezeigt", weil man die eigene nirgends in der Liste
  // wiederfand. Jetzt: ALLE Rechnungen dieser Mail (inkl. der aktuellen),
  // Überschrift zeigt Position "X von Y", die aktuelle Zeile ist
  // ausgegraut/nicht klickbar statt einfach zu fehlen.
  const siblingInvoicesRaw = invoice.sourceMessageId
    ? await prisma.invoice.findMany({
        where: { tenantId, sourceMessageId: invoice.sourceMessageId, id: { not: invoice.id }, deletedAt: null },
        select: { id: true, docId: true, vendor: true, invoiceNumber: true, amountGross: true, currency: true, basketId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : []
  const siblingInvoices = (
    await Promise.all(
      siblingInvoicesRaw.map(async (s) => ({
        s,
        allowed: !s.basketId || (await hasBasketRight(ctx.userId, ctx.role, s.basketId, 'CONTENT')),
      })),
    )
  )
    .filter((x) => x.allowed)
    .map((x) => x.s)
  const messageInvoices = [
    ...siblingInvoices,
    { id: invoice.id, docId: invoice.docId, vendor: invoice.vendor, invoiceNumber: invoice.invoiceNumber, amountGross: invoice.amountGross, currency: invoice.currency, basketId: invoice.basketId, createdAt: invoice.createdAt },
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const currentPosition = messageInvoices.findIndex((m) => m.id === invoice.id) + 1

  // Layout (Stefan 2026-07-09, #113): zwei Spalten auf breiten Bildschirmen —
  // links die Daten (E-Rechnungs-Auswertung + Bearbeitungsformular), rechts
  // sticky das Belegbild, damit man beim Ablesen/Übertragen nicht scrollen
  // muss. Gilt für ZUGFeRD/XRechnung genauso wie für reine Scans (vorher gab
  // es dort gar kein Bild auf dieser Seite). Auf schmalen Bildschirmen fällt
  // die rechte Spalte einfach unter die linke.
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-6">
        <InvoiceNavigator currentId={invoice.id} />
        <InvoiceEditForm
          format={format}
          erechnungData={displayData}
          validation={validation}
          effectiveRegion={effectiveRegion}
          buyerNameCheck={buyerNameCheck}
          validationMissing={validation && !validation.valid && !dto.pflichtangabenIgnoredAt ? validation.missing : null}
          suggestedVendorEmail={suggestedVendorEmail}
          invoice={dto}
          baskets={moveTargetBaskets}
          pendingApproval={pending}
          canApprove={canApprove}
          vendorSuggestion={vendorSuggestion}
          encryptionEnabled={tenant?.encryptionEnabled ?? false}
          costCenterEnabled={tenant?.costCenterEnabled ?? false}
          costCarrierEnabled={tenant?.costCarrierEnabled ?? false}
          colleagues={colleagues}
          locked={locked}
          supersededByInvoiceId={invoice.supersededByInvoiceId}
          activeHandoff={
            activeHandoff
              ? {
                  noteId: activeHandoff.noteId,
                  toUserId: activeHandoff.toUserId,
                  toUserName: activeHandoff.toUserName,
                  authorName: activeHandoff.authorName,
                  subject: activeHandoff.subject,
                  text: activeHandoff.text,
                  createdAt: activeHandoff.createdAt.toISOString(),
                  isRecipient: isHandoffRecipient,
                  isAuthor: activeHandoff.authorId === ctx.userId,
                }
              : null
          }
        />
        <InvoiceNotes invoiceId={invoice.id} />
      </div>
      <div className="space-y-4 lg:sticky lg:top-4">
        {/* Mailtext GANZ OBEN (Stefan 2026-08-25): unabhängig vom Beleg selbst
            eintreffende Zusatzinformation — steht deshalb VOR der eigentlichen
            Beleg-Visualisierung, klar als E-Mail-Nachricht statt als Rechnung
            gekennzeichnet, damit Herkunft und Bedeutung sofort klar sind. */}
        {(invoice.mailBodyText || mailIntake) && (
          <div>
            <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-gray-500"
              title="Metadaten und Text der E-Mail, mit der dieser Beleg eintraf — kann zusätzliche, nicht auf dem Beleg selbst stehende Hinweise enthalten">
              ✉️ Als E-Mail-Nachricht empfangen
            </h3>
            <div className="dp-card space-y-2.5">
              {mailIntake && (
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <span className="text-gray-400">Von</span>
                  <span className="truncate text-gray-700">{mailIntake.fromAddress}</span>
                  <span className="text-gray-400">An</span>
                  <span className="truncate text-gray-700">{mailIntake.toAddress}</span>
                  {mailIntake.subject && (
                    <>
                      <span className="text-gray-400">Betreff</span>
                      <span className="truncate text-gray-700">{mailIntake.subject}</span>
                    </>
                  )}
                  <span className="text-gray-400">Empfangen</span>
                  <span className="text-gray-700">{new Date(mailIntake.createdAt).toLocaleString('de-DE')}</span>
                </div>
              )}
              {invoice.mailBodyText && (
                <div className={mailIntake ? 'border-t border-[var(--line)] pt-2.5' : undefined}>
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-muted)] p-2.5 font-sans text-xs text-gray-700">
                    {invoice.mailBodyText}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Weitere Rechnungen aus derselben Sammel-Mail (Stefan 2026-08-25):
            wurden schon beim Mail-Eingang automatisch in getrennte Vorgänge
            aufgeteilt (ein PDF-Anhang = eine Rechnung), aber ohne diesen
            Block war der Zusammenhang auf der Detailseite nicht mehr
            erkennbar — sah aus wie nur EIN Beleg, obwohl mehrere ankamen. */}
        {siblingInvoices.length > 0 && (
          <div>
            <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-gray-500"
              title="Diese Rechnungen kamen als separate Anhänge derselben E-Mail an und wurden automatisch in eigenständige Vorgänge aufgeteilt">
              📎 Erkannte Rechnung(en) dieser E-Mail ({currentPosition} von {messageInvoices.length})
            </h3>
            <div className="dp-card space-y-1.5">
              {/* Stefan 2026-08-26: die aktuell angezeigte Rechnung war
                  vorher AUSGEGRAUT (wie ein deaktivierter Link) — sah aus,
                  als wäre gerade das NICHT das oben gezeigte Dokument,
                  genau umgekehrt zur Absicht. Jetzt hervorgehoben statt
                  gedimmt, die anderen (klickbaren) bleiben normal. */}
              {messageInvoices.map((s) =>
                s.id === invoice.id ? (
                  <span key={s.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2 py-1.5 text-sm font-semibold text-[var(--accent)]"
                    title="Diese Rechnung wird gerade oben angezeigt">
                    <span className="truncate">
                      <span className="font-mono text-xs text-[var(--accent-soft)]">{s.docId}</span>{' '}
                      {s.vendor}{s.invoiceNumber ? ` · ${s.invoiceNumber}` : ''} (diese Rechnung)
                    </span>
                    <span className="shrink-0 text-xs">
                      {s.amountGross !== null ? formatAmount(Number(s.amountGross), s.currency) : '—'}
                    </span>
                  </span>
                ) : (
                  <a key={s.id} href={`/invoices/${s.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-muted)]">
                    <span className="truncate">
                      <span className="font-mono text-xs text-gray-400">{s.docId}</span>{' '}
                      {s.vendor}{s.invoiceNumber ? ` · ${s.invoiceNumber}` : ''}
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {s.amountGross !== null ? formatAmount(Number(s.amountGross), s.currency) : '—'}
                    </span>
                  </a>
                ),
              )}
            </div>
          </div>
        )}
        {invoice.fileName && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500"
                title={invoice.htmlRendered
                  ? 'Kein vom Lieferanten mitgeschicktes Original — aus dem HTML-Mailtext oben nachgebildet'
                  : 'Der eigentliche Rechnungsbeleg'}>
                📄 Beleg{invoice.htmlRendered ? ' (aus Dokumenten-Text rekonstruiert, kein Original)' : ''}
              </h3>
              {/* Dateiname als Link statt einer eigenen Zeile weiter unten
                  (Stefan 2026-08-26) — direkt neben der Vorschau, auf die er sich bezieht. */}
              <FileLink
                invoiceId={invoice.id}
                encrypted={invoice.encrypted}
                origMime={invoice.encOrigMime}
                label={invoice.originalName ?? 'öffnen'}
              />
            </div>
            <BelegPreview
              invoiceId={invoice.id}
              encrypted={invoice.encrypted}
              origMime={invoice.encOrigMime}
              mimeType={invoice.mimeType}
              originalName={invoice.originalName}
              mockData={data}
              mockFormat={format}
            />
          </div>
        )}
        {/* Weitere Anhänge UNTER dem Beleg (Stefan 2026-08-25): bewusst
            nachrangig zur eigentlichen Beleg-Visualisierung, jetzt visuell
            statt nur als Download-Link dargestellt. */}
        <AttachmentsPanel invoiceId={invoice.id} encryptionEnabled={tenant?.encryptionEnabled ?? false} locked={locked} />
      </div>
    </div>
  )
}
