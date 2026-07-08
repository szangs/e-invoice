'use client'

import { formatAmount } from '@/lib/invoices'
import { useDecryptedContent } from './useDecryptedContent'

export function InvoiceAmountCell({
  contentEnc,
  field,
  fallbackAmount,
  fallbackCurrency,
}: {
  contentEnc: string | null
  field: 'amountNet' | 'amountGross'
  fallbackAmount: number | null
  fallbackCurrency: string
}) {
  const { data, locked } = useDecryptedContent(contentEnc)
  if (!contentEnc) return <>{formatAmount(fallbackAmount, fallbackCurrency)}</>
  if (locked) return <span title="Passphrase eingeben, um Beträge anzuzeigen">🔒</span>
  const raw = data?.[field]
  const n = raw ? Number(String(raw).replace(/\./g, '').replace(',', '.')) : null
  const currency = data?.currency || fallbackCurrency
  return <>{formatAmount(n !== null && Number.isFinite(n) ? n : null, currency)}</>
}
