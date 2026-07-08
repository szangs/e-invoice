'use client'

// Zusätzliche Dokumente zu einer Rechnung (Stefan 2026-07-08): unabhängig vom
// GoBD-gesperrten Hauptbeleg jederzeit anhängbar (Lieferschein, Vertrag,
// Mail-Verlauf …) — siehe /api/invoices/[id]/attachments.
import { useEffect, useState } from 'react'

type Attachment = {
  id: string
  originalName: string
  mimeType: string
  size: number
  createdAt: string
  uploadedByName: string | null
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentsPanel({ invoiceId, encryptionEnabled }: { invoiceId: string; encryptionEnabled: boolean }) {
  const [items, setItems] = useState<Attachment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function load() {
    fetch(`/api/invoices/${invoiceId}/attachments`)
      .then((r) => r.json())
      .then((d) => setItems(d.attachments ?? []))
      .catch(() => setError('Anhänge konnten nicht geladen werden.'))
  }

  useEffect(load, [invoiceId])

  async function upload(file: File) {
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/invoices/${invoiceId}/attachments`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Anhang konnte nicht hochgeladen werden.')
        return
      }
      load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Diesen Anhang endgültig löschen?')) return
    setBusy(true)
    try {
      await fetch(`/api/invoices/${invoiceId}/attachments/${id}`, { method: 'DELETE' })
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-[var(--line)] pt-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500"
        title="Weitere Dateien zu diesem Beleg — unabhängig vom Hauptbeleg, jederzeit ergänzbar (auch bei gesperrten E-Rechnungen)">
        📎 Anhänge
      </h3>
      {encryptionEnabled ? (
        <p className="text-[11px] text-gray-400">
          Bei aktiver Beleg-Verschlüsselung sind Anhänge noch nicht verfügbar (Zero-Knowledge).
        </p>
      ) : (
        <>
          {items === null && <p className="text-xs text-gray-400">Lade …</p>}
          {items && items.length === 0 && <p className="text-xs text-gray-400">Noch keine Anhänge.</p>}
          {items && items.length > 0 && (
            <ul className="space-y-1">
              {items.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-xs">
                  <a href={`/api/invoices/${invoiceId}/attachments/${a.id}`} target="_blank" rel="noreferrer"
                    className="text-[var(--accent)] underline" title={`${fmtSize(a.size)} · hochgeladen ${new Date(a.createdAt).toLocaleString('de-DE')}${a.uploadedByName ? ` von ${a.uploadedByName}` : ''}`}>
                    {a.originalName}
                  </a>
                  <span className="text-gray-400">({fmtSize(a.size)})</span>
                  <button type="button" className="ml-auto text-[var(--danger)] hover:underline" disabled={busy}
                    onClick={() => remove(a.id)} title="Anhang löschen">
                    Löschen
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2">
            <input type="file" className="dp-input !w-auto text-xs" disabled={busy}
              accept="application/pdf,application/xml,text/xml,.xml,image/png,image/jpeg,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
              title="Weiteres Dokument anhängen (PDF, XML, PNG, JPG, WebP — max. 10 MB)" />
          </div>
          {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
        </>
      )}
    </div>
  )
}
