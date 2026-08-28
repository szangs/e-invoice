// KoSIT-Prüfung für eine einzelne Rechnung (Stefan 2026-08-26) — auf
// Knopfdruck aus dem Prüfbericht ausgelöst (InvoiceEditForm.tsx), da ein
// Java-Start ein paar Sekunden dauert und nicht bei jeder Rechnung
// automatisch laufen soll. Nur für E-Rechnungen mit gespeichertem XML.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { isKositInstalled } from '@/lib/kositSetup'
import { runKositCheckQueued } from '@/lib/kositValidator'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceContentAccess(ctx, invoice.basketId)
    if (!invoice.xmlData) {
      throw new ApiError(400, 'Diese Rechnung hat kein E-Rechnungs-XML — KoSIT prüft nur XRechnung/ZUGFeRD.')
    }
    if (!isKositInstalled()) {
      throw new ApiError(503, 'KoSIT-Validator ist nicht installiert — bitte im Betreiber-Cockpit einrichten.')
    }
    // Persistiert das Ergebnis gleich mit (Stefan 2026-08-26) — dieselbe
    // Funktion wie beim automatischen Hintergrund-Check nach Ablage, damit
    // ein manuell erneut ausgelöster Check die gespeicherte Anzeige
    // (Listen-Badge, Prüfbericht) konsistent aktualisiert. Über dieselbe
    // Warteschlange wie der automatische Trigger (Stefan 2026-08-26,
    // Review-Fund "'Jetzt prüfen' umgeht die neue KoSIT-Warteschlange") —
    // sonst könnte ein manueller Klick parallel zu einem laufenden
    // Warteschlangen-Eintrag einen zweiten validator.jar-Prozess starten.
    const result = await runKositCheckQueued(invoice.id)
    return NextResponse.json({ result })
  } catch (e) {
    return jsonError(e)
  }
}
