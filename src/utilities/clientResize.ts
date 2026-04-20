/**
 * Browser-side image resize used by `UploadOptimizer`. Runs on the main
 * thread via Canvas 2D + `createImageBitmap` + `canvas.toBlob`. Every
 * failure path falls back to the original `File` — we must never return
 * a `null`/empty `File` or the Payload admin will submit a multipart body
 * with an empty `file` part and the server will reject the upload with
 * `MissingFile` (400).
 *
 * Exported for unit testing — `UploadOptimizer` re-exports nothing, the
 * component imports this directly.
 */

const DEFAULT_MAX_WIDTH = 2560
const DEFAULT_MAX_HEIGHT = 2560
const DEFAULT_JPEG_QUALITY = 0.85

const RESIZABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
])

export type ResizeOptions = {
  maxWidth?: number
  maxHeight?: number
  jpegQuality?: number
}

/**
 * Sparse scan of the canvas to detect any transparent pixel. We sample the
 * alpha byte of every 8th pixel — ~1.5% of a 2048-wide image — which is
 * enough to catch any non-trivial alpha region. Cheaper than reading the
 * full buffer, but still correct for real-world images with transparency.
 *
 * If `getImageData` throws (tainted canvas, cross-origin), we bail to the
 * safe default and assume alpha is present — PNG preserves fidelity even
 * if the source was opaque, whereas JPEG would silently flatten it.
 */
function hasAlpha(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  try {
    const img = ctx.getImageData(0, 0, width, height)
    const { data } = img
    // data is RGBA quads; stride 4 * 8 = 32 to skip 8 pixels at a time.
    for (let i = 3; i < data.length; i += 32) {
      if (data[i]! < 255) return true
    }
    return false
  } catch {
    return true
  }
}

export async function resizeImage(
  file: File,
  options: ResizeOptions = {},
): Promise<File> {
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT
  const jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY

  if (!RESIZABLE_TYPES.has(file.type)) return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Decode failure (corrupt image, unsupported subtype, OOM on very
    // large images) — fall back to the original file.
    return file
  }

  const { width, height } = bitmap

  if (width <= maxWidth && height <= maxHeight) {
    bitmap.close()
    return file
  }

  const ratio = Math.min(maxWidth / width, maxHeight / height)
  const targetWidth = Math.round(width * ratio)
  const targetHeight = Math.round(height * ratio)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()

  // Pick output format based on whether the source can carry alpha AND
  // actually uses it. JPEG cannot encode transparency, so any image with
  // alpha < 255 pixels would be silently composited over black/white and
  // data would be lost. For formats that cannot carry alpha (JPEG), skip
  // the scan entirely — it's always opaque.
  const sourceCouldHaveAlpha =
    file.type === 'image/png' ||
    file.type === 'image/webp' ||
    file.type === 'image/bmp' ||
    file.type === 'image/tiff'
  const sourceHasAlpha = sourceCouldHaveAlpha
    ? hasAlpha(ctx, targetWidth, targetHeight)
    : false

  const outputType = sourceHasAlpha ? 'image/png' : 'image/jpeg'
  const quality = outputType === 'image/jpeg' ? jpegQuality : undefined
  const ext = outputType === 'image/png' ? 'png' : 'jpg'

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), outputType, quality)
  })

  // canvas.toBlob resolves null under memory pressure or security
  // restrictions (iOS Safari in some contexts). Return the original so we
  // never produce a File backed by garbage data.
  if (!blob || blob.size === 0) return file

  const baseName = file.name.replace(/\.[^.]+$/, '')
  return new File([blob], `${baseName}.${ext}`, {
    type: outputType,
    lastModified: Date.now(),
  })
}
