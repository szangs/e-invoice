'use client'

// Inhalts-Verschlüsselung (Stefan 2026-07-09): kleiner Hook, den alle
// Anzeige-Komponenten für verschlüsselte Rechnungsfelder (Lieferant, Nummer,
// Beträge, Währung, Tags, Notizen) gemeinsam nutzen — entschlüsselt EINMAL
// pro Aufruf mit dem im Browser zwischengespeicherten Schlüssel (DEK), ohne
// dass der Server je den Klartext sieht. Reagiert auf das "einvoice:dek-
// unlocked"-Event (siehe EncryptionUnlockBanner.tsx), damit nach einmaliger
// Passphrase-Eingabe alle Zellen auf der Seite ohne Neuladen aufgehen.
import { useEffect, useState } from 'react'
import { decryptJson } from '@/lib/clientCrypto'
import { getCachedDek } from '@/lib/keyStore'

export type InvoiceContentFields = {
  vendor?: string | null
  invoiceNumber?: string | null
  amountNet?: string | null
  amountTax?: string | null
  amountGross?: string | null
  currency?: string | null
  tags?: string | null
  notes?: string | null
}

export const DEK_UNLOCKED_EVENT = 'einvoice:dek-unlocked'

/** Löst das Event aus, auf das alle offenen Anzeige-Zellen dieser Seite warten. */
export function notifyDekUnlocked(): void {
  window.dispatchEvent(new Event(DEK_UNLOCKED_EVENT))
}

/**
 * @param contentEnc Chiffrat aus Invoice.contentEnc, oder null bei einer
 *   unverschlüsselten Rechnung (dann bleibt data=null, locked=false — der
 *   Aufrufer zeigt in dem Fall einfach den Klartext-Fallback aus der DB).
 */
export function useDecryptedContent(contentEnc: string | null | undefined): {
  data: InvoiceContentFields | null
  locked: boolean
} {
  const [data, setData] = useState<InvoiceContentFields | null>(null)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    let stop = false
    if (!contentEnc) return
    async function run() {
      const dek = await getCachedDek()
      if (!dek) {
        if (!stop) setLocked(true)
        return
      }
      try {
        const decrypted = await decryptJson<InvoiceContentFields>(dek, contentEnc as string)
        if (!stop) {
          setData(decrypted)
          setLocked(false)
        }
      } catch {
        if (!stop) setLocked(true)
      }
    }
    run()
    window.addEventListener(DEK_UNLOCKED_EVENT, run)
    return () => {
      stop = true
      window.removeEventListener(DEK_UNLOCKED_EVENT, run)
    }
  }, [contentEnc])

  return { data, locked }
}
