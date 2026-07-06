'use client'

// Betriebssteuerung (§9): Wartungssperre, Service-Status-Text,
// globaler Zeitabschluss für Support-Sitzungen + Not-Aus.
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function OpsControls({
  maintenanceLock,
  serviceStatusText,
  supportTimeoutMin,
}: {
  maintenanceLock: boolean
  serviceStatusText: string
  supportTimeoutMin: string
}) {
  const router = useRouter()
  const [text, setText] = useState(serviceStatusText)
  const [timeout_, setTimeout_] = useState(supportTimeoutMin)
  const [busy, setBusy] = useState(false)

  async function save(body: Record<string, unknown>) {
    setBusy(true)
    await fetch('/api/platform/ops', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <section className="dp-card">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Betriebssteuerung</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="dp-label mb-1">Wartungs-/Anmeldesperre</p>
          <button
            disabled={busy}
            onClick={() => save({ maintenanceLock: !maintenanceLock })}
            className={maintenanceLock ? 'btn-danger' : 'btn-secondary'}
          >
            {maintenanceLock ? 'Sperre aktiv — aufheben' : 'Sperre aktivieren'}
          </button>
        </div>
        <div className="min-w-[240px] flex-1">
          <label className="dp-label" htmlFor="statusText">Service-Status-Text (leer = ausblenden)</label>
          <div className="mt-1 flex gap-2">
            <input id="statusText" className="dp-input" value={text} maxLength={200}
              onChange={(e) => setText(e.target.value)} placeholder="z. B. Wartung heute 18–19 Uhr" />
            <button disabled={busy} className="btn-primary" onClick={() => save({ serviceStatusText: text })}>
              Speichern
            </button>
          </div>
        </div>
        <div>
          <label className="dp-label" htmlFor="timeout">Support-Zeitabschluss (min)</label>
          <div className="mt-1 flex gap-2">
            <input id="timeout" type="number" min={5} max={480} className="dp-input !w-24"
              value={timeout_} onChange={(e) => setTimeout_(e.target.value)} />
            <button disabled={busy} className="btn-secondary"
              onClick={() => save({ supportTimeoutMin: timeout_ })}>
              OK
            </button>
          </div>
        </div>
        <div>
          <p className="dp-label mb-1">Fernwartung Not-Aus</p>
          <button
            disabled={busy}
            className="btn-danger"
            onClick={() => {
              if (window.confirm('Alle laufenden Fernwartungs-Sitzungen sofort beenden?')) {
                save({ endAllSupport: true })
              }
            }}
          >
            Alle Sitzungen beenden
          </button>
        </div>
      </div>
    </section>
  )
}
