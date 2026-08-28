// Verständliche Fehlermeldung für den häufigsten POP3/IMAP-Stolperstein
// (Stefan 2026-08-27, "bei pop kommt Basic auth disabled"): Microsoft hat
// Basic-Auth (Benutzername+Passwort) für POP3/IMAP bei Microsoft 365/Exchange
// Online seit 2022 standardmäßig deaktiviert (Sicherheitsmaßnahme, betrifft
// ALLE Kunden gleich, kein Fehler unsererseits) — der Server antwortet dann
// mit einer Meldung wie "Authentication unsuccessful, basic authentication
// is disabled" bzw. bei IMAP "Basic authentication is not supported for this
// endpoint". Ein Postfach-Passwort kann das grundsätzlich NICHT umgehen; für
// Microsoft-365-Postfächer bleibt nur der Microsoft-Graph-Weg (OAuth2/App-
// Registrierung, siehe graphMailin.ts) oder — falls der Microsoft-365-Admin
// es für dieses eine Postfach explizit reaktiviert (Microsoft rät davon ab
// und blendet die Möglichkeit zunehmend ganz aus) — weiterhin POP3/IMAP.
const BASIC_AUTH_DISABLED_PATTERN = /basic auth/i

export function friendlyMailinAuthError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (BASIC_AUTH_DISABLED_PATTERN.test(raw)) {
    return (
      'Anmeldung mit Benutzername/Passwort abgelehnt: Basic-Auth ist für dieses Postfach deaktiviert. ' +
      'Das ist bei Microsoft 365/Exchange Online der Standard seit 2022 (Microsoft-Sicherheitsrichtlinie, betrifft ' +
      'jeden Kunden gleich) — ein Postfach-Passwort kann das nicht umgehen. Nutzen Sie für dieses Postfach ' +
      'stattdessen "Microsoft Graph API" oben (eigene Azure-App-Registrierung, OAuth2) — ' +
      `nur wenn Ihr Microsoft-365-Administrator Basic-Auth für dieses eine Postfach ausdrücklich reaktiviert hat, funktioniert POP3/IMAP. (Serverantwort: ${raw})`
    )
  }
  return raw
}
