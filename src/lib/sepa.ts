// SEPA-Sammelüberweisung (pain.001.001.03) — Stefan 2026-08-27, Review-Fund
// "welche Export-Module an Fibu noch wichtig wären": aus den erfassten
// Rechnungen wird eine Zahlungsdatei zum Hochladen ins Online-Banking
// erzeugt, statt jede Rechnung von Hand zu überweisen. Reine, serverlose
// Funktion (kein Prisma) — baubar sowohl serverseitig (unverschlüsselte
// Mandanten) als auch später client-seitig (verschlüsselte Mandanten, noch
// nicht umgesetzt, siehe DatevExportButton.tsx-Vorbild). Setzt KEINEN
// Zahlungsstatus — reine, wiederholbare Datei-Erzeugung, kein eigenes
// "bezahlt"-Tracking (das wäre ein eigenes Feature).
import { randomUUID } from 'crypto'

export type SepaDebtor = {
  name: string
  iban: string
  bic: string | null
}

export type SepaCreditorPayment = {
  // Eindeutig innerhalb der Datei (End-to-End-ID) — hier die Dokumenten-ID
  // oder Rechnungs-ID, damit sich eine Buchung im Kontoauszug später wieder
  // einer Rechnung zuordnen lässt.
  endToEndId: string
  creditorName: string
  creditorIban: string
  creditorBic: string | null
  amount: number // Bruttobetrag, > 0
  remittanceInfo: string // Verwendungszweck, z. B. Rechnungsnummer
}

/** Reine Formatprüfung (Prüfziffer, ISO 13616/mod-97) — erkennt Tippfehler, keine Existenzprüfung des Kontos. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  // mod 97 über einen sehr langen numerischen String — in Blöcken rechnen
  // (Zahl kann leicht 40+ Ziffern haben, JS-Number reicht dafür nicht).
  let remainder = 0
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.slice(i, i + 7)) % 97
  }
  return remainder === 1
}

/** Grobe BIC-Formatprüfung (ISO 9362) — 8 oder 11 Zeichen, kein Prüfsummen-Verfahren wie bei IBAN. */
export function isValidBic(raw: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw.replace(/\s+/g, '').toUpperCase())
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * SEPA erlaubt in Namen/Verwendungszweck nur einen eingeschränkten
 * Zeichensatz (lateinische Buchstaben, Ziffern, einige Sonderzeichen) — ohne
 * Bereinigung lehnen viele Banken die Datei komplett ab. Best-effort:
 * Umlaute umschreiben, alles andere Unzulässige entfernen.
 */
function sepaText(raw: string, maxLen: number): string {
  const replaced = raw
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
  // eslint-disable-next-line no-control-regex
  const cleaned = replaced.replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ').replace(/\s+/g, ' ').trim()
  return xmlEscape(cleaned.slice(0, maxLen))
}

function formatAmount(n: number): string {
  return n.toFixed(2)
}

export type SepaBuildResult = { xml: string; totalAmount: number; count: number }

/**
 * Baut eine pain.001.001.03-Datei (SEPA Credit Transfer) für eine
 * Sammelüberweisung — ein PmtInf-Block für alle Zahlungen zusammen
 * (gleiches Ausführungsdatum), das ist die gängige, von so gut wie jeder
 * Bank unterstützte Variante (Einzel-PmtInf je Zahlung wäre auch zulässig,
 * aber unüblich und macht die Datei nur größer).
 */
export function buildSepaCreditTransfer(
  debtor: SepaDebtor,
  payments: SepaCreditorPayment[],
  executionDate: Date,
): SepaBuildResult {
  if (payments.length === 0) throw new Error('Keine Zahlungen übergeben.')
  const msgId = `EINV-${Date.now()}-${randomUUID().slice(0, 8)}`
  const pmtInfId = `${msgId}-P1`
  const now = new Date()
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0)
  const execDate = executionDate.toISOString().slice(0, 10)

  const txs = payments
    .map((p, i) => {
      const endToEndId = sepaText(p.endToEndId, 35) || `TX${i + 1}`
      return `      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${endToEndId}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="EUR">${formatAmount(p.amount)}</InstdAmt>
        </Amt>
        ${p.creditorBic ? `<CdtrAgt>\n          <FinInstnId>\n            <BIC>${xmlEscape(p.creditorBic.toUpperCase())}</BIC>\n          </FinInstnId>\n        </CdtrAgt>` : ''}
        <Cdtr>
          <Nm>${sepaText(p.creditorName, 70)}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${p.creditorIban.replace(/\s+/g, '').toUpperCase()}</IBAN>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${sepaText(p.remittanceInfo, 140)}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${now.toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${formatAmount(totalAmount)}</CtrlSum>
      <InitgPty>
        <Nm>${sepaText(debtor.name, 70)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${pmtInfId}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${formatAmount(totalAmount)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${execDate}</ReqdExctnDt>
      <Dbtr>
        <Nm>${sepaText(debtor.name, 70)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${debtor.iban.replace(/\s+/g, '').toUpperCase()}</IBAN>
        </Id>
      </DbtrAcct>
      ${debtor.bic ? `<DbtrAgt>\n        <FinInstnId>\n          <BIC>${xmlEscape(debtor.bic.toUpperCase())}</BIC>\n        </FinInstnId>\n      </DbtrAgt>` : '<DbtrAgt>\n        <FinInstnId>\n          <Othr>\n            <Id>NOTPROVIDED</Id>\n          </Othr>\n        </FinInstnId>\n      </DbtrAgt>'}
      <ChrgBr>SLEV</ChrgBr>
${txs}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`
  return { xml, totalAmount, count: payments.length }
}
