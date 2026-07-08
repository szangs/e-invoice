// Prüft für den aktuellen Mandanten, ob die KI-gestützte Datenerkennung
// nutzbar ist — ohne Geheimnisse preiszugeben. Ohne ?invoiceId=… wird der
// Mandanten-weite Verschlüsselungs-Schalter geprüft (Vorab-Check beim Scannen,
// es existiert noch kein Beleg). Mit ?invoiceId=… wird stattdessen der
// Verschlüsselungs-Status DIESES Belegs geprüft (nachträgliche Erkennung auf
// der Rechnungsdetailseite — auch bei Mandanten, die Verschlüsselung erst
// NACH dem Hochladen dieses Belegs aktiviert haben).
//
// Stefan 2026-07-09: KI-Erkennung ist jetzt auch bei aktiver Verschlüsselung
// verfügbar — der Client entschlüsselt den Beleg selbst und schickt NUR für
// diesen einen, bewusst ausgelösten Aufruf die Klartext-Bytes an unseren
// Server, der sie nur an den KI-Anbieter weiterreicht (nie speichert/loggt).
// Wichtig: der externe KI-Anbieter selbst sieht den Klartext immer, unabhängig
// davon, ob der Aufruf client- oder serverseitig läuft — das gilt bewusst als
// Ausnahme vom Zero-Knowledge-Grundsatz für diesen einen, vom Nutzer selbst
// ausgelösten Schritt (siehe Warnhinweis in der UI). `encrypted` im Ergebnis
// sagt dem Client, ob er den Beleg vorher selbst entschlüsseln muss.
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { isAiConfigured } from '@/lib/aiExtract'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new Error('Mandant nicht gefunden')
    if (!tenant.aiAllowed) {
      return NextResponse.json({ available: false, reason: 'KI-Funktionen sind für Ihren Mandanten deaktiviert.' })
    }
    const invoiceId = req.nextUrl.searchParams.get('invoiceId')
    let encrypted = tenant.encryptionEnabled
    if (invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        select: { encrypted: true },
      })
      encrypted = invoice?.encrypted ?? true // nicht gefunden → sicherheitshalber sperren
    }
    if (!(await isAiConfigured())) {
      return NextResponse.json({ available: false, reason: 'Kein KI-Anbieter konfiguriert.' })
    }
    return NextResponse.json({ available: true, encrypted })
  } catch (e) {
    return jsonError(e)
  }
}
