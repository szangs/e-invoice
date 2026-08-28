'use client'

// Wiederverwendbares Azure-AD-App-Registrierung-Modul (Stefan 2026-08-27,
// "für die Einstellung des Graph Zugriffs greifen wir auf ein Modul zu was
// wir schonmal erstellt haben") — die Schritt-für-Schritt-Anleitung +
// Tenant-ID/Client-ID/Client-Secret-Felder gab es vorher als zwei fast
// identische Kopien: einmal in platform/settings/page.tsx (Betreiber,
// Mail-VERSAND per Graph, Berechtigung "Mail.Send") und einmal in
// SettingsHub.tsx (Mandant, Mail-EINGANG per Graph, Berechtigung
// "Mail.Read"). Jetzt EIN Modul, das den gemeinsamen Kern (Azure-Portal-
// Navigation, Tenant-/Client-ID, Client-Secret, API-Berechtigung +
// Administratorzustimmung) einmal beschreibt — abweichende Details (welche
// Berechtigung, ob ein Postfach-Feld dazugehört, zusätzliche Schritte wie
// eine Application-Access-Policy) kommen als Props/children vom Aufrufer.
import type { ReactNode } from 'react'

export function HelpBox({ summary, steps }: { summary: string; steps: ReactNode[] }) {
  return (
    <details className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 open:pb-3">
      <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--accent)]">
        {summary}
      </summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-gray-600">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </details>
  )
}

export type AzureGraphCredentialValues = { tenantId: string; clientId: string; clientSecret: string }

export function AzureGraphCredentialsGuide({
  registrationNameHint,
  adminHint = 'Ihren Microsoft-365-Admin',
  permission,
  extraSteps,
}: {
  /** Vorschlag für den frei wählbaren App-Namen, z. B. "E-Invoice Mail-Eingang". */
  registrationNameHint: string
  /** Wer die App anlegen muss, z. B. "Ihren Microsoft-365-Admin" oder "einen Tenant-Admin". */
  adminHint?: string
  /** Anwendungsberechtigung, die unter "API-Berechtigungen" hinzugefügt werden muss, z. B. "Mail.Read". */
  permission: string
  /** Zusätzliche, aufrufer-spezifische Schritte — werden nach den gemeinsamen Standard-Schritten angehängt. */
  extraSteps?: ReactNode[]
}) {
  return (
    <HelpBox
      summary={`Anleitung: eigene Azure-AD-App-Registrierung einrichten (braucht ${adminHint}, einmalig)`}
      steps={[
        <>
          Auf <span className="font-mono">portal.azure.com</span> anmelden →{' '}
          <strong>Azure Active Directory</strong> → <strong>App-Registrierungen</strong> →{' '}
          <strong>„Neue Registrierung"</strong>. Name frei wählbar (z. B. „{registrationNameHint}").
        </>,
        <>Auf der Übersichtsseite <strong>Tenant-ID</strong> und <strong>Client-ID</strong> notieren — beide unten eintragen.</>,
        <>
          <strong>„Zertifikate &amp; Geheimnisse"</strong> → <strong>„Neuer geheimer Clientschlüssel"</strong> →
          den angezeigten <strong>Wert</strong> sofort kopieren (nicht die Geheimnis-ID) — das ist das Client-Secret unten.
        </>,
        <>
          <strong>„API-Berechtigungen"</strong> → <strong>„Berechtigung hinzufügen"</strong> → Microsoft Graph →{' '}
          <strong>„Anwendungsberechtigungen"</strong> (nicht „Delegiert") → <span className="font-mono">{permission}</span> hinzufügen.
        </>,
        <><strong>„Administratorzustimmung erteilen"</strong> klicken und bestätigen.</>,
        ...(extraSteps ?? []),
      ]}
    />
  )
}

export function AzureGraphCredentialsFields({
  values,
  onChange,
  disabled,
}: {
  values: AzureGraphCredentialValues
  onChange: (patch: Partial<AzureGraphCredentialValues>) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="dp-label">Tenant-ID (Azure AD)</label>
        <input className="dp-input mt-1" value={values.tenantId} disabled={disabled}
          onChange={(e) => onChange({ tenantId: e.target.value })} />
      </div>
      <div>
        <label className="dp-label">Client-ID (App-Registrierung)</label>
        <input className="dp-input mt-1" value={values.clientId} disabled={disabled}
          onChange={(e) => onChange({ clientId: e.target.value })} />
      </div>
      <div>
        <label className="dp-label">Client-Secret</label>
        <input className="dp-input mt-1" value={values.clientSecret} disabled={disabled}
          placeholder="Nur ändern, wenn neu gesetzt werden soll"
          onChange={(e) => onChange({ clientSecret: e.target.value })} />
      </div>
    </div>
  )
}
