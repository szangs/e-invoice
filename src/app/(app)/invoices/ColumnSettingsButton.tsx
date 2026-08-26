'use client'

import { useState } from 'react'
import { OPTIONAL_COLUMNS, useColumnVisibility } from './columnVisibility'

export function ColumnSettingsButton() {
  const { visible, setVisible } = useColumnVisibility()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button type="button" className="btn-secondary" onClick={() => setOpen((o) => !o)}
        title="Spalten dieser Tabelle ein- oder ausblenden — pro Browser gemerkt">
        ⚙ Spalten
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-[var(--line)] bg-white p-2 shadow-lg">
            <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Spalten anzeigen</p>
            {OPTIONAL_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--surface-muted)]">
                <input type="checkbox" checked={visible[c.key]} onChange={(e) => setVisible(c.key, e.target.checked)} />
                {c.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
