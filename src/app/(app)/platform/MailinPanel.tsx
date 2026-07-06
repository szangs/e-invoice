'use client'

// Cockpit-Panel: Schalter "E-Mail-Eingang aller Mandanten anzeigen" —
// zeigt Eingänge UND Fehlversuche in Echtzeit (Kurzintervall-Abruf, §13-Prinzip).
import { useEffect, useState } from 'react'

type Entry = {
  id: string
  createdAt: string
  tenantName: string | null
  fromAddress: string
  toAddress: string
  subject: string | null
  status: string
  detail: string | null
}

const STATUS_LABEL: Record<string, { text: string; bad: boolean }> = {
  PROCESSED: { text: 'Beleg angelegt', bad: false },
  NO_ATTACHMENT: { text: 'kein Anhang', bad: true },
  UNKNOWN_RECIPIENT: { text: 'unbekannte Adresse', bad: true },
  TENANT_LOCKED: { text: 'Mandant gesperrt', bad: true },
  ERROR: { text: 'Fehler', bad: true },
}

const SHOW_KEY = 'einvoice.mailin.show'

export function MailinPanel() {
  const [show, setShow] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [enabled, setEnabled] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setShow(localStorage.getItem(SHOW_KEY) === '1')
  }, [])

  useEffect(() => {
    if (!show) return
    let stop = false
    async function poll() {
      try {
        const res = await fetch('/api/platform/mailin', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (stop) return
        setEntries(data.entries)
        setEnabled(data.enabled)
        setConfigured(data.configured)
      } catch {
        /* nächster Versuch */
      }
    }
    poll()
    const t = setInterval(poll, 5000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [show])

  function toggle() {
    const next = !show
    setShow(next)
    localStorage.setItem(SHOW_KEY, next ? '1' : '')
  }

  async function pollNow() {
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/platform/mailin', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setMsg(data.message ?? 'Fehler beim Abruf')
    setBusy(false)
  }

  return (
    <section className="dp-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          E-Mail-Eingang (alle Mandanten)
        </h2>
        <div className="flex items-center gap-2">
          {show && (
            <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={pollNow} disabled={busy}>
              {busy ? 'Rufe ab …' : 'Jetzt abrufen'}
            </button>
          )}
          <button className={show ? 'btn-primary !px-3 !py-1.5 text-xs' : 'btn-secondary !px-3 !py-1.5 text-xs'}
            onClick={toggle}>
            {show ? 'Anzeige aus' : 'E-Mail-Eingang anzeigen'}
          </button>
        </div>
      </div>

      {show && (
        <div className="mt-3">
          {!configured && (
            <p className="mb-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
              Mail-Eingang noch nicht konfiguriert — Systemeinstellungen (SP01) → „Mail-Eingang" ausfüllen.
            </p>
          )}
          {configured && !enabled && (
            <p className="mb-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
              Abruf ist deaktiviert (Schalter in SP01 → „Mail-Eingang aktiv").
            </p>
          )}
          {msg && <p className="mb-2 text-xs text-gray-600">{msg}</p>}
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="dp-tr">
                  <th className="dp-th">Zeit</th>
                  <th className="dp-th">Mandant</th>
                  <th className="dp-th">Von</th>
                  <th className="dp-th">An</th>
                  <th className="dp-th">Betreff</th>
                  <th className="dp-th">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const st = STATUS_LABEL[e.status] ?? { text: e.status, bad: true }
                  return (
                    <tr key={e.id} className="dp-tr">
                      <td className="dp-td whitespace-nowrap font-mono text-[10px]">
                        {new Date(e.createdAt).toLocaleTimeString('de-DE')}
                      </td>
                      <td className="dp-td text-xs">{e.tenantName ?? '—'}</td>
                      <td className="dp-td text-xs">{e.fromAddress}</td>
                      <td className="dp-td font-mono text-[10px]">{e.toAddress}</td>
                      <td className="dp-td max-w-[200px] truncate text-xs" title={e.subject ?? ''}>
                        {e.subject ?? '—'}
                      </td>
                      <td className="dp-td">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          st.bad ? 'bg-red-50 text-[var(--danger)]' : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                        }`} title={e.detail ?? ''}>{st.text}</span>
                      </td>
                    </tr>
                  )
                })}
                {entries.length === 0 && (
                  <tr><td className="dp-td py-6 text-center text-xs text-gray-400" colSpan={6}>
                    Noch keine Eingänge protokolliert.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
