'use client'

// Lieferanten-Adressregister (Stefan 2026-08-26): die Anschrift füllt sich
// automatisch — bei jeder Rechnung mit lesbarer Anschrift wird der aktuellste
// Stand je Lieferant gespeichert (siehe lib/vendorMemory.ts upsertVendorAddress).
// Bankverbindung (Stefan 2026-08-27, SEPA-Sammelüberweisung): IBAN/BIC werden
// aus einer E-Rechnung ebenfalls vorbefüllt, gelten aber erst nach manueller
// Bestätigung hier als für den SEPA-Export nutzbar (siehe lib/sepa.ts) — ein
// Mensch muss jede Kontoverbindung einmal ansehen/speichern, bevor damit
// tatsächlich Geld überwiesen werden kann.
import { useEffect, useState } from 'react'

type VendorAddress = {
  id: string
  vendorName: string
  address: string | null
  iban: string | null
  bic: string | null
  ibanVerifiedAt: string | null
  ibanVerifiedBy: string | null
  updatedAt: string
}

const EMPTY_NEW = { vendorName: '', iban: '', bic: '' }

export function VendorAddressesPanel() {
  const [rows, setRows] = useState<VendorAddress[] | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editIban, setEditIban] = useState('')
  const [editBic, setEditBic] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newVendor, setNewVendor] = useState(EMPTY_NEW)

  async function load() {
    const res = await fetch('/api/admin/vendor-addresses')
    const data = await res.json().catch(() => ({}))
    setRows(data.addresses ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  function startEdit(r: VendorAddress) {
    setEditId(r.id)
    setEditIban(r.iban ?? '')
    setEditBic(r.bic ?? '')
    setMsg('')
  }

  async function saveEdit(id: string) {
    setBusy(true)
    setMsg('')
    const res = await fetch(`/api/admin/vendor-addresses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: editIban, bic: editBic }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Speichern fehlgeschlagen.')
      return
    }
    setEditId(null)
    await load()
  }

  async function removeVendor(id: string, name: string) {
    if (!window.confirm(`Lieferanten-Eintrag "${name}" endgültig löschen?`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/vendor-addresses/${id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Löschen fehlgeschlagen.')
      return
    }
    await load()
  }

  async function createVendor(e: React.FormEvent) {
    e.preventDefault()
    if (!newVendor.vendorName.trim()) return
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/admin/vendor-addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newVendor),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Anlegen fehlgeschlagen.')
      return
    }
    setNewVendor(EMPTY_NEW)
    setShowCreate(false)
    await load()
  }

  return (
    <section className="dp-card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Lieferanten-Register (Anschrift &amp; Bankverbindung)</h2>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Abbrechen' : '+ Lieferant anlegen'}
          </button>
          <a className="btn-secondary !px-2.5 !py-1 text-xs" href="/api/invoices/export/vendor-addresses"
            title="Lieferant + zuletzt übermittelte Anschrift als CSV herunterladen — z. B. für einen eigenständigen Import in die Fibu">
            CSV-Export
          </a>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        Anschrift wird automatisch aus eingehenden Rechnungen gepflegt. IBAN/BIC werden aus einer
        E-Rechnung vorbefüllt, gelten aber erst als „bestätigt" (nutzbar für die{' '}
        <a href="/invoices" className="underline">SEPA-Sammelüberweisung</a>), sobald hier einmal
        gespeichert wurde — damit eine fehlerhafte oder gefälschte Rechnung nicht unbemerkt eine
        Kontoverbindung ändern kann.
      </p>
      {showCreate && (
        <form onSubmit={createVendor} className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
          <div>
            <label className="dp-label">Lieferant</label>
            <input className="dp-input mt-1 !w-48" value={newVendor.vendorName}
              onChange={(e) => setNewVendor((p) => ({ ...p, vendorName: e.target.value }))} required />
          </div>
          <div>
            <label className="dp-label">IBAN</label>
            <input className="dp-input mt-1 !w-56 font-mono" value={newVendor.iban}
              onChange={(e) => setNewVendor((p) => ({ ...p, iban: e.target.value }))} />
          </div>
          <div>
            <label className="dp-label">BIC</label>
            <input className="dp-input mt-1 !w-32 font-mono" value={newVendor.bic}
              onChange={(e) => setNewVendor((p) => ({ ...p, bic: e.target.value }))} />
          </div>
          <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy}>Anlegen</button>
        </form>
      )}
      {msg && <p className="text-xs text-[var(--danger)]">{msg}</p>}
      {rows === null && <p className="text-xs text-gray-400">Lade …</p>}
      {rows && rows.length === 0 && <p className="text-xs text-gray-400">Noch keine Lieferanten erfasst.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1">Lieferant</th>
                <th className="py-1">Anschrift</th>
                <th className="py-1">IBAN</th>
                <th className="py-1">BIC</th>
                <th className="py-1">Status</th>
                <th className="py-1">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--line)] align-top">
                  <td className="py-1.5 pr-2">{r.vendorName}</td>
                  <td className="py-1.5 pr-2 text-gray-600">{r.address ?? '—'}</td>
                  {editId === r.id ? (
                    <>
                      <td className="py-1.5 pr-2">
                        <input className="dp-input !w-48 !py-1 font-mono text-xs" value={editIban}
                          onChange={(e) => setEditIban(e.target.value)} placeholder="DE…" />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input className="dp-input !w-28 !py-1 font-mono text-xs" value={editBic}
                          onChange={(e) => setEditBic(e.target.value)} />
                      </td>
                      <td className="py-1.5 pr-2 text-gray-400">wird bei Speichern bestätigt</td>
                      <td className="py-1.5">
                        <div className="flex gap-1.5">
                          <button type="button" className="btn-primary !px-2 !py-0.5 text-[11px]" disabled={busy} onClick={() => saveEdit(r.id)}>
                            Speichern
                          </button>
                          <button type="button" className="btn-secondary !px-2 !py-0.5 text-[11px]" onClick={() => setEditId(null)}>
                            Abbrechen
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5 pr-2 font-mono text-gray-600">{r.iban ?? '—'}</td>
                      <td className="py-1.5 pr-2 font-mono text-gray-600">{r.bic ?? '—'}</td>
                      <td className="py-1.5 pr-2">
                        {!r.iban ? (
                          <span className="text-gray-400">—</span>
                        ) : r.ibanVerifiedAt ? (
                          <span className="text-[var(--accent)]" title={`Bestätigt von ${r.ibanVerifiedBy} am ${new Date(r.ibanVerifiedAt).toLocaleString('de-DE')}`}>
                            ✓ bestätigt
                          </span>
                        ) : (
                          <span className="text-[var(--warn-strong)]" title="Aus einer E-Rechnung übernommen, noch nicht bestätigt — für SEPA-Export bitte hier einmal prüfen und speichern">
                            ⚠ ungeprüft
                          </span>
                        )}
                      </td>
                      <td className="py-1.5">
                        <div className="flex gap-1.5">
                          <button type="button" className="btn-secondary !px-2 !py-0.5 text-[11px]" onClick={() => startEdit(r)}>
                            {r.iban ? 'Bearbeiten' : 'IBAN eintragen'}
                          </button>
                          <button type="button" className="btn-danger !px-2 !py-0.5 text-[11px]" disabled={busy}
                            onClick={() => removeVendor(r.id, r.vendorName)}>
                            Löschen
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
