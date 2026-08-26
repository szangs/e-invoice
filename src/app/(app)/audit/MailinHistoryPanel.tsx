'use client'

// Verlauf eingehender E-Mails (Stefan 2026-08-25) — hierher verschoben von der
// bisherigen eigenständigen /mailin-Seite: gehört inhaltlich zum
// Audit-Protokoll (wer/was kam wann rein), nicht in einen eigenen Menüpunkt.
// Die Einlieferungs-Adresse selbst steht jetzt in den Mandanten-Einstellungen.
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Entry = {
  id: string
  createdAt: string
  fromAddress: string
  subject: string | null
  status: string
  detail: string | null
  invoiceId: string | null
}

const STATUS_LABEL: Record<string, { text: string; bad: boolean }> = {
  PROCESSED: { text: 'Beleg angelegt', bad: false },
  NO_ATTACHMENT: { text: 'kein verwertbarer Anhang', bad: true },
  TENANT_LOCKED: { text: 'abgewiesen', bad: true },
  UNKNOWN_RECIPIENT: { text: 'abgewiesen', bad: true },
  SENDER_REJECTED: { text: 'Absender nicht erlaubt', bad: true },
  ERROR: { text: 'Fehler', bad: true },
}

export function MailinHistoryPanel() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const res = await fetch('/api/mailin', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (stop) return
        setEntries(data.entries)
        setLoaded(true)
      } catch {
        /* nächster Versuch */
      }
    }
    poll()
    const t = setInterval(poll, 8000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  return (
    <div className="dp-card overflow-x-auto p-0">
      <h2 className="px-6 pb-2 pt-5 text-sm font-bold uppercase tracking-wide text-gray-500"
        title="Letzte 100 E-Mails, die an Ihre Einlieferungs-Adresse gingen (siehe Mandanten-Einstellungen)">
        E-Mail-Eingang · Verlauf
      </h2>
      {/* Höhe begrenzt + scrollbar (Stefan 2026-08-25) — bis zu 100 Einträge
          würden die Seite sonst sehr lang machen; Kopfzeile bleibt beim
          Scrollen innerhalb der Tabelle sichtbar. */}
      <div className="max-h-96 overflow-y-auto">
      <table className="w-full min-w-[680px]">
        <thead className="sticky top-0 bg-[var(--surface)]">
          <tr className="dp-tr">
            <th className="dp-th">Zeit</th>
            <th className="dp-th">Von</th>
            <th className="dp-th">Betreff</th>
            <th className="dp-th">Ergebnis</th>
            <th className="dp-th">Beleg</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const st = STATUS_LABEL[e.status] ?? { text: e.status, bad: true }
            return (
              <tr key={e.id} className="dp-tr">
                <td className="dp-td whitespace-nowrap font-mono text-[10px]">
                  {new Date(e.createdAt).toLocaleString('de-DE')}
                </td>
                <td className="dp-td text-xs">{e.fromAddress}</td>
                <td className="dp-td max-w-[240px] truncate text-xs" title={e.subject ?? ''}>
                  {e.subject ?? '—'}
                </td>
                <td className="dp-td">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    st.bad ? 'bg-red-50 text-[var(--danger)]' : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  }`} title={e.detail ?? ''}>{st.text}</span>
                </td>
                <td className="dp-td text-xs">
                  {e.invoiceId ? (
                    <Link className="text-[var(--accent)] underline" href={`/invoices/${e.invoiceId}`}>
                      öffnen
                    </Link>
                  ) : '—'}
                </td>
              </tr>
            )
          })}
          {loaded && entries.length === 0 && (
            <tr><td className="dp-td py-8 text-center text-sm text-gray-400" colSpan={5}>
              Noch keine E-Mails eingegangen.
            </td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
