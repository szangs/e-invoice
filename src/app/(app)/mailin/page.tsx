'use client'

// Mandanten-Seite (RE03): eigene Einlieferungs-Adresse + Verlauf eingehender E-Mails
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

export default function MailinPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [address, setAddress] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(true)
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
        setAddress(data.address)
        setEnabled(data.enabled)
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
    <div className="space-y-6">
      <section className="dp-card">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
          Ihre Einlieferungs-Adresse
        </h2>
        {address ? (
          <>
            <p className="font-mono text-lg text-[var(--accent)]">{address}</p>
            <p className="mt-2 text-xs text-gray-500">
              Richten Sie in Ihrem E-Mail-Programm eine Weiterleitung eingehender Rechnungen an
              diese Adresse ein — alles Weitere passiert automatisch. Rechnungen als PDF- oder
              Bild-Anhang werden als Beleg angelegt.
            </p>
            <p className="mt-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]"
              title="Empfehlung: Weiterleitung statt direkter Weitergabe">
              Bitte geben Sie diese Adresse nicht direkt an Lieferanten oder sonstige Dritte weiter
              — richten Sie stattdessen eine einfache Weiterleitung in Ihrem E-Mail-Programm bzw.
              bei Ihrem E-Mail-Provider dorthin ein. So behalten Sie die alleinige Kontrolle über
              Ihr Rechnungspostfach. Geben Sie die Adresse dennoch direkt weiter (was technisch
              funktioniert), übernehmen wir keine Gewähr für deren dauerhafte Verfügbarkeit.
            </p>
            {!enabled && (
              <p className="mt-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
                Der automatische Abruf ist derzeit deaktiviert — eingehende Mails werden gesammelt
                und nach Aktivierung verarbeitet.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400">
            {loaded ? 'Die Einlieferungs-Adresse ist noch nicht eingerichtet — bitte Support kontaktieren (SU01).' : 'Lade …'}
          </p>
        )}
      </section>

      <section className="dp-card p-0">
        <h2 className="px-6 pb-2 pt-5 text-sm font-bold uppercase tracking-wide text-gray-500">
          Verlauf eingehender E-Mails
        </h2>
        <table className="w-full min-w-[680px]">
          <thead>
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
            {entries.length === 0 && (
              <tr><td className="dp-td py-8 text-center text-sm text-gray-400" colSpan={5}>
                Noch keine E-Mails eingegangen.
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
