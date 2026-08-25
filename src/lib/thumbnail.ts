// Mini-Vorschau für die Rechnungsliste (Stefan 2026-08-25): sehr kleine
// Bild-Miniatur eines Belegs (PDF erste Seite bei niedrigem Maßstab, oder
// verkleinertes Foto/Scan) — nur zur groben Kurzeinschätzung "was ist das
// für ein Beleg", kein Ersatz für die volle Vorschau auf der Detailseite.
export async function resizeImageToThumbnail(buffer: Buffer, targetWidth: number): Promise<Buffer | null> {
  try {
    const { loadImage, createCanvas } = await import('@napi-rs/canvas')
    const img = await loadImage(buffer)
    const scale = targetWidth / img.width
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = createCanvas(targetWidth, h)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, targetWidth, h)
    return canvas.toBuffer('image/png')
  } catch (e) {
    console.error('Bild-Miniatur fehlgeschlagen:', e instanceof Error ? e.message : e)
    return null
  }
}
