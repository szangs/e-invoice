// System-Metriken fürs Betreiber-Cockpit (Stefan 2026-08-27, Review-Fund "im
// Systemverwalter fehlt CPU-Auslastung, Speicher und Arbeitsspeicher sowie
// KI-Verbrauch als Graph"): ein leichtgewichtiger, In-Prozess-Sammler statt
// eines eigenen pm2-Prozesses (anders als der Mail-Eingang per Graph braucht
// eine Verlaufsgrafik keine Kontinuität über einen Server-Neustart hinweg —
// ein Ringpuffer im Prozessspeicher reicht, verliert seine Historie beim
// Neustart aber gewinnt dafür deutlich an Einfachheit). Läuft, sobald das
// Modul zum ersten Mal geladen wird (bei erstem Zugriff auf /platform oder
// die Metriken-API) — bis dahin ist die Historie leer, "aktuell" ist aber
// sofort verfügbar.
import { statfsSync } from 'fs'
import os from 'os'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'

export type MetricSample = {
  at: number // Date.now()
  cpuPercent: number // Auslastung (Ein-Minuten-Lastmittel / Kernanzahl), kann >100 bei Überlast
  memPercent: number
  memUsedMb: number
  memTotalMb: number
  diskPercent: number | null
  diskUsedGb: number | null
  diskTotalGb: number | null
  aiTokensTotal: number
}

export type DailySnapshot = { at: number; aiTokensTotal: number }

const SAMPLE_INTERVAL_MS = 60_000
// 24 Stunden bei 60s-Takt (Stefan 2026-08-27, "Zeitraum sollte bei CPU/RAM/
// Speicherplatz 24 Stunden gehen") — In-Memory reicht dafür, siehe
// Modul-Kommentar unten zum KI-Verbrauch, der einen Monat abdecken soll und
// deshalb NICHT hierüber läuft, sondern über MetricDailySnapshot.
const MAX_SAMPLES = 1440
const AI_TOKEN_HISTORY_DAYS = 30

// globalThis-Singleton statt Modul-Variable (wie lib/db.ts) — überlebt Next.js
// Dev-Hot-Reload, das dieses Modul sonst mehrfach neu auswerten und mehrere
// parallele Intervalle starten würde.
const g = globalThis as unknown as {
  __metricsSamples?: MetricSample[]
  __metricsTimer?: ReturnType<typeof setInterval>
  __metricsSnapshotCheckedDay?: string
}

function diskUsage(): { percent: number | null; usedGb: number | null; totalGb: number | null } {
  try {
    const st = statfsSync(process.cwd())
    const total = st.blocks * st.bsize
    const free = st.bfree * st.bsize
    const used = total - free
    return {
      percent: total > 0 ? (used / total) * 100 : null,
      usedGb: used / 1024 ** 3,
      totalGb: total / 1024 ** 3,
    }
  } catch {
    return { percent: null, usedGb: null, totalGb: null }
  }
}

async function captureSample(): Promise<MetricSample> {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const cpuCount = os.cpus().length || 1
  const disk = diskUsage()
  const tokensRaw = await getSetting('AI_TOKENS_TOTAL').catch(() => '')
  return {
    at: Date.now(),
    cpuPercent: (os.loadavg()[0] / cpuCount) * 100,
    memPercent: (usedMem / totalMem) * 100,
    memUsedMb: usedMem / 1024 ** 2,
    memTotalMb: totalMem / 1024 ** 2,
    diskPercent: disk.percent,
    diskUsedGb: disk.usedGb,
    diskTotalGb: disk.totalGb,
    aiTokensTotal: Number(tokensRaw) || 0,
  }
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

/**
 * Schreibt den heutigen KI-Verbrauchs-Schnappschuss, falls noch keiner
 * existiert (Stefan 2026-08-27, Monatsverlauf) — per Upsert unschädlich bei
 * mehreren parallelen Prozessen/Neustarts an einem Tag. __metricsSnapshotCheckedDay
 * verhindert, dass jeder 60s-Tick unnötig die DB anfragt, sobald der
 * heutige Schnappschuss einmal bestätigt wurde.
 */
async function ensureTodaySnapshot(): Promise<void> {
  const now = new Date()
  const dayKey = utcDayKey(now)
  if (g.__metricsSnapshotCheckedDay === dayKey) return
  const dayStart = new Date(`${dayKey}T00:00:00.000Z`)
  const tokensRaw = await getSetting('AI_TOKENS_TOTAL').catch(() => '')
  await prisma.metricDailySnapshot.upsert({
    where: { date: dayStart },
    // Update statt Ignorieren (Stefan 2026-08-27): der heutige Schnappschuss
    // soll den TAGESAKTUELLEN Zählerstand zeigen, nicht nur den allerersten
    // Wert des Tages — sonst würde der letzte, unfertige Punkt der
    // Monatsgrafik immer stehen bleiben, statt mit dem Tag mitzuwachsen.
    update: { aiTokensTotal: Number(tokensRaw) || 0 },
    create: { date: dayStart, aiTokensTotal: Number(tokensRaw) || 0 },
  })
  g.__metricsSnapshotCheckedDay = dayKey
}

/** Startet den Sammler einmalig für den laufenden Serverprozess (idempotent). */
export function ensureMetricsSampler(): void {
  if (g.__metricsTimer) return
  if (!g.__metricsSamples) g.__metricsSamples = []
  const tick = () => {
    captureSample()
      .then((s) => {
        const arr = g.__metricsSamples!
        arr.push(s)
        if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES)
      })
      .catch(() => undefined)
    ensureTodaySnapshot().catch(() => undefined)
  }
  tick() // sofort einen ersten Punkt, nicht erst nach 60s
  g.__metricsTimer = setInterval(tick, SAMPLE_INTERVAL_MS)
  // Darf den Prozess nicht am Beenden hindern (z. B. beim Dev-Neustart)
  g.__metricsTimer.unref?.()
}

/** Letzte AI_TOKEN_HISTORY_DAYS Tages-Schnappschüsse für die Monatsgrafik (Stefan 2026-08-27). */
export async function getAiTokenHistory(): Promise<DailySnapshot[]> {
  const since = new Date(Date.now() - AI_TOKEN_HISTORY_DAYS * 24 * 60 * 60 * 1000)
  const rows = await prisma.metricDailySnapshot.findMany({
    where: { date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { date: true, aiTokensTotal: true },
  })
  return rows.map((r) => ({ at: r.date.getTime(), aiTokensTotal: r.aiTokensTotal }))
}

/** Verlauf seit Prozessstart, max. 24 Stunden (s. o.), plus aktueller Momentaufnahme. */
export async function getMetrics(): Promise<{ current: MetricSample; history: MetricSample[]; aiTokenHistory: DailySnapshot[] }> {
  ensureMetricsSampler()
  const history = g.__metricsSamples ?? []
  const [current, aiTokenHistory] = await Promise.all([captureSample(), getAiTokenHistory()])
  return { current, history, aiTokenHistory }
}
