// Eigenständige Seite entfernt (Stefan 2026-08-25) — Einlieferungs-Adresse +
// Erklärtext stehen jetzt in den Mandanten-Einstellungen, der Verlauf im
// Audit-Protokoll (siehe nav-config.ts). Weiterleitung für alte Lesezeichen/Links.
import { redirect } from 'next/navigation'

export default function MailinPageRedirect() {
  redirect('/audit')
}
