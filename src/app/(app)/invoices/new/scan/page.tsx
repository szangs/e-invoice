'use client'

// Papierrechnung scannen (RE02b): mehrere Seiten aufnehmen — per Smartphone-
// Kamera ODER als bereits gescannte Datei (z. B. von einem am PC
// angeschlossenen Scanner/Multifunktionsgerät) — und zu EINEM PDF-Beleg
// zusammenführen, danach wie gewohnt manuell erfassen.
// Ist bereits genau eine fertige PDF-Datei ausgewählt (typischer Scanner-
// Export), wird sie unverändert übernommen, damit ein eventueller Text-/
// OCR-Layer des Scanners erhalten bleibt. Bei Fotos/mehreren Dateien wird
// im Browser ein neues PDF zusammengesetzt (pdf-lib) — der Server sieht nur
// noch die fertige Datei.
// Ist die Beleg-Verschlüsselung aktiv, wird die Datei VOR dem Upload im
// Browser verschlüsselt (Zero-Knowledge — Server sieht nur Chiffrat).
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { b64encode, decryptBytes, encryptBytes, encryptJson, generateDekRaw, importDek, sha256Hex } from '@/lib/clientCrypto'
import { decodeQrFromImage, parseGiroCode, type GiroCodeData } from '@/lib/clientQr'
import { fetchEncConfig, getCachedDek, unlockWithPassphrase } from '@/lib/keyStore'

// Handy-als-Kamera-Kopplung (Stefan 2026-08-27, siehe scan-pair/[token]/
// page.tsx + lib/scanSession.ts): PC zeigt QR-Code, Handy lädt Fotos hoch,
// PC übernimmt sie hier automatisch in die normale Seiten-Liste — ab da
// läuft alles wie bei lokal aufgenommenen Fotos weiter.
const PAIR_POLL_MS = 2000
type Pairing = { token: string; url: string; qrSvg: string; expiresAt: string; key: CryptoKey | null; photoCount: number }

const EMPTY = {
  vendor: '', invoiceNumber: '', invoiceDate: '', dueDate: '',
  amountNet: '', amountTax: '', amountGross: '', currency: 'EUR', tags: '', notes: '',
  directDebitByVendor: false,
}

type ScanPage = { id: string; file: File; kind: 'image' | 'pdf'; previewUrl: string | null }

function toInput(n: number | null): string {
  // Immer 2 Nachkommastellen (Stefan 2026-08-25, Bugfix — siehe InvoiceEditForm.tsx).
  return n === null ? '' : n.toFixed(2).replace('.', ',')
}

const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

const PAGE_W = 595.28 // A4 in pt
const PAGE_H = 841.89
const MARGIN = 20

/** Fasst die aufgenommenen Seiten zu einer einzigen Beleg-Datei zusammen. */
async function buildInvoiceFile(pages: ScanPage[]): Promise<File> {
  if (pages.length === 1 && pages[0].kind === 'pdf') {
    return new File([pages[0].file], 'papierrechnung-scan.pdf', { type: 'application/pdf' })
  }
  if (pages.length === 1 && pages[0].kind === 'image') {
    // Einzelfoto: Originalbild unverändert übernehmen (keine unnötige PDF-Verpackung).
    // Wichtig auch dafür, dass eine spätere KI-Erkennung auf dem gespeicherten
    // Beleg direkt möglich ist (Bild statt PDF).
    return pages[0].file
  }
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  // WICHTIG für Dubletten-Erkennung (Datei-Hash): pdf-lib setzt Erstellungs-/
  // Änderungsdatum sonst automatisch auf "jetzt" — bei zwei Zusammenführungen
  // mit identischem Bildinhalt entstünde trotzdem jedes Mal ein anderer Hash,
  // nur weil unser eigenes PDF-Zusammenführen einen neuen Zeitstempel schreibt.
  // Fester Wert macht das Ergebnis bei gleichem Inhalt bit-identisch.
  out.setCreationDate(new Date(0))
  out.setModificationDate(new Date(0))
  for (const p of pages) {
    const bytes = new Uint8Array(await p.file.arrayBuffer())
    if (p.kind === 'pdf') {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const copied = await out.copyPages(src, src.getPageIndices())
      copied.forEach((pg) => out.addPage(pg))
    } else {
      const isPng = p.file.type === 'image/png'
      const img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes)
      const maxW = PAGE_W - MARGIN * 2
      const maxH = PAGE_H - MARGIN * 2
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)
      const w = img.width * scale
      const h = img.height * scale
      const pg = out.addPage([PAGE_W, PAGE_H])
      pg.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h })
    }
  }
  const bytes = await out.save()
  return new File([bytes as unknown as BlobPart], 'papierrechnung-scan.pdf', { type: 'application/pdf' })
}

