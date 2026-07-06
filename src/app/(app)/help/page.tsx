// Hilfe: Schnellcode-Legende (aus nav-config generiert, §11.1) + Nutzungsbedingungen
import { ALL_NAV_ITEMS } from '@/lib/nav-config'
import { TERMS_TEXT, TERMS_TITLE } from '@/lib/terms'

export default function HelpPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <section className="dp-card">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500" id="codes">
          Schnellnavigation — Codes
        </h2>
        <p className="mb-3 text-sm text-gray-700">
          Befehlspalette öffnen mit <kbd className="rounded border px-1 font-mono text-xs">Strg+K</kbd>{' '}
          (auch ⌘K / Alt+K), Code oder Seitenname eingeben, mit Enter bestätigen.
        </p>
        <table className="w-full max-w-md">
          <tbody>
            {ALL_NAV_ITEMS.map((i) => (
              <tr key={i.code} className="dp-tr">
                <td className="px-2 py-1.5 font-mono text-xs text-[var(--accent)]">{i.code}</td>
                <td className="px-2 py-1.5 text-sm text-gray-700">{i.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="dp-card">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">{TERMS_TITLE}</h2>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{TERMS_TEXT}</div>
      </section>
    </div>
  )
}
