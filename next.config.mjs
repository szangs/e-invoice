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
