'use client'

// Perioden-Abschluss des Audit-Protokolls (Stefan 2026-08-25, §18): sealt ein
// vollständig abgelaufenes Kalenderjahr — siehe api/platform/audit/period-close.
// Einmal abgeschlossen, unveränderlich (kein erneutes Abschließen); Belege aus
// abgeschlossenen Jahren gelten ab sofort als gesperrt (lib/auditClosure.ts).
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type PeriodRow = {
  year: number
  closed: boolean
  closable: boolean
  entryCount: number
  closedAt: string | null
  closedByName: string | null
}

export function PeriodClosurePanel({ years }: { years: PeriodRow[] }) {
  const router = useRouter()
  const [nameFor, setNameFor] = useState<Record<number, string>>({})
  const [busyYear, setBusyYear] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  async function close(year: number) {
    const closedByName = (nameFor[year] ?? '').trim()
    if (!closedByName) {
      setMsg('Bitte einen Namen als Unterschrift eingeben.')
      return
    }
    if (
      !window.confirm(
        `Audit-Protokoll für ${year} endgültig abschließen? Das lässt sich NICHT rückgängig machen — Belege aus ${year} gelten danach als gesperrt.`,
      )
    ) {
      return
    }
    setBusyYear(year)
    setMsg('')
    const res = await fetch('/api/platform/audit/period-close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, closedByName }),
    })
    const data = await res.json().catch(() => ({}))
    setBusyYear(null)
    if (!res.ok) {
      setMsg(data.error ?? 'Abschluss fehlgeschlagen.')
      return
    }
    router.refresh()
  }

  return (
    <div className="dp-card">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-500"
        title="Versiegelt ein vollständig abgelaufenes Kalenderjahr anhand der Hash-Kette — mit druckbarem Zertifikat und ZIP-Archiv (Zertifikat + CSV-Export). Belege aus abgeschlossenen Jahren werden gesperrt.">
        📜 Perioden-Abschluss
      </h2>
      <p className="mb-3 text-xs text-gray-400">
        Versiegelt ein Kalenderjahr des Audit-Protokolls unveränderlich — mit Zertifikat (Unterschrift/Datum)
        und ZIP-Archiv. Belege aus abgeschlossenen Jahren werden danach schreibgeschützt (🔒).
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="dp-tr">
            <th className="dp-th">Jahr</th>
            <th className="dp-th">Status</th>
            <th className="dp-th">Aktion</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year} className="dp-tr">
              <td className="dp-td font-semibold">{y.year}</td>
              <td className="dp-td text-xs">
                {y.closed ? (
                  <span title={`Abgeschlossen am ${y.closedAt ? new Date(y.closedAt).toLocaleString('de-DE') : '?'} von ${y.closedByName}`}>
                    🔒 abgeschlossen am {y.closedAt ? new Date(y.closedAt).toLocaleDateString('de-DE') : '?'} · {y.closedByName}
                  </span>
                ) : y.closable ? (
                  <span className="text-[var(--warn-strong)]">offen · {y.entryCount} Einträge</span>
                ) : (
                  <span className="text-gray-400">läuft noch — noch nicht abschließbar</span>
                )}
              </td>
              <td className="dp-td">
                {y.closed ? (
                  <div className="flex gap-2">
                    <a className="btn-secondary !px-2 !py-1 text-xs" href={`/api/platform/audit/period-close/${y.year}/certificate`} target="_blank" rel="noreferrer">
                      Zertifikat
                    </a>
                    <a className="btn-secondary !px-2 !py-1 text-xs" href={`/api/platform/audit/period-close/${y.year}/zip`}>
                      ZIP-Archiv
                    </a>
                  </div>
                ) : y.closable ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="dp-input !w-40 !py-1 text-xs"
                      placeholder="Name (Unterschrift)"
                      value={nameFor[y.year] ?? ''}
                      disabled={busyYear === y.year}
                      onChange={(e) => setNameFor((p) => ({ ...p, [y.year]: e.target.value }))}
                    />
                    <button type="button" className="btn-primary !px-2 !py-1 text-xs" disabled={busyYear === y.year}
                      onClick={() => close(y.year)} title="Jahr endgültig abschließen — nicht rückgängig machbar">
                      {busyYear === y.year ? 'Schließe ab …' : 'Abschließen'}
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] text-gray-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className="mt-2 text-xs text-[var(--danger)]">{msg}</p>}
    </div>
  )
}
