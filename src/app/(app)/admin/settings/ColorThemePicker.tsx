'use client'

// Farbauswahl (Stefan 2026-08-27, "mach mal noch eine Farbauswahl (Schema da
// rein)") — Swatches für die in globals.css definierten [data-theme]-Schemata
// (siehe lib/colorThemes.ts). Setzt bei Klick SOFORT das data-theme-Attribut
// auf <html> (live Vorschau, ohne erst zu speichern) — dauerhaft gilt die
// Wahl aber erst nach "Speichern" (wie jede andere Einstellung hier), sonst
// würde ein Neuladen ohne Speichern zum alten Schema zurückspringen und die
// Vorschau wirkt wie ein Bug statt einer Vorschau.
import { COLOR_THEMES, type ColorThemeKey } from '@/lib/colorThemes'

export function ColorThemePicker({ value, onChange }: { value: string; onChange: (theme: ColorThemeKey) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLOR_THEMES.map((t) => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            title={t.label}
            onClick={() => {
              document.documentElement.setAttribute('data-theme', t.key)
              onChange(t.key)
            }}
            className={`flex items-center gap-2 rounded-full border-2 py-1.5 pl-1.5 pr-3 text-xs font-medium transition ${
              active ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]' : 'border-[var(--line)] text-gray-600 hover:border-[var(--accent-soft)]'
            }`}
          >
            <span className="h-5 w-5 shrink-0 rounded-full border border-black/10" style={{ background: t.swatch }} aria-hidden="true" />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
