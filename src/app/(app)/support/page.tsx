'use client'

// Support-Seite (SU01): Fernwartung anfordern, Status sehen, jederzeit beenden (§14A)
import { useEffect, useState } from 'react'

type SupportSessionDTO = {
  id: string
  status: 'REQUESTED' | 'ACTIVE' | 'ENDED' | 'DECLINED'
  initiatedBy: string
  createdAt: string
} | null

const STATUS_TEXT: Record<string, string> = {
  REQUESTED: 'angefragt — wartet auf den Support',
  ACTIVE: 'aktiv — Bildschirm wird gespiegelt',
  ENDED: 'beendet',
  DECLINED: 'abgelehnt',
}

export default function SupportPage() {
  const [session, setSession] = useState<SupportSessionDTO>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function load() {
    const res = await fetch('/api/support', { cache: 'no-store' })
    if (res.ok) setSession((await res.json()).session)
    setLoaded(true)
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  async function request() {
    setBusy(true)
    await fetch('/api/support', { method: 'POST' })
    await load()
    setBusy(false)
  }

  async function end() {
    if (!session) return
    setBusy(true)
    await fetch(`/api/support/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end' }),
    })
    await load()
    setBusy(false)
  }

  const open = session && (session.status === 'REQUESTED' || session.status === 'ACTIVE')

  return (
    <div className="max-w-xl space-y-6">
      <section className="dp-card space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          Fernwartung — Bildschirmspiegelung
        </h2>
        <p className="text-sm text-gray-700">
          Bei Problemen kann der Support Ihre Bildschirmansicht sehen — direkt im System,
          ohne Installation. Ihre Eingaben werden dabei maskiert, ein deutlicher Banner
          zeigt die laufende Sitzung, und Sie können jederzeit beenden.
        </p>
        {!loaded ? (
          <p className="text-sm text-gray-400">Lade …</p>
        ) : open ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[var(--accent)]">
              Sitzung {STATUS_TEXT[session!.status]}
            </p>
            <button className="btn-danger" onClick={end} disabled={busy}>
              Sitzung beenden
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {session && (
              <p className="text-xs text-gray-400">Letzte Sitzung: {STATUS_TEXT[session.status]}</p>
            )}
            <button className="btn-primary" onClick={request} disabled={busy}>
              {busy ? 'Sende …' : 'Bildschirm-Support anfordern'}
            </button>
          </div>
        )}
      </section>
      <section className="dp-card">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">Kontakt</h2>
        <p className="text-sm text-gray-700">
          Delta Plus Systemhaus GmbH · 02163/888 45 70 · stefan.zangs@deltaplus.de
        </p>
      </section>
    </div>
  )
}