export default function ScanInvoicePage() {
  const router = useRouter()
  const [f, setF] = useState(EMPTY)
  const [pages, setPages] = useState<ScanPage[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [encEnabled, setEncEnabled] = useState(false)
  const [locked, setLocked] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  // "Freigeben" gleich beim Erfassen anbieten (Stefan 2026-08-27, "beim
  // Erfassen einer Rechnung mit Handy oder Kamera bitte gleich die Option
  // Freigeben mit dazunehmen") — spart bei einfachen Fällen den Umweg über
  // die Detailseite. Läuft NACH dem eigentlichen Speichern als zusätzlicher
  // PATCH mit denselben Feldern wie der "Prüfen & freigeben"-Knopf dort
  // (InvoiceEditForm.tsx primaryAction) — dieselbe Server-Route prüft dabei
  // ganz genauso Korb-Recht (APPROVE) und offene Klärungspunkte (Dublette,
  // fehlende Pflichtangaben, Spam-Verdacht …); ohne Berechtigung oder bei
  // ungeklärten Punkten schlägt der Zusatzschritt einfach fehl, ohne dass
  // das eigentliche Speichern der Rechnung davon betroffen wäre.
  const [approveAfterSave, setApproveAfterSave] = useState(false)
  // Zahlungs-QR-Code auf dem Beleg selbst (Stefan 2026-08-27, "die
  // Möglichkeit einkalkulieren, dass der Beleg schon einen QR-Code hat") —
  // siehe lib/clientQr.ts. Nur der ERSTE gefundene gültige GiroCode zählt
  // (mehrseitige Belege haben höchstens auf einer Seite einen).
  const [giroCode, setGiroCode] = useState<GiroCodeData | null>(null)
  const [giroCodeApplied, setGiroCodeApplied] = useState(false)
  const [giroCodeDismissed, setGiroCodeDismissed] = useState(false)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiReason, setAiReason] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [aiFlags, setAiFlags] = useState<string[]>([])
  const [usedAi, setUsedAi] = useState(false)
  // Zwei getrennte <input>-Elemente statt einem gemeinsamen mit "capture"
  // (Stefan 2026-08-27, "muss richtig gehen am PC und am Handy") — ein
  // einzelner Input mit capture="environment" UND accept="image/*,
  // application/pdf" verhält sich browser-/OS-abhängig unzuverlässig
  // (v. a. iOS Safari öffnet dann teils direkt nur die Kamera und blendet
  // die Datei-/Fotomediathek-Auswahl ganz aus, oder ignoriert PDF in der
  // Kamera-Ansicht). Getrennt ist beides für sich hundertprozentig
  // vorhersagbar: capture+image/* erzwingt zuverlässig die Kamera-App,
  // der zweite Input ganz ohne capture öffnet immer den normalen
  // Datei-/Mediatheken-Dialog (PC: Explorer/Finder inkl. Scanner-Ordner,
  // Handy: Fotos/Dateien-App) — auf beiden Plattformen nutzbar.
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState('')
  // Nur als Ref, nicht als State — löst bei jedem eintreffenden Foto keinen
  // eigenen Re-Render aus, wird nur vom Polling-Intervall gelesen/geschrieben.
  const lastSeenRef = useRef<string>('')

  useEffect(() => {
    fetchEncConfig().then(async (cfg) => {
      setEncEnabled(cfg.enabled)
      if (cfg.enabled) setLocked(!(await getCachedDek()))
    }).catch(() => undefined)
    fetch('/api/ai/config')
      .then((r) => r.json())
      .then((d) => {
        setAiAvailable(Boolean(d.available))
        setAiReason(d.reason ?? '')
      })
      .catch(() => undefined)
  }, [])

  // Objekt-URLs beim Verlassen der Seite wieder freigeben (Ref, damit die
  // Cleanup-Funktion beim Unmount den zuletzt aktuellen Stand sieht)
  const pagesRef = useRef<ScanPage[]>([])
  useEffect(() => {
    pagesRef.current = pages
  }, [pages])
  useEffect(() => {
    return () => pagesRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
  }, [])

  const set = (key: keyof typeof EMPTY, value: string) => setF((p) => ({ ...p, [key]: value }))

  // Zahlungs-QR-Code prüfen (Stefan 2026-08-27, s. o.) — läuft für jedes neu
  // hinzugekommene FOTO (nicht PDF) im Hintergrund, blockiert also nicht die
  // Aufnahme weiterer Seiten. Funktionales Update statt direktem giroCode-
  // Zugriff, damit bei mehreren parallel dekodierenden Fotos zuverlässig nur
  // der zuerst fertige Treffer zählt (keine verlorene Aktualisierung).
  async function checkForGiroCode(file: File) {
    const text = await decodeQrFromImage(file).catch(() => null)
    if (!text) return
    const parsed = parseGiroCode(text)
    if (!parsed) return
    setGiroCode((prev) => prev ?? parsed)
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // Feld leeren, damit dieselbe Aufnahme/Datei erneut ausgewählt werden kann
    const next: ScanPage[] = files.map((file) => {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        kind: isPdf ? 'pdf' : 'image',
        previewUrl: isPdf ? null : URL.createObjectURL(file),
      }
    })
    setPages((p) => [...p, ...next])
    next.forEach((p) => { if (p.kind === 'image') checkForGiroCode(p.file) })
  }

  // Zahlungs-QR-Code übernehmen (Stefan 2026-08-27) — füllt bewusst nur
  // LEERE Felder (nie ein bereits vom Bearbeiter eingegebener Wert wird
  // überschrieben), genau wie die Lieferanten-Schnellausfüllung. IBAN/BIC
  // haben hier kein eigenes Feld — die gehen erst beim Speichern mit (siehe
  // submit unten), zusammen mit dem restlichen Inhalt.
  function applyGiroCode() {
    if (!giroCode) return
    setF((p) => ({
      ...p,
      vendor: p.vendor || giroCode.creditorName || p.vendor,
      amountGross: !p.amountGross && giroCode.amount !== null ? toInput(giroCode.amount) : p.amountGross,
      currency: giroCode.currency && CURRENCIES.includes(giroCode.currency) ? giroCode.currency : p.currency,
      invoiceNumber: !p.invoiceNumber && giroCode.reference ? giroCode.reference : p.invoiceNumber,
    }))
    setGiroCodeApplied(true)
  }

  function removePage(id: string) {
    setPages((p) => {
      const found = p.find((x) => x.id === id)
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl)
      return p.filter((x) => x.id !== id)
    })
  }

  function move(id: string, dir: -1 | 1) {
    setPages((p) => {
      const i = p.findIndex((x) => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= p.length) return p
      const next = [...p]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function openPairing() {
    setPairingBusy(true)
    setPairingError('')
    try {
      const res = await fetch('/api/scan-sessions', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPairingError(data.error ?? 'Kopplung konnte nicht gestartet werden.')
        return
      }
      // Eigener, zufälliger Einmal-Schlüssel NUR für diese Sitzung — bewusst
      // ohne jeden Bezug zum echten Beleg-Datenschlüssel (Zero-Knowledge,
      // siehe Kommentar in schema.prisma/ScanSession). Steckt nur im
      // URL-Fragment (#k=…), geht also nie an den Server.
      let key: CryptoKey | null = null
      let keyFragment = ''
      if (encEnabled) {
        const raw = generateDekRaw()
        key = await importDek(raw)
        keyFragment = `#k=${encodeURIComponent(b64encode(raw))}`
      }
      const url = `${window.location.origin}/scan-pair/${data.token}${keyFragment}`
      const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 })
      lastSeenRef.current = ''
      setPairing({ token: data.token, url, qrSvg, expiresAt: data.expiresAt, key, photoCount: 0 })
    } catch {
      setPairingError('Kopplung konnte nicht gestartet werden.')
    } finally {
      setPairingBusy(false)
    }
  }

  function closePairing() {
    // Das eigentliche Schließen (DELETE) übernimmt die Cleanup-Funktion des
    // Polling-Effects unten — die kennt den zugehörigen Token korrekt aus
    // ihrem eigenen Closure, unabhängig davon, ob wegen expliziten
    // Schließens, Sitzungswechsels oder Verlassens der Seite aufgeräumt wird
    // (react-hooks/exhaustive-deps würde bei einem separaten, leer
    // abhängigen Effect sonst einen veralteten pairing-Wert einfangen).
    setPairing(null)
  }

  // Polling der Handy-Fotos (Stefan 2026-08-27): solange die Kopplung offen
  // ist, alle 2s neue Fotos abholen und wie lokal aufgenommene Seiten
  // übernehmen. Die Cleanup-Funktion schließt die Sitzung server-seitig —
  // sie läuft sowohl bei jedem Pairing-Wechsel als auch beim Verlassen der
  // Seite, sonst bliebe der Token bis zum Ablauf (15 Min) nutzbar.
  useEffect(() => {
    if (!pairing) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/scan-sessions/${pairing.token}/photos?since=${encodeURIComponent(lastSeenRef.current)}`)
        if (res.status === 410) {
          if (!cancelled) { setPairingError('Sitzung abgelaufen — bitte neu koppeln.'); setPairing(null) }
          return
        }
        const data = await res.json().catch(() => ({ photos: [] }))
        const photos = (data.photos ?? []) as { id: string; mimeType: string; encrypted: boolean; createdAt: string }[]
        for (const p of photos) {
          const fileRes = await fetch(`/api/scan-sessions/${pairing.token}/photos/${p.id}`)
          if (!fileRes.ok) continue
          let bytes = await fileRes.arrayBuffer()
          if (p.encrypted && pairing.key) {
            try { bytes = await decryptBytes(pairing.key, bytes) } catch { continue }
          }
          const file = new File([bytes], `handy-scan-${p.id}.jpg`, { type: p.mimeType })
          if (cancelled) return
          setPages((prev) => [...prev, {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file, kind: 'image', previewUrl: URL.createObjectURL(file),
          }])
          checkForGiroCode(file)
          setPairing((prev) => (prev ? { ...prev, photoCount: prev.photoCount + 1 } : prev))
          lastSeenRef.current = p.createdAt
        }
      } catch {
        // Netzwerkfehler beim Polling sind kein Abbruch wert — nächster Tick versucht's erneut.
      }
    }, PAIR_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      fetch(`/api/scan-sessions/${pairing.token}`, { method: 'DELETE' }).catch(() => undefined)
    }
    // Bewusst nur auf token reagieren, nicht auf ganz pairing (Stefan
    // 2026-08-27) — sonst würde jeder photoCount-Zähler-Tick (siehe
    // setPairing im Intervall) den Poll-Timer neu aufsetzen. key/token
    // ändern sich innerhalb einer Sitzung nie, der Closure-Wert bleibt
    // also korrekt; photoCount wird bewusst nur per funktionalem Update
    // geschrieben, nie aus diesem Closure gelesen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing?.token])

  async function fillWithAi() {
    const firstPhoto = pages.find((p) => p.kind === 'image')
    if (!firstPhoto) {
      setAiError('KI-Erkennung braucht mindestens eine fotografierte Seite (kein PDF).')
      return
    }
    setAiBusy(true)
    setAiError('')
    setAiWarnings([])
    setAiFlags([])
    try {
      const fd = new FormData()
      fd.append('file', firstPhoto.file)
      const res = await fetch('/api/invoices/ai-extract', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setAiError(data.error ?? 'KI-Erkennung fehlgeschlagen.')
        return
      }
      const d = data.data as {
        vendor: string | null; invoiceNumber: string | null; invoiceDate: string | null
        dueDate: string | null; amountNet: number | null; amountTax: number | null
        amountGross: number | null; currency: string | null; tags: string | null
        directDebitByVendor: boolean | null
        uncertainFields: string[]; warnings: string[]
      }
      setF((p) => ({
        ...p,
        vendor: d.vendor ?? p.vendor,
        invoiceNumber: d.invoiceNumber ?? p.invoiceNumber,
        invoiceDate: d.invoiceDate ?? p.invoiceDate,
        dueDate: d.dueDate ?? p.dueDate,
        amountNet: d.amountNet !== null ? toInput(d.amountNet) : p.amountNet,
        amountTax: d.amountTax !== null ? toInput(d.amountTax) : p.amountTax,
        amountGross: d.amountGross !== null ? toInput(d.amountGross) : p.amountGross,
        currency: d.currency && CURRENCIES.includes(d.currency) ? d.currency : p.currency,
        tags: d.tags ?? p.tags,
        directDebitByVendor: d.directDebitByVendor ?? p.directDebitByVendor,
      }))
      setAiFlags(d.uncertainFields ?? [])
      setAiWarnings(d.warnings ?? [])
      setUsedAi(true)
    } catch {
      setAiError('KI-Erkennung fehlgeschlagen.')
    } finally {
      setAiBusy(false)
    }
  }

  async function checkDuplicateFirst(fileHash: string | null): Promise<boolean> {
    // Dubletten-Vorabprüfung (Stefan 2026-07-08): fragt VOR dem Speichern nach,
    // statt eine vermutliche Dublette stillschweigend zu markieren. Bei
    // aktiver Verschlüsselung gehen Lieferant/Nummer nicht im Klartext an den
    // Server — nur der (schon vor dem Verschlüsseln gebildete) Datei-Hash zählt.
    if (!fileHash && !(!encEnabled && f.vendor && f.invoiceNumber)) return true
    try {
      const res = await fetch('/api/invoices/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileHash: fileHash ?? undefined,
          vendor: !encEnabled && f.vendor ? f.vendor : undefined,
          invoiceNumber: !encEnabled && f.invoiceNumber ? f.invoiceNumber : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.duplicate) return true
      const d = data.duplicate as { docId: string | null; vendor: string; invoiceNumber: string | null }
      return window.confirm(
        `Diese Rechnung scheint bereits erfasst zu sein (${d.docId ?? d.vendor}` +
        `${d.invoiceNumber ? ', Nr. ' + d.invoiceNumber : ''}).\n\n` +
        `Möchten Sie sie wirklich noch einmal übernehmen?`,
      )
    } catch {
      return true // Vorabprüfung ist nur ein Komfort-Feature — Fehler hier blockieren nichts
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (pages.length === 0) {
      setError('Bitte mindestens eine Seite aufnehmen oder auswählen.')
      return
    }
    setBusy(true)
    try {
      const file = await buildInvoiceFile(pages)
      // Klartext-Hash schon hier bilden (unabhängig von Verschlüsselung) — wird
      // für die Dubletten-Vorabprüfung gebraucht und bei aktiver Verschlüsselung
      // gleich weiterverwendet.
      let plainHash: string | null = null
      try { plainHash = await sha256Hex(await file.arrayBuffer()) } catch { /* Prüfung ist nur Komfort */ }
      if (!(await checkDuplicateFirst(plainHash))) return

      const fd = new FormData()
      const { directDebitByVendor, invoiceDate, dueDate, ...contentFields } = f
      // Fälligkeit/Rechnungsdatum bleiben immer Klartext (Workflow-Felder).
      if (invoiceDate) fd.append('invoiceDate', invoiceDate)
      if (dueDate) fd.append('dueDate', dueDate)
      fd.append('source', 'SCAN')
      if (usedAi) fd.append('aiAssisted', '1')
      if (directDebitByVendor) fd.append('directDebitByVendor', '1')
      // IBAN/BIC aus dem Zahlungs-QR-Code (Stefan 2026-08-27) — geht direkt
      // ins Lieferanten-Adressregister (lib/vendorMemory.ts), nicht auf die
      // Rechnung selbst (dafür gibt es hier kein Feld). Bewusst NUR bei
      // unverschlüsselten Mandanten — der Server soll die IBAN bei aktiver
      // Inhalts-Verschlüsselung genauso wenig im Klartext sehen wie
      // Lieferant/Betrag (dieselbe Zero-Knowledge-Grenze).
      if (!encEnabled && giroCodeApplied && giroCode) {
        if (giroCode.iban) fd.append('sellerIban', giroCode.iban)
        if (giroCode.bic) fd.append('sellerBic', giroCode.bic)
      }

      let dek: Awaited<ReturnType<typeof getCachedDek>> = null
      if (encEnabled) {
        dek = await getCachedDek()
        if (!dek) {
          try {
            dek = await unlockWithPassphrase(passphrase)
            setLocked(false)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Passphrase falsch.')
            return
          }
        }
      }

      if (encEnabled && dek) {
        fd.append('contentEnc', await encryptJson(dek, contentFields))
      } else {
        Object.entries(contentFields).forEach(([k, v]) => fd.append(k, v))
      }

      if (encEnabled && dek) {
        const plainBuffer = await file.arrayBuffer()
        const cipher = await encryptBytes(dek, plainBuffer)
        fd.append('file', new Blob([cipher as unknown as BlobPart]), `${file.name}.enc`)
        fd.append('encrypted', '1')
        fd.append('encOrigMime', file.type)
        if (plainHash) fd.append('fileHash', plainHash)
      } else {
        fd.append('file', file)
      }
      const res = await fetch('/api/invoices', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Speichern fehlgeschlagen.')
        return
      }
      // Freigeben-Option (s. o.) — die Rechnung ist an dieser Stelle bereits
      // gespeichert; ein Fehlschlag hier (kein Recht, offene Klärungspunkte)
      // darf das nicht rückgängig machen, nur informieren.
      if (approveAfterSave && data.invoice?.id) {
        const approveRes = await fetch(`/api/invoices/${data.invoice.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkFormal: true, checkSubstantive: true }),
        })
        if (!approveRes.ok) {
          const approveData = await approveRes.json().catch(() => ({}))
          window.alert(
            `Rechnung gespeichert — automatische Freigabe war nicht möglich: ${approveData.error ?? 'unbekannter Fehler'}\n\nBitte in der Rechnung selbst prüfen.`,
          )
        }
      }
      router.push('/invoices')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Seiten konnten nicht zusammengeführt werden.')
    } finally {
      setBusy(false)
    }
  }

  const photoCount = pages.filter((p) => p.kind === 'image').length
  const pdfCount = pages.filter((p) => p.kind === 'pdf').length

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Papierrechnung scannen</h1>
        <Link href="/invoices/new" className="text-xs text-[var(--accent)] underline">
          Stattdessen elektronische Rechnung hochladen
        </Link>
      </div>

      <div className="dp-card space-y-3">
        <p className="text-sm text-gray-600">
          <strong>Foto aufnehmen</strong> öffnet auf dem Smartphone direkt die Kamera — Seite für
          Seite fotografieren. <strong>Datei auswählen</strong> öffnet die normale Datei-/
          Mediathekenauswahl — z. B. für bereits vorhandene Fotos oder gescannte Dateien von einem
          am PC angeschlossenen Scanner (mehrere Dateien auf einmal möglich). Die Seiten werden zu
          einem PDF zusammengeführt.
        </p>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onFilesSelected}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => cameraInputRef.current?.click()}>
            📷 Foto aufnehmen
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            📁 Datei auswählen
          </button>
          <button type="button" className="btn-secondary" onClick={openPairing} disabled={pairingBusy}>
            {pairingBusy ? 'Kopplung wird gestartet …' : '📱 Mit Handy scannen'}
          </button>
        </div>
        {pairingError && <p className="text-sm text-[var(--danger)]">{pairingError}</p>}

        {pages.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              {pages.length} Seite(n) erfasst
              {photoCount > 0 && ` · ${photoCount} Foto(s)`}
              {pdfCount > 0 && ` · ${pdfCount} PDF-Datei(en)`}
              {pdfCount > 1 || (pdfCount === 1 && photoCount > 0)
                ? ' — wird beim Speichern zu einem PDF zusammengeführt'
                : ''}
            </p>
            <ul className="flex flex-wrap gap-3">
              {pages.map((p, i) => (
                <li key={p.id} className="w-28 space-y-1 rounded-lg border border-[var(--line)] p-1.5 text-center">
                  {p.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.previewUrl} alt={`Seite ${i + 1}`} className="h-24 w-full rounded object-cover" />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center rounded bg-[var(--surface-muted)] text-[10px] text-gray-500">
                      📄 PDF
                    </div>
                  )}
                  <p className="truncate text-[10px] text-gray-500" title={p.file.name}>{p.file.name}</p>
                  <div className="flex items-center justify-center gap-1 text-[10px]">
                    <button type="button" className="text-gray-500 disabled:opacity-30" disabled={i === 0}
                      onClick={() => move(p.id, -1)} title="Nach vorn">▲</button>
                    <button type="button" className="text-gray-500 disabled:opacity-30" disabled={i === pages.length - 1}
                      onClick={() => move(p.id, 1)} title="Nach hinten">▼</button>
                    <button type="button" className="text-[var(--danger)]" onClick={() => removePage(p.id)} title="Entfernen">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {giroCode && !giroCodeDismissed && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-gray-700">
            <p className="font-semibold text-gray-800">💳 Zahlungs-QR-Code auf dem Beleg erkannt</p>
            <p className="mt-1">
              {giroCode.creditorName && <>Empfänger: <strong>{giroCode.creditorName}</strong> · </>}
              IBAN: <span className="font-mono">{giroCode.iban}</span>
              {giroCode.amount !== null && <> · Betrag: {giroCode.amount.toFixed(2)} {giroCode.currency ?? 'EUR'}</>}
            </p>
            {giroCodeApplied ? (
              <p className="mt-1.5 text-[var(--accent)]">
                ✓ Übernommen — leere Felder oben wurden befüllt.{' '}
                {encEnabled
                  ? 'Die IBAN wird bei aktiver Beleg-Verschlüsselung NICHT ans Lieferantenregister übertragen (Zero-Knowledge).'
                  : 'Die IBAN geht beim Speichern ans Lieferantenregister.'}
              </p>
            ) : (
              <div className="mt-1.5 flex gap-2">
                <button type="button" className="btn-secondary" onClick={applyGiroCode}>Übernehmen</button>
                <button type="button" className="text-gray-500 underline" onClick={() => setGiroCodeDismissed(true)}>Ignorieren</button>
              </div>
            )}
          </div>
        )}

        {encEnabled && (
          <p className="text-[11px] font-medium text-[var(--accent)]">
            🔒 Beleg-Verschlüsselung aktiv — die zusammengeführte PDF-Datei wird vor dem Upload in
            Ihrem Browser verschlüsselt.
          </p>
        )}
        {encEnabled && locked && pages.length > 0 && (
          <div>
            <label className="dp-label">Verschlüsselungs-Passphrase (bleibt im Browser)</label>
            <input type="password" className="dp-input mt-1" value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)} />
          </div>
        )}
      </div>

      <form onSubmit={submit} className="dp-card space-y-4">
        {pages.length > 0 && aiAvailable ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
            <button type="button" className="btn-secondary" onClick={fillWithAi} disabled={aiBusy}>
              {aiBusy ? 'KI liest die Rechnung …' : '✨ Mit KI ausfüllen'}
            </button>
            <p className="text-[11px] text-gray-500">
              Liest die erste fotografierte Seite und befüllt die Felder unten inkl. Verschlagwortung
              (Tags). KI-generierte oder -verarbeitete Inhalte können fehlerhaft sein — bitte vor der
              Übernahme immer gegenprüfen.
              {encEnabled && (
                <span className="block text-[var(--warn-strong)]">
                  ⚠ Der Beleg wird für diese Erkennung an den externen KI-Anbieter gesendet — eine
                  bewusste Ausnahme vom Zero-Knowledge-Grundsatz für diesen einen Schritt, unser
                  Server speichert den Klartext dabei nicht.
                </span>
              )}
            </p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            {pages.length > 0 && aiReason
              ? `KI-Ausfüllhilfe nicht verfügbar: ${aiReason}`
              : 'Automatische Datenerkennung gibt es nur bei elektronischen Rechnungen — bitte die Angaben unten aus der Papierrechnung übernehmen.'}
          </p>
        )}
        {aiError && <p className="text-sm text-[var(--danger)]">{aiError}</p>}
        {aiWarnings.length > 0 && (
          <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
            ⚠ Bitte besonders prüfen — {aiWarnings.join(' ')}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lieferant *" value={f.vendor} onChange={(v) => set('vendor', v)} required warn={aiFlags.includes('vendor')} />
          <Field label="Rechnungsnummer" value={f.invoiceNumber} onChange={(v) => set('invoiceNumber', v)} warn={aiFlags.includes('invoiceNumber')} />
          <Field label="Rechnungsdatum" type="date" value={f.invoiceDate} onChange={(v) => set('invoiceDate', v)} warn={aiFlags.includes('invoiceDate')} />
          {f.directDebitByVendor ? (
            <div>
              <label className="dp-label">Fälligkeit</label>
              <p className="dp-input mt-1 flex items-center text-gray-500" title="Lieferant bucht per Lastschrift/Abbuchung selbst ab">
                wird abgebucht
              </p>
            </div>
          ) : (
            <Field label="Fälligkeit" type="date" value={f.dueDate} onChange={(v) => set('dueDate', v)} warn={aiFlags.includes('dueDate')} />
          )}
          <Field label="Netto (z. B. 1.234,56)" value={f.amountNet} onChange={(v) => set('amountNet', v)} warn={aiFlags.includes('amountNet')} />
          <Field label="Steuer" value={f.amountTax} onChange={(v) => set('amountTax', v)} warn={aiFlags.includes('amountTax')} />
          <Field label="Brutto" value={f.amountGross} onChange={(v) => set('amountGross', v)} warn={aiFlags.includes('amountGross')} />
          <div>
            <label className="dp-label">Währung</label>
            <select className="dp-input mt-1" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
              <option>EUR</option><option>USD</option><option>CHF</option><option>GBP</option>
            </select>
          </div>
          <Field label="Tags (kommagetrennt)" value={f.tags} onChange={(v) => set('tags', v)} warn={aiFlags.includes('tags')} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700"
          title="Zahlungsart ist keine steuerlich relevante Angabe der Rechnung — immer frei änderbar">
          <input type="checkbox" checked={f.directDebitByVendor}
            onChange={(e) => setF((p) => ({ ...p, directDebitByVendor: e.target.checked }))} />
          Lieferant bucht per Lastschrift/Abbuchung selbst ab (statt Überweisung)
          {aiFlags.includes('directDebitByVendor') && (
            <span className="text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>
          )}
        </label>
        <div>
          <label className="dp-label">Notizen</label>
          <textarea className="dp-input mt-1" rows={3} value={f.notes}
            onChange={(e) => set('notes', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700"
          title="Prüft formal und sachlich und gibt direkt frei — geht nur, wenn Sie dazu berechtigt sind und keine Klärungspunkte offen sind (z. B. Dublette, fehlende Pflichtangaben); sonst bleibt die Rechnung normal im Eingangskorb liegen.">
          <input type="checkbox" checked={approveAfterSave} onChange={(e) => setApproveAfterSave(e.target.checked)} />
          Nach dem Speichern gleich prüfen &amp; freigeben (falls berechtigt)
        </label>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={busy || pages.length === 0}>
            {busy ? 'Speichere …' : 'Rechnung speichern'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push('/invoices')}>Abbrechen</button>
        </div>
      </form>

      {pairing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closePairing}>
          <div className="w-full max-w-xs space-y-3 rounded-xl bg-white p-5 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-semibold text-gray-800">📱 Mit Handy scannen</h2>
            <p className="text-xs text-gray-500">
              QR-Code mit der Handy-Kamera scannen — jedes dort aufgenommene Foto erscheint hier
              automatisch als neue Seite.{pairing.key && ' Übertragung ist verschlüsselt.'}
            </p>
            {/* Eigenes, im Browser erzeugtes SVG (kein Nutzereingabe-HTML) — dangerouslySetInnerHTML hier unbedenklich. */}
            <div
              className="mx-auto w-fit rounded-lg border border-[var(--line)] p-2"
              dangerouslySetInnerHTML={{ __html: pairing.qrSvg }}
            />
            <p className="text-sm font-medium text-[var(--accent)]">
              {pairing.photoCount > 0
                ? `✓ ${pairing.photoCount} Foto${pairing.photoCount === 1 ? '' : 's'} empfangen`
                : 'Warte auf erstes Foto …'}
            </p>
            <button type="button" className="btn-primary w-full" onClick={closePairing}>Fertig</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', required, warn,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; warn?: boolean
}) {
  return (
    <div>
      <label className="dp-label">
        {label}
        {warn && <span className="ml-1 text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>}
      </label>
      <input
        className={`dp-input mt-1 ${warn ? 'border-[var(--warn-border)] bg-[var(--warn-bg)]' : ''}`}
        type={type} value={value} required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
