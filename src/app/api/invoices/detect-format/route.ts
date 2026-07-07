// Sofortige Formaterkennung EINER AUSGEWÄHLTEN DATEI, ohne sie zu speichern —
// für direktes Feedback beim elektronischen Erfassen (RE02a), unmittelbar
// nach der Dateiauswahl: zeigt an, ob ZUGFeRD/XRechnung erkannt wurde (dann
// KEINE KI nötig, Daten schon strukturiert) oder eine "nackte" PDF/ein Bild
// vorliegt (dann KI-Erkennung sinnvoll anbieten, siehe InvoiceEditForm.tsx /
// EINVOICE_FORMATS). Wird clientseitig NUR bei unverschlüsselten Mandanten
// aufgerufen (Zero-Knowledge — sonst dürfte der Klartext den Browser vor dem
// eigentlichen Speichern gar nicht verlassen).
// Liefert bei ZUGFeRD/XRechnung zusätzlich die gelesenen Felder mit zurück
// (nicht nur den Format-Namen) — der Client übernimmt sie SOFORT ins
// Formular, statt erst beim Speichern ("wozu erst warten, die Daten sind ja
// schon da", Stefan 2026-07-07).
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { analyzeInvoiceFile } from '@/lib/erechnung'
import { ALLOWED_MIME, MAX_FILE_BYTES } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    requireTenant(ctx)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Datei erhalten.')
    if (!ALLOWED_MIME.includes(file.type) && !/\.xml$/i.test(file.name)) {
      throw new ApiError(400, 'Dateityp nicht unterstützt.')
    }
    if (file.size > MAX_FILE_BYTES) throw new ApiError(400, 'Datei zu groß (max. 10 MB).')
    const buffer = Buffer.from(await file.arrayBuffer())
    const analysis = await analyzeInvoiceFile(buffer, file.type, file.name)
    return NextResponse.json({
      format: analysis.format,
      validationOk: analysis.validation?.valid ?? null,
      data: analysis.data,
    })
  } catch (e) {
    return jsonError(e)
  }
}
