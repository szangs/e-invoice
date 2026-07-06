'use client'

// Beobachtet den Sitzungszustand (§10): Zwangsabmeldung mit klarem Hinweis,
// zeigt außerdem den Service-Status-Text (§9) dezent an.
import { signOut } from 'next-auth/react'
import { useEffect, useState } from 'react'

const POLL_MS = 20_000

export function SessionWatcher({ impersonating }: { impersonating: boolean }) {
  const [statusText, setStatusText] = useState('')
  const [forced, setForced] = useState(false)

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const res = await fetch('/api/session/state', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (stop) return
        setStatusText(data.statusText ?? '')
        if (data.forcedLogout) setForced(true)
      } catch {
        /* Netzfehler ignorieren — nächster Poll versucht es erneut */
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

  return (
    <>
      {statusText && (
        <div className="border-b border-[var(--warn-border)] bg-[var(--warn-bg)] px-6 py-1.5 text-xs text-[var(--warn-strong)] print:hidden">
          {statusText}
        </div>
      )}
      {impersonating && (
        <EndImpersonationBar />
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
