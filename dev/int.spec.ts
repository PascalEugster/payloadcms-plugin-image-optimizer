import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import path from 'path'
import fs from 'fs/promises'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

let payload: Payload

// Generate a test JPEG with EXIF-like data
async function createTestImage(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 128, b: 64 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer()
}

afterAll(async () => {
  if (typeof payload.db?.destroy === 'function') {
    await payload.db.destroy()
  }
})

beforeAll(async () => {
  payload = await getPayload({ config })
  // Ensure media directory exists
  const mediaDir = path.resolve(dirname, 'media')
  await fs.mkdir(mediaDir, { recursive: true })
})

describe('Image Optimizer Plugin', () => {
  test('should add imageOptimizer fields to configured upload collection', () => {
    const mediaConfig = payload.collections['media'].config
    const fields = mediaConfig.fields as any[]
    const imageOptimizerField = fields.find((f: any) => f.name === 'imageOptimizer')

    expect(imageOptimizerField).toBeDefined()
    expect(imageOptimizerField.type).toBe('group')
  })

  test('should not add imageOptimizer fields to non-configured collections', () => {
    const postsConfig = payload.collections['posts'].config
    const fields = postsConfig.fields as any[]
    const imageOptimizerField = fields.find((f: any) => f.name === 'imageOptimizer')

    expect(imageOptimizerField).toBeUndefined()
  })

  test('should strip metadata and resize on upload', async () => {
    const buffer = await createTestImage(4000, 3000)

    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-large.jpg',
        size: buffer.length,
      },
    })

    expect(doc.imageOptimizer).toBeDefined()
    expect(doc.imageOptimizer.originalSize).toBeGreaterThan(0)
    expect(doc.imageOptimizer.optimizedSize).toBeGreaterThan(0)
    expect(doc.imageOptimizer.status).toBe('pending')

    // Verify the saved file was resized within max dimensions
    const savedPath = path.resolve(dirname, 'media', doc.filename as string)
    const metadata = await sharp(savedPath).metadata()
    expect(metadata.width).toBeLessThanOrEqual(2560)
    expect(metadata.height).toBeLessThanOrEqual(2560)
  })

  test('should generate blur placeholder as valid base64 data URI', async () => {
    const buffer = await createTestImage(400, 300)

    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-blur.jpg',
        size: buffer.length,
      },
    })

    expect(doc.imageOptimizer.blurDataURL).toBeDefined()
    expect(doc.imageOptimizer.blurDataURL).toMatch(/^data:image\/png;base64,/)

    // Verify it decodes to a valid image
    const base64 = doc.imageOptimizer.blurDataURL.replace('data:image/png;base64,', '')
    const blurBuffer = Buffer.from(base64, 'base64')
    const blurMeta = await sharp(blurBuffer).metadata()
    expect(blurMeta.width).toBe(16)
  })

  test('should generate format variants via async job', async () => {
    const buffer = await createTestImage(400, 300)

    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-variants.jpg',
        size: buffer.length,
      },
    })

    // Wait for the async job to process
    await payload.jobs.run()

    // Give a moment for the update to complete
    await new Promise((resolve) => setTimeout(resolve, 500))

    const updatedDoc = await payload.findByID({
      collection: 'media',
      id: doc.id,
    })

    expect(updatedDoc.imageOptimizer.status).toBe('complete')
    expect(updatedDoc.imageOptimizer.variants).toHaveLength(2)

    const webpVariant = updatedDoc.imageOptimizer.variants.find(
      (v: any) => v.format === 'webp',
    )
    const avifVariant = updatedDoc.imageOptimizer.variants.find(
      (v: any) => v.format === 'avif',
    )

    expect(webpVariant).toBeDefined()
    expect(webpVariant.mimeType).toBe('image/webp')
    expect(webpVariant.filesize).toBeGreaterThan(0)

    expect(avifVariant).toBeDefined()
    expect(avifVariant.mimeType).toBe('image/avif')
    expect(avifVariant.filesize).toBeGreaterThan(0)

    // Verify variant files exist on disk
    const mediaDir = path.resolve(dirname, 'media')
    const webpExists = await fs.access(path.join(mediaDir, webpVariant.filename)).then(() => true).catch(() => false)
    const avifExists = await fs.access(path.join(mediaDir, avifVariant.filename)).then(() => true).catch(() => false)

    expect(webpExists).toBe(true)
    expect(avifExists).toBe(true)
  })

  test('should not process non-image uploads', async () => {
    const textBuffer = Buffer.from('Hello, this is a text file.')

    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: textBuffer,
        mimetype: 'text/plain',
        name: 'test.txt',
        size: textBuffer.length,
      },
    })

    expect(doc.imageOptimizer?.status).toBeUndefined()
  })
})
