import sharp from 'sharp'

export async function stripAndResize(
  buffer: Buffer,
  maxDimensions: { width: number; height: number },
  stripMetadata: boolean,
): Promise<{ buffer: Buffer; width: number; height: number; size: number }> {
  let pipeline = sharp(buffer)
    .rotate()
    .resize(maxDimensions.width, maxDimensions.height, {
      fit: 'inside',
      withoutEnlargement: true,
    })

  if (!stripMetadata) {
    pipeline = pipeline.keepMetadata()
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    size: info.size,
  }
}

export async function generateBlurDataURL(buffer: Buffer): Promise<string> {
  const blurBuffer = await sharp(buffer)
    .resize(16)
    .blur()
    .png({ compressionLevel: 9 })
    .toBuffer()

  return `data:image/png;base64,${blurBuffer.toString('base64')}`
}

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
