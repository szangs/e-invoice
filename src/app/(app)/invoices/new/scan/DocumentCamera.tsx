'use client'

// Live-Kamera-Scan mit automatischer Kantenerkennung (Stefan 2026-07-08:
// "das Programm soll selbst erkennen, dass die Seite vollständig sichtbar
// ist, bevor man abschicken kann"). Statt eines Einzelfotos (natives
// Kamera-<input>, siehe scan/page.tsx "+ Seite hinzufügen") läuft hier ein
// Live-Video, in dem laufend nach einem Rechteck ("Blatt Papier") gesucht
// wird — erst wenn es vollständig im Bild UND kurz ruhig gehalten wird,
// wird automatisch (oder per Knopf) aufgenommen und perspektivisch
// entzerrt/zugeschnitten.
//
// Technik: jscanify (Kontur-/Ecken-Erkennung + Perspektivkorrektur) auf
// Basis von OpenCV.js. OpenCV.js ist ein ~8-10 MB WASM-Paket und wird NICHT
// gebündelt, sondern per <script> von der offiziellen OpenCV-CDN geladen
// (einmalig, danach vom Browser gecacht) — verarbeitet Bilder nur lokal im
// Browser, sendet nichts an den Server.
//
// ACHTUNG: Schwellwerte (Flächenanteil, Rand-Abstand, Stabilitäts-Dauer)
// sind erste Schätzwerte und müssen auf einem echten Handy nachjustiert
// werden (Lichtverhältnisse, Hintergrund, Kameraqualität variieren stark).
import { useEffect, useRef, useState } from 'react'

const OPENCV_SRC = 'https://docs.opencv.org/4.7.0/opencv.js'
const DETECT_INTERVAL_MS = 200
const STABLE_FRAMES_FOR_AUTO_CAPTURE = 5 // ~1s bei 200ms Intervall
const MIN_AREA_RATIO = 0.15 // Dokument muss mind. 15% der Bildfläche einnehmen
const MAX_AREA_RATIO = 0.97
const EDGE_MARGIN_RATIO = 0.015 // Ecken dürfen nicht zu nah am Bildrand liegen (= abgeschnitten)
const PROCESS_MAX_DIM = 700 // Analyse-Auflösung klein halten (Tempo/Akku)

type Corner = { x: number; y: number }
type Corners = {
  topLeftCorner?: Corner
  topRightCorner?: Corner
  bottomLeftCorner?: Corner
  bottomRightCorner?: Corner
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvNamespace = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Scanner = any

let openCvLoadPromise: Promise<CvNamespace> | null = null

/** Lädt OpenCV.js einmalig (über mehrere Komponenten-Instanzen hinweg geteilt). */
function loadOpenCv(): Promise<CvNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Nur im Browser verfügbar.'))
  const w = window as unknown as { cv?: CvNamespace }
  if (w.cv?.Mat) return Promise.resolve(w.cv)
  if (openCvLoadPromise) return openCvLoadPromise
  openCvLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${OPENCV_SRC}"]`)
    const onReady = () => {
      const cv = (window as unknown as { cv?: CvNamespace }).cv
      if (!cv) { reject(new Error('OpenCV.js konnte nicht geladen werden.')); return }
      if (cv.Mat) { resolve(cv); return }
      // ältere Builds signalisieren Fertigstellung über onRuntimeInitialized
      cv.onRuntimeInitialized = () => resolve(cv)
    }
    if (existing) {
      existing.addEventListener('load', onReady)
      existing.addEventListener('error', () => reject(new Error('OpenCV.js konnte nicht geladen werden (Netzwerk).')))
      return
    }
    const script = document.createElement('script')
    script.src = OPENCV_SRC
    script.async = true
    script.onload = onReady
    script.onerror = () => reject(new Error('OpenCV.js konnte nicht geladen werden (Netzwerk).'))
    document.head.appendChild(script)
  })
  return openCvLoadPromise
}

function allCornersPresent(c: Corners): c is Required<Corners> {
  return Boolean(c.topLeftCorner && c.topRightCorner && c.bottomLeftCorner && c.bottomRightCorner)
}

