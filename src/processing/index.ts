import sharp from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'

/**
 * Generates a base64-encoded ThumbHash from any image buffer.
 * Used by the beforeChange hook (single-format mode) and convertFormats task
 * (multi-format mode) to produce blur placeholders.
 */
export async function generateThumbHash(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer)
    .resize(100, 100, { fit: 'inside' })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true })

  const thumbHash = rgbaToThumbHash(info.width, info.height, data)
  return Buffer.from(thumbHash).toString('base64')
}

/**
 * Converts an image buffer to a target format. Used by the additive
 * convertFormats task to produce variants beyond the primary format that
 * Payload already produced natively (e.g. AVIF alongside the WebP primary).
 */
export async function convertFormat(
  buffer: Buffer,
  format: 'webp' | 'avif',
  quality: number,
): Promise<{ buffer: Buffer; width: number; height: number; size: number; mimeType: string }> {
  const { data, info } = await sharp(buffer)
    .toFormat(format, { quality })
    .toBuffer({ resolveWithObject: true })

  const mimeType = format === 'webp' ? 'image/webp' : 'image/avif'

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    size: info.size,
    mimeType,
  }
}
