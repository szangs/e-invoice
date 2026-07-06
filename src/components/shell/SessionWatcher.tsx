'use client'

// Beobachtet den Sitzungszustand: Zwangsabmeldung (§10), Service-Status-Text (§9)
// und Fernwartung §14A (Einwilligungs-Dialog, sichtbares Banner, DOM-Spiegel mit
// Maskierung, jederzeit beendbar).
import { signOut } from 'next-auth/react'
import { useEffect, useRef, useState } from 'react'

const POLL_MS = 15_000
const SNAPSHOT_MS = 4_000

export function SessionWatcher({ impersonating }: { impersonating: boolean }) {
  const [statusText, setStatusText] = useState('')
  const [forced, setForced] = useState(false)
  const [supportRequestId, setSupportRequestId] = useState<string | null>(null)
  const [supportActiveId, setSupportActiveId] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)
  activeRef.current = supportActiveId

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const res = await fetch('/api/session/state', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (stop) return
        setStatusText(data.statusText ?? '')
        setSupportRequestId(data.supportRequestId ?? null)
        setSupportActiveId(data.supportActiveId ?? null)
        if (data.forcedLogout) setForced(true)
      } catch {
        /* nächster Poll versucht es erneut */
      }
    }
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    if (forced) {
      const t = setTimeout(() => signOut({ callbackUrl: '/auth/login' }), 3500)
      return () => clearTimeout(t)
    }
  }, [forced])

  // ── DOM-Spiegel während aktiver Fernwartung (§14A) ──
  useEffect(() => {
    if (!supportActiveId) return
    let stop = false
    async function capture() {
      const id = activeRef.current
      if (stop || !id) return
      try {
        const root = document.documentElement.cloneNode(true) as HTMLElement
        // Skripte entfernen; Eingaben maskieren (sensible Daten schwärzen, §14A)
        root.querySelectorAll('script, noscript').forEach((el) => el.remove())
        root.querySelectorAll('input').forEach((el) => {
          el.setAttribute('value', el.getAttribute('type') === 'checkbox' ? '' : '•••••')
        })
        root.querySelectorAll('textarea').forEach((el) => {
          el.textContent = '•••••'
        })
        const res = await fetch(`/api/support/${id}/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: '<!doctype html>' + root.outerHTML }),
        })
        const data = await res.json().catch(() => ({}))
        if (data.ended) setSupportActiveId(null)
      } catch {
        /* nächster Versuch */
      }
    }
    capture()
    const t = setInterval(capture, SNAPSHOT_MS)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [supportActiveId])

  async function supportAction(id: string, action: 'accept' | 'decline' | 'end') {
    await fetch(`/api/support/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (action === 'accept') {
      setSupportActiveId(id)
      setSupportRequestId(null)
    } else {
      setSupportRequestId(null)
      if (action === 'end') setSupportActiveId(null)
    }
  }

  return (
    <>
      {statusText && (
        <div className="border-b border-[var(--warn-border)] bg-[var(--warn-bg)] px-6 py-1.5 text-xs text-[var(--warn-strong)] print:hidden">
          {statusText}
        </div>
      )}
      {impersonating && <EndImpersonationBar />}

      {/* Sichtbarer Hinweis-Banner während der GESAMTEN Fernwartungs-Sitzung (§14A) */}
      {supportActiveId && (
        <div className="flex items-center justify-between border-b-2 border-[var(--danger)] bg-red-50 px-6 py-2 print:hidden">
          <p className="text-xs font-semibold text-[var(--danger)]">
            ● Fernwartung aktiv — Ihr Bildschirm wird für den Support gespiegelt. Eingaben sind maskiert.
          </p>
          <button
            onClick={() => supportAction(supportActiveId, 'end')}
            className="text-xs font-bold text-[var(--danger)] underline"
          >
            Sitzung beenden
          </button>
        </div>
      )}

      {/* Einwilligungs-Dialog bei Betreiber-Anfrage (§14A) */}
      {supportRequestId && !supportActiveId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="dp-card max-w-md">
            <p className="text-sm font-semibold text-gray-900">Fernwartungs-Anfrage des Supports</p>
            <p className="mt-2 text-xs text-gray-600">
              Der Betreiber bittet darum, Ihre Bildschirmansicht zur Unterstützung zu sehen.
              Ihre Eingaben werden dabei maskiert. Sie können die Sitzung jederzeit beenden.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn-primary" onClick={() => supportAction(supportRequestId, 'accept')}>
                Einwilligen & starten
              </button>
              <button className="btn-secondary" onClick={() => supportAction(supportRequestId, 'decline')}>
                Ablehnen
              </button>
            </div>
          </div>
        </div>
      )}

      {forced && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
          <div className="dp-card max-w-sm text-center">
            <p className="text-sm font-semibold text-gray-900">
              Sitzung wird durch den Administrator beendet
            </p>
            <p className="mt-2 text-xs text-gray-500">Sie werden automatisch abgemeldet …</p>
          </div>
        </div>
      )}
    </>
  )
}

function EndImpersonationBar() {
  const [busy, setBusy] = useState(false)
  async function end() {
    setBusy(true)
    const res = await fetch('/api/platform/impersonation/end', { method: 'POST' })
    if (res.ok) {
      const { ticket } = await res.json()
      const { signIn } = await import('next-auth/react')
      await signIn('credentials', { ticket, redirect: false })
      window.location.href = '/platform'
    } else {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center justify-between border-b border-[var(--warn-border)] bg-[var(--warn-bg)] px-6 py-1.5 print:hidden">
      <p className="text-xs font-medium text-[var(--warn-strong)]">
        Identitätsübernahme aktiv — Sie sehen die Sicht des Mandanten.
      </p>
      <button onClick={end} disabled={busy} className="text-xs font-semibold text-[var(--warn-strong)] underline">
        {busy ? 'Beende …' : 'Übernahme beenden'}
      </button>
    </div>
  )
}
