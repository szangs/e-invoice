// Zertifikat für den Perioden-Abschluss des Audit-Protokolls (Stefan
// 2026-08-25, §18): bestätigt förmlich, dass das hashverkettete
// Audit-Protokoll für ein Kalenderjahr abgeschlossen/versiegelt wurde — die
// angegebene Prüfsumme ist der Hash des letzten Eintrags dieser Periode und
// bezeugt durch die Verkettung (lib/audit.ts) kryptografisch ALLE
// vorangegangenen Einträge, nicht nur den letzten.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { APP_COMPANY } from '@/lib/config'

export type AuditClosureData = {
  year: number
  /** Name des Mandanten (Stefan 2026-08-27, Perioden-Abschluss ist jetzt je Mandant statt systemweit). */
  tenantName: string
  closedAt: Date
  closedByName: string
  closedByEmail: string
  entryCount: number
  firstEntryId: number | null
  lastEntryId: number
  chainHash: string
}

function centerText(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>, pageWidth: number) {
  const width = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: (pageWidth - width) / 2, y, size, font, color })
}

export async function buildAuditCertificatePdf(data: AuditClosureData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)

  const navy = rgb(0.09, 0.16, 0.34)
  const gray = rgb(0.42, 0.42, 0.42)
  const lightGray = rgb(0.62, 0.62, 0.62)
  const gold = rgb(0.72, 0.58, 0.13)
  const dark = rgb(0.15, 0.15, 0.15)

  // Dekorativer doppelter Rahmen
  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: navy, borderWidth: 1.5 })
  page.drawRectangle({ x: 36, y: 36, width: width - 72, height: height - 72, borderColor: gold, borderWidth: 0.6 })

  let y = height - 110
  centerText(page, APP_COMPANY.toUpperCase(), y, bold, 11, gray, width)
  y -= 44
  centerText(page, 'ZERTIFIKAT', y, bold, 30, navy, width)
  y -= 24
  centerText(page, 'Abschluss des revisionssicheren Audit-Protokolls', y, italic, 13, gray, width)
  y -= 56

  centerText(page, 'Hiermit wird bestätigt, dass das hashverkettete Audit-Protokoll für das Geschäftsjahr', y, font, 12, dark, width)
  y -= 46
  centerText(page, String(data.year), y, bold, 42, navy, width)
  y -= 30
  centerText(page, `des Mandanten „${data.tenantName}“`, y, italic, 12, gray, width)
  y -= 34
  centerText(page, 'ordnungsgemäß abgeschlossen und versiegelt wurde.', y, font, 12, dark, width)
  y -= 64

  page.drawLine({ start: { x: 90, y: y + 14 }, end: { x: width - 90, y: y + 14 }, thickness: 0.5, color: gold })

  const detailX = 100
  function detail(label: string, value: string, size = 10) {
    page.drawText(label, { x: detailX, y, size, font: bold, color: navy })
    page.drawText(value, { x: detailX + 190, y, size, font, color: dark })
    y -= 20
  }
  detail('Anzahl Einträge:', String(data.entryCount))
  detail('Erster Eintrag der Periode:', data.firstEntryId ? `#${data.firstEntryId}` : '— (keine Einträge vor Periodenbeginn)')
  detail('Letzter Eintrag der Periode:', `#${data.lastEntryId}`)
  detail('Abschluss-Zeitpunkt:', data.closedAt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }))
  y -= 6
  page.drawText('Prüfsumme (SHA-256, Verkettung bis zu diesem Zeitpunkt):', { x: detailX, y, size: 9, font: bold, color: navy })
  y -= 15
  page.drawText(data.chainHash, { x: detailX, y, size: 9, font, color: gray })
  y -= 70

  page.drawLine({ start: { x: detailX, y }, end: { x: detailX + 240, y }, thickness: 0.75, color: dark })
  y -= 16
  page.drawText(data.closedByName, { x: detailX, y, size: 14, font: italic, color: navy })
  y -= 15
  page.drawText(`${data.closedByEmail} · ${data.closedAt.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`, { x: detailX, y, size: 8, font, color: gray })
  y -= 13
  page.drawText('Unterschrift (Name), Datum', { x: detailX, y, size: 8, font: italic, color: lightGray })

  centerText(
    page,
    'Dieses Zertifikat wurde automatisch aus dem Audit-Protokoll erzeugt und kann anhand der Hash-Kette jederzeit unabhängig verifiziert werden.',
    62,
    italic,
    8,
    lightGray,
    width,
  )

  return doc.save()
}
