'use client'

// System-Metriken fürs Betreiber-Cockpit (Stefan 2026-08-27, Review-Fund "im
// Systemverwalter fehlt CPU-Auslastung, Speicher und Arbeitsspeicher sowie
// KI-Verbrauch als Graph") — pollt api/platform/metrics und zeichnet je
// Kennzahl eine kleine Verlaufsgrafik als reines Inline-SVG (keine neue
// Abhängigkeit nötig für vier simple Linienverläufe).
// Zeitraum bewusst unterschiedlich (Stefan 2026-08-27, "beim KI-Verbrauch
// sollte der Zeitraum über einen Monat gehen, beim Rest 24 Stunden"):
// CPU/RAM/Speicherplatz kommen aus dem In-Prozess-Ringpuffer (siehe
// lib/metrics.ts) — 24 Stunden bei 60s-Takt, beginnt leer bei jedem
// Server-Neustart. KI-Verbrauch kommt stattdessen aus täglichen, in der DB
// gespeicherten Schnappschüssen (MetricDailySnapshot) — übersteht
// Neustarts, reicht 30 Tage zurück.
import { useEffect, useState } from 'react'

type MetricSample = {
  at: number
  cpuPercent: number
  memPercent: number
  memUsedMb: number
  memTotalMb: number
  diskPercent: number | null
  diskUsedGb: number | null
  diskTotalGb: number | null
  aiTokensTotal: number
}

type DailySnapshot = { at: number; aiTokensTotal: number }

const POLL_MS = 30_000

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

/**
 * Verlaufsgrafik MIT X-/Y-Achse und Einheiten (Stefan 2026-08-27, "bei den
 * Anzeigen für die Graphen bitte auch eine X/Y-Achse anzeigen mit
 * Einheiten") — Y-Achse zeigt Minimum/Maximum des sichtbaren Verlaufs samt
 * Einheit (%, Tokens …), X-Achse den Zeitraum (erster/letzter Messzeitpunkt,
 * Formatierung per xFormat — Uhrzeit bei 24h-Verläufen, Datum beim
 * Monatsverlauf). Generisch über T, damit sowohl MetricSample (24h) als
 * auch DailySnapshot (30 Tage) hier durchlaufen können, ohne den Zeitpunkt
 * (at) vom Wert zu trennen.
 */
