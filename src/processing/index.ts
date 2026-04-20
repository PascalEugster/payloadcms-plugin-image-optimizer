import sharp from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'

/**
 * Generates a base64-encoded ThumbHash from any image buffer.
 * Used by the beforeChange hook to produce blur placeholders.
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
