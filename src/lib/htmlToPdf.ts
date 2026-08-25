// Rendert eine HTML-Mail (Rechnung als reiner Mailtext, kein Anhang — häufig
// bei Auslands-/Drittland-Lieferanten) serverseitig zu einem PDF, damit sie
// wie jeder andere Beleg durch dieselbe Erkennung/Klassifikation/Vorschau
// laufen kann. Bewusst ABGESCHOTTET gerendert (Stefan 2026-08-25): der
// HTML-Inhalt kommt aus einer nicht vertrauenswürdigen E-Mail —
// JavaScript ist deaktiviert und JEDE Netzwerkanfrage der Seite wird
// blockiert (kein Nachladen von Bildern/Trackern/Web-Bugs, kein SSRF-Risiko
// über eingebettete Links). Ergebnis kann dadurch optisch schlichter als das
// Original aussehen (fehlende Remote-Bilder), das ist hier der akzeptierte
// Trade-off gegenüber dem Sicherheitsrisiko.
import { chromium } from 'playwright'

/** Gibt `null` zurück statt zu werfen (defektes HTML, Rendering-Timeout etc.) — Aufrufer soll das als "kein Beleg aus dieser Mail" behandeln, kein harter Fehler. */
export async function renderHtmlToPdf(html: string): Promise<Buffer | null> {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.route('**/*', (route) => route.abort())
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 })
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
    })
    return Buffer.from(buf)
  } catch (e) {
    console.error('HTML-zu-PDF-Rendering fehlgeschlagen:', e instanceof Error ? e.message : e)
    return null
  } finally {
    await browser?.close().catch(() => {})
  }
}
