'use client'

import { useDecryptedContent } from './useDecryptedContent'

export function InvoiceNumberCell({
  contentEnc,
  fallbackInvoiceNumber,
}: {
  contentEnc: string | null
  fallbackInvoiceNumber: string | null
}) {
  const { data, locked } = useDecryptedContent(contentEnc)
  if (!contentEnc) return <>{fallbackInvoiceNumber ?? '—'}</>
  if (locked) return <span title="Passphrase eingeben, um Inhalte anzuzeigen">🔒</span>
  return <>{data?.invoiceNumber ?? '—'}</>
}
