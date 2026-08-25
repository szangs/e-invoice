// Server-Zeitzone fest auf Europe/Berlin (Stefan 2026-08-25): die App ist
// ausschließlich für deutsche Mandanten gebaut, der Server läuft aber in UTC.
// date-fns format() im Server-Rendering (z. B. "Eingang"-Spalte in
// InvoiceRows.tsx) zeigte dadurch UTC-Zeiten, der Client rendert beim
// Hydrieren dieselbe Uhrzeit im Browser-Zeitzone (Europe/Berlin) — der
// abweichende Text löst "Text content does not match server-rendered HTML"
// aus. Muss so früh wie möglich gesetzt werden, next.config.mjs ist die
// erste vom Next-CLI geladene Datei. Nicht überschreiben, falls TZ bereits
// von außen (z. B. Container-Orchestrierung) vorgegeben ist.
process.env.TZ = process.env.TZ || 'Europe/Berlin'

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '15mb' },
    // @napi-rs/canvas und pdfjs-dist (lib/pdfRaster.ts, PDF-Rasterung für die
    // KI-Erkennung) enthalten native .node-Binärdateien. Ohne diese Liste
    // versucht Webpack, sie wie normalen JS-Code zu bündeln, und bricht mit
    // "Module parse failed" ab — stattdessen sollen sie zur Laufzeit ganz
    // normal per require() aus node_modules geladen werden (nicht gebündelt).
    serverComponentsExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],
  },
}

export default nextConfig
