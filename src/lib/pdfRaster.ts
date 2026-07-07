// PDF-Rasterung: erste Seite einer PDF als PNG rendern.
// Grund: eine "nackte" PDF (ohne eingebettetes ZUGFeRD-/XRechnung-XML) hat
// kein Bildformat, das eine Vision-KI lesen könnte. Läuft SERVERSEITIG (statt
// nur im Browser wie das PDF-Zusammenführen beim Scannen), damit die
// KI-Erkennung auch beim automatischen E-Mail-Eingang funktioniert, wo kein
// Browser zur Verfügung steht. Nutzt @napi-rs/canvas (vorgefertigte
// Bin­ärdateien je Plattform, keine Build-Tools nötig — im Unterschied zum
// klassischen "canvas"-Paket).
//
// Achtung: pdfjs-dist ist primär für Browser gebaut; der "legacy"-Build läuft
// zwar in Node, benötigt aber eine eigene CanvasFactory, damit auch interne
// Hilfs-Canvases (z. B. für Muster/Verläufe) über @napi-rs/canvas statt über
// das DOM erzeugt werden.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfJsCanvasAndContext = { canvas: any; context: any }

class NapiCanvasFactory {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createCanvas: any

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(createCanvasFn: any) {
    this.createCanvas = createCanvasFn
  }

  create(width: number, height: number): PdfJsCanvasAndContext {
    const canvas = this.createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
    const context = canvas.getContext('2d')
    return { canvas, context }
  }

  reset(canvasAndContext: PdfJsCanvasAndContext, width: number, height: number) {
    canvasAndContext.canvas.width = Math.max(1, Math.ceil(width))
    canvasAndContext.canvas.height = Math.max(1, Math.ceil(height))
  }

  destroy(canvasAndContext: PdfJsCanvasAndContext) {
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
  }
}

/**
 * Rendert die erste Seite einer PDF als PNG-Buffer.
 * Gibt `null` zurück (statt zu werfen), wenn die PDF nicht gerendert werden
 * konnte (z. B. defekt, passwortgeschützt) — Aufrufer soll das als
 * "KI-Erkennung hier nicht möglich" behandeln, nicht als harten Fehler.
 */
export async function rasterizeFirstPage(pdfBuffer: Buffer, scale = 2): Promise<Buffer | null> {
  try {
    // Dynamischer Import: hält das normale Server-Bundle schlank (nur bei
    // Bedarf geladen), analog zum dynamischen pdf-lib-Import in der Scan-Seite.
    const [pdfjsLib, canvasMod] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas'),
    ])
    const factory = new NapiCanvasFactory(canvasMod.createCanvas)
    const loadingTask = (pdfjsLib as unknown as {
      getDocument: (opts: object) => { promise: Promise<unknown> }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).getDocument({ data: new Uint8Array(pdfBuffer), canvasFactory: factory, isEvalSupported: false })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (await loadingTask.promise) as any
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale })
    const canvasAndContext = factory.create(viewport.width, viewport.height)
    await page.render({ canvasContext: canvasAndContext.context, viewport, canvasFactory: factory }).promise
    const png: Buffer = canvasAndContext.canvas.toBuffer('image/png')
    await doc.destroy()
    return png
  } catch (e) {
    console.error('PDF-Rasterung fehlgeschlagen:', e instanceof Error ? e.message : e)
    return null
  }
}
