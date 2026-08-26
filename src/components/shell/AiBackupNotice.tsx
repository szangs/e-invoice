'use client'

// KI-/Sicherungs-Hinweis beim Login (Stefan 2026-08-26): zu bestätigender
// Hinweis, dass KI-erkannte Daten fehlerhaft sein können und regelmäßige
// Sicherungen wichtig sind — nur bei Mandanten mit aktivierter KI, und nur
// wenn seit der letzten Bestätigung genug echte Logins zusammengekommen sind
// (siehe api/session/ai-notice/route.ts). Abschaltbar per Klick, taucht dann
// aber nach ca. 10 weiteren Logins automatisch wieder auf.
import { useEffect, useState } from 'react'

export function AiBackupNotice() {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/session/ai-notice')
      .then((r) => r.json())
      .then((d) => setShow(Boolean(d.show)))
      .catch(() => undefined)
  }, [])

  async function acknowledge() {
    setBusy(true)
    await fetch('/api/session/ai-notice', { method: 'POST' }).catch(() => undefined)
    setBusy(false)
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="font-serif text-lg font-semibold text-gray-800">Kurzer Hinweis</h2>
        <div className="mt-3 space-y-2.5 text-sm text-gray-600">
          <p>
            🤖 <strong>KI-generierte oder -verarbeitete Inhalte können fehlerhaft sein.</strong> Von der KI erkannte
            Rechnungswerte bitte immer gegen den Original-Beleg prüfen, bevor sie übernommen werden.
          </p>
          <p>
            💾 <strong>Regelmäßige Sicherung der Daten ist wichtig.</strong> Bitte prüfen, ob für diesen Mandanten
            eine automatische Sicherung eingerichtet ist (Mandanten-Einstellungen), und Sicherungen von Zeit zu Zeit
            an einem zweiten Ort aufbewahren.
          </p>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-primary" onClick={acknowledge} disabled={busy}
            title="Bestätigen — dieser Hinweis erscheint nach ca. 10 weiteren Anmeldungen erneut">
            {busy ? '…' : 'Verstanden'}
          </button>
        </div>
      </div>
    </div>
  )
}
