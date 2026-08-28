// Farbschemata (Stefan 2026-08-27, "mach mal noch eine Farbauswahl") — die
// eigentlichen Farbwerte stehen als CSS-Variablen in globals.css unter
// [data-theme='<key>']; hier nur die Auswahlliste (Label + Vorschau-Farbe
// fürs Swatch in ColorThemePicker.tsx) + serverseitige Validierung.
export const COLOR_THEMES = [
  { key: 'marine', label: 'Marine (Standard)', swatch: '#1e477a' },
  { key: 'forest', label: 'Wald', swatch: '#1e6b4f' },
  { key: 'bordeaux', label: 'Bordeaux', swatch: '#7a2236' },
  { key: 'graphite', label: 'Graphit', swatch: '#3a4551' },
  { key: 'teal', label: 'Petrol', swatch: '#0f6b72' },
  { key: 'violet', label: 'Violett', swatch: '#5b3a8a' },
] as const

export type ColorThemeKey = (typeof COLOR_THEMES)[number]['key']
export const COLOR_THEME_KEYS = COLOR_THEMES.map((t) => t.key) as ColorThemeKey[]

export function isColorThemeKey(value: string): value is ColorThemeKey {
  return (COLOR_THEME_KEYS as string[]).includes(value)
}