function Sparkline<T extends { at: number }>({
  samples, pick, unit, color, xFormat = fmtTime,
}: { samples: T[]; pick: (s: T) => number | null; unit: string; color: string; xFormat?: (ms: number) => string }) {
  const w = 240
  const h = 64
  const padLeft = 32 // Platz für Y-Achsen-Beschriftung
  const padBottom = 14 // Platz für X-Achsen-Beschriftung (Zeit/Datum)
  const padTop = 6
  const plotW = w - padLeft
  const plotH = h - padBottom - padTop

  const points = samples
    .map((s) => ({ at: s.at, v: pick(s) }))
    .filter((p): p is { at: number; v: number } => p.v !== null)

  if (points.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full">
        <text x={w / 2} y={h / 2} textAnchor="middle" fontSize="9" fill="var(--text-muted, #999)">
          Verlauf füllt sich …
        </text>
      </svg>
    )
  }

  const values = points.map((p) => p.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  // "compact" (Stefan 2026-08-27): Token-Zahlen können fünf-/sechsstellig
  // werden — ohne Kompaktnotation würde die Y-Beschriftung im schmalen
  // linken Rand (padLeft) abgeschnitten. Bei Prozentwerten (immer < 1000)
  // ändert sich dadurch nichts.
  const fmtVal = (v: number) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 1, notation: 'compact' })}${unit}`

  const xFor = (i: number) => padLeft + (i / (points.length - 1)) * plotW
  const yFor = (v: number) => padTop + plotH - ((v - min) / span) * plotH
  const polyPoints = points.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.v).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full">
      {/* Y-Achse */}
      <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} stroke="var(--line)" strokeWidth="1" />
      {/* X-Achse */}
      <line x1={padLeft} y1={padTop + plotH} x2={w} y2={padTop + plotH} stroke="var(--line)" strokeWidth="1" />
      {/* Y-Beschriftung: Maximum oben, Minimum unten am Achsenende */}
      <text x={padLeft - 3} y={padTop + 6} textAnchor="end" fontSize="8" fill="var(--text-muted, #999)">{fmtVal(max)}</text>
      <text x={padLeft - 3} y={padTop + plotH} textAnchor="end" fontSize="8" fill="var(--text-muted, #999)">{fmtVal(min)}</text>
      {/* X-Beschriftung: erster/letzter Messzeitpunkt des sichtbaren Verlaufs */}
      <text x={padLeft} y={h} textAnchor="start" fontSize="8" fill="var(--text-muted, #999)">{xFormat(points[0].at)}</text>
      <text x={w} y={h} textAnchor="end" fontSize="8" fill="var(--text-muted, #999)">{xFormat(points[points.length - 1].at)}</text>
      <polyline points={polyPoints} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function bar(percent: number, warn = 75, danger = 90) {
  const p = Math.min(100, Math.max(0, percent))
  const color = percent >= danger ? 'var(--danger)' : percent >= warn ? 'var(--warn-strong)' : 'var(--accent)'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full" style={{ width: `${p}%`, background: color }} />
    </div>
  )
}

/**
 * Feste Zeilenraster pro Kachel (Stefan 2026-08-27, "immer noch" verrutscht
 * — die vorherige flex/mt-auto-Lösung verließ sich darauf, dass eine
 * Prozent-Höhe (h-full) auf einem CSS-Grid-Kind zuverlässig auflöst, was in
 * der Praxis nicht überall der Fall war). Jetzt reserviert JEDE Kachel per
 * grid-template-rows FESTE Höhen für Info-Zeile und Balken, unabhängig
 * davon, ob eine Kachel sie tatsächlich befüllt (CPU ohne Info-Zeile,
 * KI-Verbrauch ohne Balken) — die Sparkline landet dadurch bei allen vier
 * Kacheln bautechnisch garantiert in derselben Zeile, ohne auf verfügbaren
 * Leerraum angewiesen zu sein.
 */
const TILE_ROWS = 'grid grid-rows-[auto_auto_16px_14px_auto] gap-y-1'

export function MetricsPanel() {
  const [current, setCurrent] = useState<MetricSample | null>(null)
  const [history, setHistory] = useState<MetricSample[]>([])
  const [aiTokenHistory, setAiTokenHistory] = useState<DailySnapshot[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch('/api/platform/metrics', { cache: 'no-store' })
      if (!res.ok || cancelled) return
      const data = await res.json()
      setCurrent(data.current)
      setHistory(data.history)
      setAiTokenHistory(data.aiTokenHistory ?? [])
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  if (!current) {
    return (
      <section className="dp-card">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Systemauslastung</h2>
        <p className="text-sm text-gray-400">Lade …</p>
      </section>
    )
  }

  const allSamples = [...history, current]
  // Heutiger Tages-Schnappschuss fehlt in aiTokenHistory bis zum nächsten
  // 60s-Tick (siehe lib/metrics.ts, ensureTodaySnapshot) — den aktuellen
  // Zählerstand hier ergänzen, sonst hinkt die Monatsgrafik einen Tag
  // hinterher.
  const tokenHistoryWithToday = [...aiTokenHistory, { at: current.at, aiTokensTotal: current.aiTokensTotal }]

  return (
    <section className="dp-card">
      <h2
        className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500"
        title="Ein-Minuten-Lastmittel/Kernzahl (CPU), Gesamtsystem-RAM und Speicherplatz des Servers — Verlauf der letzten 24 Stunden seit dem letzten Neustart dieses Prozesses, alle 60 Sekunden ein Messpunkt. KI-Verbrauch dagegen als Monatsverlauf, siehe dort."
      >
        Systemauslastung
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={TILE_ROWS}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">CPU-Auslastung</p>
          <p className="font-serif text-2xl font-semibold text-[var(--accent)]">{current.cpuPercent.toFixed(0)}%</p>
          <div />
          <div className="flex items-center">{bar(current.cpuPercent)}</div>
          <div><Sparkline samples={allSamples} pick={(s) => s.cpuPercent} unit="%" color="var(--accent)" /></div>
        </div>
        <div className={TILE_ROWS}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Arbeitsspeicher</p>
          <p className="font-serif text-2xl font-semibold text-[var(--accent)]">{current.memPercent.toFixed(0)}%</p>
          <p className="text-[11px] text-gray-400">{(current.memUsedMb / 1024).toFixed(1)} / {(current.memTotalMb / 1024).toFixed(1)} GB</p>
          <div className="flex items-center">{bar(current.memPercent)}</div>
          <div><Sparkline samples={allSamples} pick={(s) => s.memPercent} unit="%" color="var(--accent)" /></div>
        </div>
        <div className={TILE_ROWS}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Speicherplatz</p>
          {current.diskPercent != null ? (
            <>
              <p className="font-serif text-2xl font-semibold text-[var(--accent)]">{current.diskPercent.toFixed(0)}%</p>
              <p className="text-[11px] text-gray-400">{current.diskUsedGb?.toFixed(0)} / {current.diskTotalGb?.toFixed(0)} GB belegt</p>
              <div className="flex items-center">{bar(current.diskPercent)}</div>
              <div><Sparkline samples={allSamples} pick={(s) => s.diskPercent} unit="%" color="var(--accent)" /></div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">nicht verfügbar</p>
              <div />
              <div />
              <div />
            </>
          )}
        </div>
        <div className={TILE_ROWS}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500" title="Grobe Abschätzung anhand der vom KI-Anbieter gemeldeten Tokenzahl — keine Kostenschätzung (Anbieter/Modelle haben stark unterschiedliche Preise), siehe Systemeinstellungen → KI.">
            KI-Verbrauch (Tokens)
          </p>
          <p className="font-serif text-2xl font-semibold text-[var(--accent)]">{current.aiTokensTotal.toLocaleString('de-DE')}</p>
          <p className="text-[11px] text-gray-400">gesamt seit letztem Zurücksetzen · Verlauf über 30 Tage</p>
          <div />
          <div>
            <Sparkline samples={tokenHistoryWithToday} pick={(s) => s.aiTokensTotal} unit=" Tok." color="var(--accent)" xFormat={fmtDate} />
          </div>
        </div>
      </div>
    </section>
  )
}
