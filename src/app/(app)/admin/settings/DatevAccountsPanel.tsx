'use client'

// Optionale Lieferanten→Konto-Zuordnung für den DATEV-Export (Stefan
// 2026-07-08): per CSV-Import statt manueller Pflege je Lieferant — z. B.
// Export der Kreditoren-Stammdaten aus DATEV/der Fibu. Ohne Import bleibt
// alles beim Sammelkonto (siehe Abschnitt oben).
import { useEffect, useState } from 'react'

type Account = { id: string; vendorName: string; konto: string }

export function DatevAccountsPanel() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  function load() {
    fetch('/api/admin/datev-accounts')
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []))
      .catch(() => setMsg('Zuordnungen konnten nicht geladen werden.'))
  }

  useEffect(load, [])

  async function upload(file: File) {
    setBusy(true)
    setMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/datev-accounts', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data.error ?? 'Import fehlgeschlagen.')
        return
      }
      setMsg(`${data.imported} importiert${data.skipped ? `, ${data.skipped} übersprungen` : ''}.`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Diese Konto-Zuordnung löschen?')) return
    setBusy(true)
    try {
      await fetch(`/api/admin/datev-accounts/${id}`, { method: 'DELETE' })
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dp-card space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Lieferanten-Konten (optional)</h2>
      <p className="text-[11px] text-gray-400">
        Statt des Sammelkontos oben lässt sich für einzelne Lieferanten eine eigene DATEV-Kontonummer
        hinterlegen — z. B. per Export aus DATEV/Ihrer Fibu importiert. Format: CSV mit Kopfzeile,
        danach je Zeile <span className="font-mono">Lieferantenname;Konto</span>. Lieferanten ohne
        Eintrag hier nutzen weiterhin das Sammelkonto.
      </p>
      <input type="file" accept=".csv,text/csv" className="dp-input !w-auto text-xs" disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
        title="CSV-Datei mit Lieferant;Konto importieren (überschreibt gleichnamige Einträge)" />
      {msg && <p className="text-xs text-gray-600">{msg}</p>}
      {accounts === null && <p className="text-xs text-gray-400">Lade …</p>}
      {accounts && accounts.length === 0 && <p className="text-xs text-gray-400">Noch keine Zuordnungen importiert.</p>}
      {accounts && accounts.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1">Lieferant</th>
              <th className="py-1">Konto</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-[var(--line)]">
                <td className="py-1">{a.vendorName}</td>
                <td className="py-1 font-mono">{a.konto}</td>
                <td className="py-1 text-right">
                  <button type="button" className="text-[var(--danger)] hover:underline" disabled={busy}
                    onClick={() => remove(a.id)} title="Zuordnung löschen">
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
