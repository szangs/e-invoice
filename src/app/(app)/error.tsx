'use client'

// Globale Fehleranzeige des App-Bereichs — klare Meldung statt Absturz (§22.7)
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="dp-card max-w-md text-center">
        <p className="text-sm font-semibold text-gray-900">Da ist etwas schiefgelaufen.</p>
        <p className="mt-2 text-xs text-gray-500">
          {error.message === 'Kein Mandanten-Kontext' || error.message === 'Keine Berechtigung'
            ? 'Diese Seite ist für Ihre Rolle nicht verfügbar.'
            : 'Die Seite konnte nicht geladen werden. Bitte erneut versuchen.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-primary" onClick={() => reset()}>Erneut versuchen</button>
          <a className="btn-secondary" href="/">Zur Startseite</a>
        </div>
      </div>
    </div>
  )
}
