'use client'

// Dateimanager fürs Sicherungsziel-Verzeichnis (Stefan 2026-08-27, "unter
// dem Systemadmin einen Dateimanager einbauen") — bisher ließen sich die
// dort abgelegten Sicherungsdateien nur per SSH einsehen/löschen. Bewusst
// beschränkt auf BACKUP_TARGET_DIR (siehe api/platform/backup-files) statt
// eines allgemeinen Datei-Browsers über beliebige Server-Pfade.
import { useEffect, useState } from 'react'

type FileEntry = { name: string; sizeBytes: number; mtime: string }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function BackupFilesPanel() {
  const [dir, setDir] = useState<string | null>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loadError, setLoadError] = useState('')
  const [busyName, setBusyName] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  async function load() {
    setLoadError('')
    const res = await fetch('/api/platform/backup-files', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setLoadError(data.error ?? 'Liste konnte nicht geladen werden.')
      return
    }
    setDir(data.dir)
    setFiles(data.files ?? [])
    if (data.error) setLoadError(data.error)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function remove(name: string) {
    if (!window.confirm(`"${name}" endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return
    setBusyName(name)
    setMsg('')
    const res = await fetch(`/api/platform/backup-files/${encodeURIComponent(name)}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setBusyName(null)
    if (!res.ok) {
      setMsg(data.error ?? 'Löschen fehlgeschlagen.')
      return
    }
    await load()
  }

  return (
    <div className="space-y-2 border-t border-[var(--line)] pt-4">
      <div className="flex items-center justify-between">
        <p className="dp-label">Dateimanager — Sicherungsziel</p>
        <button type="button" className="text-xs text-[var(--accent)] underline" onClick={load}>Aktualisieren</button>
      </div>
      {!dir ? (
        <p className="text-xs text-gray-400">Kein Sicherungsziel-Verzeichnis eingetragen (oben unter „Sicherungsziel").</p>
      ) : (
        <>
          <p className="font-mono text-[11px] text-gray-500">{dir}</p>
          {loadError && <p className="text-xs text-[var(--danger)]">{loadError}</p>}
          {msg && <p className="text-xs text-[var(--danger)]">{msg}</p>}
          <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="dp-tr">
                  <th className="dp-th">Datei</th>
                  <th className="dp-th">Größe</th>
                  <th className="dp-th">Geändert</th>
                  <th className="dp-th">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.name} className="dp-tr">
                    <td className="dp-td font-mono text-xs">{f.name}</td>
                    <td className="dp-td text-xs">{formatSize(f.sizeBytes)}</td>
                    <td className="dp-td text-xs">{new Date(f.mtime).toLocaleString('de-DE')}</td>
                    <td className="dp-td">
                      <div className="flex gap-2">
                        <a className="btn-secondary !px-2 !py-1 text-xs" href={`/api/platform/backup-files/${encodeURIComponent(f.name)}`}>
                          Herunterladen
                        </a>
                        <button type="button" className="btn-danger !px-2 !py-1 text-xs" disabled={busyName === f.name}
                          onClick={() => remove(f.name)}>
                          {busyName === f.name ? 'Lösche …' : 'Löschen'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {files.length === 0 && !loadError && (
                  <tr><td className="dp-td py-4 text-center text-gray-400" colSpan={4}>Keine Dateien im Verzeichnis.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