/** Prüft, ob alle 4 Ecken einen Mindestabstand zum Bildrand haben (= nicht abgeschnitten). */
function cornersWithinFrame(c: Required<Corners>, w: number, h: number): boolean {
  const mx = w * EDGE_MARGIN_RATIO
  const my = h * EDGE_MARGIN_RATIO
  return [c.topLeftCorner, c.topRightCorner, c.bottomLeftCorner, c.bottomRightCorner].every(
    (p) => p.x > mx && p.x < w - mx && p.y > my && p.y < h - my,
  )
}

export function DocumentCamera({
  onCapture, onClose,
}: {
  onCapture: (file: File) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const processCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const scannerRef = useRef<Scanner | null>(null)
  const cvRef = useRef<CvNamespace | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stableCountRef = useRef(0)
  const capturingRef = useRef(false)
  const autoCaptureRef = useRef(true)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [readyToCapture, setReadyToCapture] = useState(false)
  const [autoCaptureOn, setAutoCaptureOn] = useState(true)

  // In einem Ref gehalten (statt als Effekt-Abhängigkeit), damit das Umschalten
  // von "automatisch auslösen" NICHT die Kamera/OpenCV neu initialisiert.
  useEffect(() => {
    autoCaptureRef.current = autoCaptureOn
  }, [autoCaptureOn])

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function start() {
      try {
        const cv = await loadOpenCv()
        if (cancelled) return
        cvRef.current = cv
        const jscanify = (await import('jscanify')).default
        scannerRef.current = new jscanify()

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        if (cancelled) return

        processCanvasRef.current = document.createElement('canvas')
        setStatus('ready')

        intervalId = setInterval(() => detectFrame(), DETECT_INTERVAL_MS)
      } catch (e) {
        if (cancelled) return
        setError(
          e instanceof Error
            ? e.message.includes('Permission') || e.name === 'NotAllowedError'
              ? 'Kamera-Zugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben.'
              : e.message
            : 'Kamera konnte nicht gestartet werden.',
        )
        setStatus('error')
      }
    }

    function detectFrame() {
      const video = videoRef.current
      const overlay = overlayRef.current
      const proc = processCanvasRef.current
      const cv = cvRef.current
      const scanner = scannerRef.current
      if (!video || !overlay || !proc || !cv || !scanner || capturingRef.current) return
      if (video.readyState < 2 || video.videoWidth === 0) return

      const scale = Math.min(1, PROCESS_MAX_DIM / Math.max(video.videoWidth, video.videoHeight))
      const pw = Math.round(video.videoWidth * scale)
      const ph = Math.round(video.videoHeight * scale)
      proc.width = pw
      proc.height = ph
      const pctx = proc.getContext('2d')
      if (!pctx) return
      pctx.drawImage(video, 0, 0, pw, ph)

      overlay.width = video.videoWidth
      overlay.height = video.videoHeight
      const octx = overlay.getContext('2d')
      if (!octx) return
      octx.clearRect(0, 0, overlay.width, overlay.height)

      let img: CvNamespace | null = null
      let contour: CvNamespace | null = null
      try {
        img = cv.imread(proc)
        contour = scanner.findPaperContour(img)
        if (!contour) { stableCountRef.current = 0; setReadyToCapture(false); return }

        const corners = scanner.getCornerPoints(contour) as Corners
        const area = cv.contourArea(contour)
        const frameArea = pw * ph
        const areaRatio = frameArea > 0 ? area / frameArea : 0

        const complete = allCornersPresent(corners)
        const good =
          complete &&
          areaRatio >= MIN_AREA_RATIO &&
          areaRatio <= MAX_AREA_RATIO &&
          cornersWithinFrame(corners, pw, ph)

        // Konturlinie auf die Overlay-Canvas zeichnen (auf Video-Auflösung hochskaliert)
        if (complete) {
          const sx = video.videoWidth / pw
          const sy = video.videoHeight / ph
          const pts = [corners.topLeftCorner!, corners.topRightCorner!, corners.bottomRightCorner!, corners.bottomLeftCorner!]
          octx.strokeStyle = good ? '#16a34a' : '#f59e0b'
          octx.lineWidth = 6
          octx.beginPath()
          pts.forEach((p, i) => {
            const x = p.x * sx
            const y = p.y * sy
            if (i === 0) octx.moveTo(x, y)
            else octx.lineTo(x, y)
          })
          octx.closePath()
          octx.stroke()
        }

        if (good) {
          stableCountRef.current += 1
        } else {
          stableCountRef.current = 0
        }
        setReadyToCapture(stableCountRef.current >= 2) // Knopf schon früher aktiv als Auto-Auslösung

        if (autoCaptureRef.current && stableCountRef.current >= STABLE_FRAMES_FOR_AUTO_CAPTURE) {
          stableCountRef.current = 0
          capture()
        }
      } catch {
        // einzelnen fehlerhaften Frame überspringen — Live-Loop läuft weiter
      } finally {
        if (contour) contour.delete()
        if (img) img.delete()
      }
    }

    start()
    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // Bewusst [] — Kamera/OpenCV.js nur einmal beim Mounten initialisieren.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function capture() {
    const video = videoRef.current
    const cv = cvRef.current
    const scanner = scannerRef.current
    if (!video || !cv || !scanner || capturingRef.current) return
    capturingRef.current = true
    try {
      const full = document.createElement('canvas')
      full.width = video.videoWidth
      full.height = video.videoHeight
      const fctx = full.getContext('2d')
      if (!fctx) { capturingRef.current = false; return }
      fctx.drawImage(video, 0, 0)

      let img: CvNamespace | null = null
      let contour: CvNamespace | null = null
      try {
        img = cv.imread(full)
        contour = scanner.findPaperContour(img)
        const corners = contour ? (scanner.getCornerPoints(contour) as Corners) : null
        const useCorners = corners && allCornersPresent(corners) ? corners : undefined
        // Ziel-Seitenverhältnis grob an A4 angelehnt (DIN-Rechnungen); bei
        // erkanntem Rechteck wird ohnehin dessen tatsächliche Form entzerrt.
        const resultCanvas = scanner.extractPaper(full, 1240, 1754, useCorners)
        const source: HTMLCanvasElement = resultCanvas ?? full // kein Rechteck erkannt → unzugeschnittenes Foto als Fallback
        source.toBlob((blob) => {
          capturingRef.current = false
          if (!blob) return
          onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' }))
        }, 'image/jpeg', 0.92)
      } finally {
        if (contour) contour.delete()
        if (img) img.delete()
      }
    } catch {
      capturingRef.current = false
    }
  }

  function retryPermission() {
    setStatus('loading')
    setError('')
    // Effekt läuft durch State-Änderung nicht automatisch neu — Komponente
    // einmal neu mounten lassen ist am robustesten:
    window.location.reload()
  }

  return (
    <div className="dp-card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Live-Scan (automatische Kantenerkennung)</h3>
        <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={onClose}>Schließen</button>
      </div>

      {status === 'error' && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={retryPermission}>Erneut versuchen</button>
            <button type="button" className="btn-secondary" onClick={onClose}>Stattdessen normales Foto aufnehmen</button>
          </div>
        </div>
      )}

      {status !== 'error' && (
        <>
          <div className="relative mx-auto max-w-md overflow-hidden rounded-lg bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} className="w-full" muted playsInline />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
            {status === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">
                Kamera & Erkennung werden geladen …
              </div>
            )}
          </div>
          <p className="text-center text-xs text-gray-500">
            {readyToCapture
              ? '✓ Rechnung vollständig erkannt — wird gleich automatisch aufgenommen …'
              : 'Rechnung auf einfarbigem Untergrund vollständig ins Bild halten.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn-primary disabled:opacity-40"
              disabled={status !== 'ready' || !readyToCapture}
              onClick={capture}
            >
              Jetzt aufnehmen
            </button>
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={autoCaptureOn} onChange={(e) => setAutoCaptureOn(e.target.checked)} />
              automatisch auslösen
            </label>
          </div>
        </>
      )}
    </div>
  )
}
