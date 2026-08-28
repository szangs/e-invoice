// Globaler "an mich zur Prüfung übergeben"-Hinweis (Stefan 2026-08-27,
// Fehlerbericht "weitergegebene Belege kommen nicht an") — bewusst UNABHÄNGIG
// von Korb-Rechten: eine Übergabe verschiebt die Rechnung nicht in einen
// anderen Korb (siehe lib/invoiceHandoff.ts), der Empfänger sieht sie also
// sonst überhaupt nicht in seiner normalen Rechnungsliste (die immer nach
// Korb-Rechten gefiltert ist) und würde nie erfahren, dass da etwas wartet.
// Diese Route liefert deshalb gezielt NUR die eigenen offenen Übergaben,
// egal in welchem Korb die Rechnung gerade liegt — siehe HandoffInbox.tsx
// (in (app)/layout.tsx, also auf jeder Seite sichtbar).
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const rows = await prisma.invoiceNote.findMany({
      where: { tenantId, isHandoff: true, doneAt: null, toUserId: ctx.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        invoiceId: true,
        subject: true,
        createdAt: true,
        author: { select: { email: true, firstName: true, lastName: true } },
        invoice: { select: { docId: true, vendor: true, invoiceNumber: true, encrypted: true } },
      },
    })
    return NextResponse.json({
      handoffs: rows.map((r) => ({
        invoiceId: r.invoiceId,
        // vendor/invoiceNumber stehen bei verschlüsselten Belegen nur als
        // Platzhalter/null in der DB (siehe Kommentar in invoices/page.tsx)
        // — docId ist immer im Klartext vorhanden und reicht als Label.
        label: r.invoice.encrypted
          ? r.invoice.docId
          : [r.invoice.vendor, r.invoice.invoiceNumber].filter(Boolean).join(' · ') || r.invoice.docId,
        subject: r.subject,
        authorName: r.author ? [r.author.firstName, r.author.lastName].filter(Boolean).join(' ') || r.author.email : '—',
        createdAt: r.createdAt,
      })),
    })
  } catch (e) {
    return jsonError(e)
  }
}
