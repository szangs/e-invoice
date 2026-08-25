'use client'

// Zusätzliche Dokumente zu einer Rechnung (Stefan 2026-07-08): unabhängig vom
// GoBD-gesperrten Hauptbeleg jederzeit anhängbar (Lieferschein, Vertrag,
// Mail-Verlauf …) — siehe /api/invoices/[id]/attachments. Stefan 2026-08-25:
// werden jetzt visuell dargestellt (PDF/Bild inline) statt nur als
// Download-Link, damit auf einen Blick klar ist, was jeweils drinsteht —
// jeder Anhang mit eigener Beschriftung (Dateiname, wer/wann hochgeladen),
// damit Herkunft und Bedeutung eindeutig bleiben. Steht auf der Detailseite
// UNTER der Beleg-Visualisierung (siehe page.tsx) — bewusst "nachrangig"
// zum eigentlichen Beleg.
import { useEffect, useState } from 'react'

type Attachment = {
  id: string
  originalName: string
  mimeType: string
  size: number
  createdAt: string
  uploadedByName: string | null
}

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentsPanel({
  invoiceId,
  encryptionEnabled,
  locked,
}: {
  invoiceId: string
  encryptionEnabled: boolean
  /** Beleg-Eingang fällt in ein abgeschlossenes Audit-Jahr (§18) — auch Anhänge sind dann schreibgeschützt. */
  locked?: boolean
}) {
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
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-gray-500"
        title="Weitere Dateien zu diesem Beleg — unabhängig vom Hauptbeleg, jederzeit ergänzbar (auch bei gesperrten E-Rechnungen). Kein Original-Rechnungsbeleg, sondern Zusatzmaterial.">
        📎 Weitere Anhänge (Lieferschein, Vertrag, Mail-Verlauf …)
      </h3>
      {encryptionEnabled ? (
        <p className="dp-card text-[11px] text-gray-400">
          Bei aktiver Beleg-Verschlüsselung sind Anhänge noch nicht verfügbar (Zero-Knowledge).
        </p>
      ) : (
        <>
          {items === null && <p className="dp-card text-xs text-gray-400">Lade …</p>}
          {items && items.length === 0 && (
            <p className="dp-card text-xs text-gray-400">Noch keine weiteren Anhänge.</p>
          )}
          {items?.map((a) => {
            const url = `/api/invoices/${invoiceId}/attachments/${a.id}`
            const isImage = IMAGE_MIMES.includes(a.mimeType)
            const isPdf = a.mimeType === 'application/pdf'
            return (
              <div key={a.id} className="dp-card overflow-hidden !p-0">
                <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700" title={a.originalName}>
                    {a.originalName}
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-400"
                    title={`${fmtSize(a.size)} · hochgeladen ${new Date(a.createdAt).toLocaleString('de-DE')}${a.uploadedByName ? ` von ${a.uploadedByName}` : ''}`}>
                    {fmtSize(a.size)}
                  </span>
                  <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-[10px] text-[var(--accent)] underline"
                    title="In neuem Tab öffnen">
                    öffnen
                  </a>
                  {!locked && (
                    <button type="button" className="shrink-0 text-[10px] text-[var(--danger)] hover:underline" disabled={busy}
                      onClick={() => remove(a.id)} title="Anhang löschen">
                      Löschen
                    </button>
                  )}
                </div>
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={a.originalName} className="max-h-[50vh] w-full object-contain" />
                ) : isPdf ? (
                  <iframe src={url} title={a.originalName} className="h-[50vh] w-full" />
                ) : (
                  <p className="px-3 py-4 text-center text-[11px] text-gray-400">
                    Keine Inline-Vorschau für diesen Dateityp — über „öffnen" ansehen.
                  </p>
                )}
              </div>
            )
          })}
          {locked ? (
            <p className="dp-card text-[11px] text-gray-400" title="Beleg gehört zu einem abgeschlossenen Prüfungszeitraum">
              🔒 Schreibgeschützt — keine weiteren Anhänge möglich.
            </p>
          ) : (
            <div className="dp-card flex items-center gap-2 !py-2.5">
              <input type="file" className="dp-input !w-auto text-xs" disabled={busy}
                accept="application/pdf,application/xml,text/xml,.xml,image/png,image/jpeg,image/webp"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
                title="Weiteres Dokument anhängen (PDF, XML, PNG, JPG, WebP — max. 10 MB)" />
              {busy && <span className="text-xs text-gray-400">Lade hoch …</span>}
            </div>
          )}
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        </>
      )}
    </div>
  )
}
