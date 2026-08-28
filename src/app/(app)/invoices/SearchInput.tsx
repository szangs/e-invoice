'use client'

// Such-Eingabefeld mit Blind-Index-Unterstützung (Stefan 2026-08-27, "eine
// Volltextsuche kann ich mit der Verschlüsselung vergessen oder?") — bei
// unverschlüsselten Mandanten ein ganz normales Formularfeld (Server macht
// eine echte Volltextsuche, siehe invoices/page.tsx getFullTextMatchIds).
// Bei verschlüsselten Mandanten fängt dieses Feld das Absenden des
// umgebenden Formulars ab: berechnet aus dem Suchtext lokal die Hashes
// (lib/clientCrypto.ts computeSearchTokens, braucht den entsperrten DEK) und
// hängt sie als verstecktes Feld "token" an, bevor es das Formular ganz
// normal (nativ, kein React-Umweg) absendet — der Server sieht dadurch nie
// den Klartext-Suchbegriff, nur den fertigen Hash (siehe getBlindIndexMatchIds).
import { useEffect, useRef } from 'react'
import { computeSearchTokens, deriveSearchKey } from '@/lib/clientCrypto'
import { getCachedDekRaw } from '@/lib/keyStore'

export function SearchInput({ q, encryptionEnabled }: { q: string; encryptionEnabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const tokenRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!encryptionEnabled) return
    const form = inputRef.current?.form
    if (!form) return

    function handleSubmit(e: SubmitEvent) {
      const text = inputRef.current?.value ?? ''
      if (!text.trim()) {
        // Leere Suche: Token-Feld leeren, ganz normal (nativ) absenden.
        if (tokenRef.current) tokenRef.current.value = ''
        return
      }
      const dekRaw = getCachedDekRaw()
      if (!dekRaw) return // Passphrase noch nicht eingegeben — nativ absenden, wirkt einfach (noch) nicht.
      e.preventDefault()
      deriveSearchKey(dekRaw)
        .then((key) => computeSearchTokens(key, text))
        .then((tokens) => {
          if (tokenRef.current) tokenRef.current.value = tokens.join(',')
          // form.submit() löst KEIN erneutes "submit"-Ereignis aus (natives
          // Browser-Verhalten) — kein Risiko einer Endlosschleife hier.
          form!.submit()
        })
    }

    form.addEventListener('submit', handleSubmit)
    return () => form.removeEventListener('submit', handleSubmit)
  }, [encryptionEnabled])

  return (
    <>
      <input ref={inputRef} id="q" name="q" className="dp-input mt-1" defaultValue={q}
        title="Durchsucht Lieferant, Rechnungsnummer, Tags und Notizen gleichzeitig" />
      <input ref={tokenRef} type="hidden" name="token" />
    </>
  )
}
