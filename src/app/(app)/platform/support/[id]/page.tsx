'use client'

// Fernwartungs-Viewer (§14A): zeigt den maskierten Bildschirmspiegel des Nutzers,
// aktualisiert sich laufend ohne Neuladen (§13-Prinzip).
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function SupportViewerPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null)
  const [status, setStatus] = useState('ACTIVE')

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const res = await fetch(`/api/support/${id}/snapshot`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (stop) return
        setStatus(data.status)
        setSnapshot(data.snapshot ?? null)
        setSnapshotAt(data.snapshotAt ?? null)
      } catch {
        /* weiter versuchen */
      }
    }
    poll()
    const t = setInterval(poll, 3000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [id])

  async function end() {
    await fetch(`/api/support/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end' }),
    })
    router.push('/platform')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm">
          {status === 'ACTIVE' ? (
            <span className="font-semibold text-[var(--danger)]">● Live-Spiegel</span>
          ) : (
            <span className="text-gray-500">Sitzung {status === 'ENDED' ? 'beendet' : status}</span>
          )}
          {snapshotAt && (
            <span className="ml-2 text-xs text-gray-400">
              Stand: {new Date(snapshotAt).toLocaleTimeString('de-DE')}
            </span>
          )}
        </p>
        <button className="btn-danger" onClick={end}>Sitzung beenden</button>
      </div>
      <div className="dp-card overflow-hidden p-0" style={{ height: '75vh' }}>
        {snapshot ? (
          // sandbox ohne allow-scripts: der Spiegel ist rein passiv
          <iframe title="Bildschirmspiegel" sandbox="" srcDoc={snapshot}
            className="h-full w-full border-0" />
        ) : (
          <p className="p-8 text-center text-sm text-gray-400">
            Warte auf den ersten Bildschirmspiegel … (der Nutzer muss angemeldet sein)
          </p>
        )}
      </div>
      <p className="text-[11px] text-gray-400">
        Eingaben des Nutzers sind maskiert (§14A). Die Sitzung endet automatisch nach dem
        globalen Zeitabschluss (§9) und kann beidseitig jederzeit beendet werden.
      </p>
    </div>
  )
}
