'use client'

// Betriebssteuerung (§9) — Wartungssperre + Service-Status-Text
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function OpsControls({
  maintenanceLock,
  serviceStatusText,
}: {
  maintenanceLock: boolean
  serviceStatusText: string
}) {
  const router = useRouter()
  const [text, setText] = useState(serviceStatusText)
  const [busy, setBusy] = useState(false)

  async function save(body: { maintenanceLock?: boolean; serviceStatusText?: string }) {
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
        <div className="min-w-[260px] flex-1">
          <label className="dp-label" htmlFor="statusText">Service-Status-Text (leer = ausblenden)</label>
          <div className="mt-1 flex gap-2">
            <input id="statusText" className="dp-input" value={text} maxLength={200}
              onChange={(e) => setText(e.target.value)} placeholder="z. B. Wartung heute 18–19 Uhr" />
            <button disabled={busy} className="btn-primary" onClick={() => save({ serviceStatusText: text })}>
              Speichern
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
