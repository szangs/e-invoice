// Dateiablage für Rechnungsbelege — mandantengetrennt unter uploads/{tenantId}/
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'

const ROOT = path.join(process.cwd(), 'uploads')

export const ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  // E-Rechnung: XRechnung kommt als reines XML
  'application/xml',
  'text/xml',
]
export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

export async function saveInvoiceFile(
  tenantId: string,
  originalName: string,
  buffer: Buffer,
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin'
  const fileName = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`
  const dir = path.join(ROOT, tenantId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, fileName), buffer)
  return fileName
}

export async function readInvoiceFile(tenantId: string, fileName: string): Promise<Buffer> {
  // Pfad-Traversal ausschließen
  const safe = path.basename(fileName)
  return readFile(path.join(ROOT, tenantId, safe))
}

export async function deleteInvoiceFile(tenantId: string, fileName: string): Promise<void> {
  const safe = path.basename(fileName)
  await unlink(path.join(ROOT, tenantId, safe)).catch(() => undefined)
}
