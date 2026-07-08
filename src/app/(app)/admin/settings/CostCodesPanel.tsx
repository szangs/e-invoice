'use client'

// Kostenstellen/Kostenträger (Stefan 2026-07-09, #114): per CSV-Import
// gepflegte Liste, genau wie die Lieferanten-Konten (DatevAccountsPanel) —
// eine Instanz je "kind" (Kostenstelle/Kostenträger), beide nur sichtbar,
// wenn Tenant.costCentersEnabled aktiv ist (siehe SettingsHub.tsx).
import { useEffect, useState } from 'react'

type CostCode = { id: string; code: string; name: string }

export function CostCodesPanel({
  kind,
  label,
}: {
  kind: 'KOSTENSTELLE' | 'KOSTENTRAEGER'
  label: string
}) {
  const [codes, setCodes] = useState<CostCode[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  function load() {
    fetch(`/api/admin/cost-codes?kind=${kind}`)
      .then((r) => r.json())
      .then((d) => setCodes(d.codes ?? []))
      .catch(() => setMsg('Liste konnte nicht geladen werden.'))
  }

  useEffect(load, [kind])

  async function upload(file: File) {
    setBusy(true)
    setMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      const res = await fetch('/api/admin/cost-codes', { method: 'POST', body: fd })
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
    if (!window.confirm(`Diesen Eintrag löschen?`)) return
    setBusy(true)
    try {
      await fetch(`/api/admin/cost-codes/${id}`, { method: 'DELETE' })
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dp-card space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">{label}</h2>
      <p className="text-[11px] text-gray-400">
        Liste per CSV-Import befüllen (z. B. Export aus Ihrer Fibu). Format: CSV mit Kopfzeile,
        danach je Zeile <span className="font-mono">Code;Bezeichnung</span>. Auf der
        Rechnungsdetailseite dann je Beleg auswählbar.
      </p>
      <input type="file" accept=".csv,text/csv" className="dp-input !w-auto text-xs" disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
        title={`CSV-Datei mit Code;Bezeichnung importieren (überschreibt gleiche Codes)`} />
      {msg && <p className="text-xs text-gray-600">{msg}</p>}
      {codes === null && <p className="text-xs text-gray-400">Lade …</p>}
      {codes && codes.length === 0 && <p className="text-xs text-gray-400">Noch keine Einträge importiert.</p>}
      {codes && codes.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1">Code</th>
              <th className="py-1">Bezeichnung</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id} className="border-t border-[var(--line)]">
                <td className="py-1 font-mono">{c.code}</td>
                <td className="py-1">{c.name}</td>
                <td className="py-1 text-right">
                  <button type="button" className="text-[var(--danger)] hover:underline" disabled={busy}
                    onClick={() => remove(c.id)} title="Eintrag löschen">
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
