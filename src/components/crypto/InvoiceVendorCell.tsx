'use client'

// Inhalts-Verschlüsselung (Stefan 2026-07-09): Lieferant + Tags einer
// Rechnungszeile — bei contentEnc wird client-seitig entschlüsselt, sonst
// wird einfach der (unverschlüsselte) Klartext aus der DB gezeigt. Die
// Badges (Nachricht/Freigabe/Dublette) hängen nicht vom Inhalt ab und kommen
// unverändert vom Server.
import Link from 'next/link'
import { useDecryptedContent } from './useDecryptedContent'

export function InvoiceVendorCell({
  invoiceId,
  contentEnc,
  fallbackVendor,
  fallbackTags,
  hasUnreadNote,
  pendingApprovalTitle,
  isDuplicate,
}: {
  invoiceId: string
  contentEnc: string | null
  fallbackVendor: string
  fallbackTags: string | null
  hasUnreadNote: boolean
  pendingApprovalTitle: string | null
  isDuplicate: boolean
}) {
  const { data, locked } = useDecryptedContent(contentEnc)
  const vendor = contentEnc ? (data?.vendor ?? (locked ? '🔒 gesperrt' : fallbackVendor)) : fallbackVendor
  const tags = contentEnc ? data?.tags ?? null : fallbackTags

  return (
    <>
      <Link className="font-medium text-[var(--accent)] hover:underline" href={`/invoices/${invoiceId}`}>
        {vendor}
      </Link>
      {hasUnreadNote && (
        <span className="ml-1.5" title="Ungelesene Nachricht an Sie — Rechnung öffnen zum Lesen">💬</span>
      )}
      {pendingApprovalTitle && (
        <span
          className="ml-1.5 rounded-full bg-[var(--warn-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn-strong)]"
          title={pendingApprovalTitle}
        >
          ⏳ Freigabe ausstehend
        </span>
      )}
      {isDuplicate && (
        <span className="ml-1.5 rounded-full bg-[var(--warn-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn-strong)]">
          Dublette
        </span>
      )}
      {tags && <p className="text-[10px] text-gray-400">{tags}</p>}
    </>
  )
}
