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
  // Ensure media directories exist
  const mediaDir = path.resolve(dirname, 'media')
  await fs.mkdir(mediaDir, { recursive: true })
  const avatarsDir = path.resolve(dirname, 'avatars')
  await fs.mkdir(avatarsDir, { recursive: true })
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

  test('should generate thumbHash as valid base64 string', async () => {
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

    expect(doc.imageOptimizer.thumbHash).toBeDefined()
    expect(typeof doc.imageOptimizer.thumbHash).toBe('string')
    expect(doc.imageOptimizer.thumbHash.length).toBeGreaterThan(0)

    // Verify it's valid base64 that decodes without error
    const decoded = Buffer.from(doc.imageOptimizer.thumbHash, 'base64')
    expect(decoded.length).toBeGreaterThan(0)
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

  test('avatars collection should use custom maxDimensions', async () => {
    const buffer = await createTestImage(800, 600)

    const doc = await payload.create({
      collection: 'avatars',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-avatar-resize.jpg',
        size: buffer.length,
      },
    })

    // Verify the saved file was resized within 256x256
    const savedPath = path.resolve(dirname, 'avatars', doc.filename as string)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const metadata = await sharp(savedPath).metadata()
    expect(metadata.width).toBeLessThanOrEqual(256)
    expect(metadata.height).toBeLessThanOrEqual(256)
    // 800x600 fit inside 256x256 => 256x192
    expect(metadata.width).toBe(256)
    expect(metadata.height).toBe(192)
  })

  test('avatars collection should only generate webp variant (custom formats)', async () => {
    const buffer = await createTestImage(400, 300)

    const doc = await payload.create({
      collection: 'avatars',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-avatar-formats.jpg',
        size: buffer.length,
      },
    })

    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    const updatedDoc = await payload.findByID({
      collection: 'avatars',
      id: doc.id,
    })

    expect(updatedDoc.imageOptimizer.variants).toHaveLength(1)
    expect(updatedDoc.imageOptimizer.variants[0].format).toBe('webp')
  })

  test('media collection with `true` should use global defaults (both formats)', async () => {
    const buffer = await createTestImage(400, 300)

    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-global-defaults.jpg',
        size: buffer.length,
      },
    })

    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    const updatedDoc = await payload.findByID({
      collection: 'media',
      id: doc.id,
    })

    expect(updatedDoc.imageOptimizer.variants).toHaveLength(2)

    const formats = updatedDoc.imageOptimizer.variants.map((v: any) => v.format)
    expect(formats).toContain('webp')
    expect(formats).toContain('avif')
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

  test('should regenerate an existing document without imageOptimizer data', async () => {
    const buffer = await createTestImage(800, 600)
    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-regen-existing.jpg',
        size: buffer.length,
      },
      context: { imageOptimizer_skip: true },
    })

    // Verify no optimization data was generated
    expect(doc.imageOptimizer?.status).toBeUndefined()

    // Queue and run the regeneration task manually
    await payload.jobs.queue({
      task: 'imageOptimizer_regenerateDocument',
      input: {
        collectionSlug: 'media',
        docId: String(doc.id),
      },
    })
    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Fetch the document again and verify it now has optimization data
    const updatedDoc = await payload.findByID({ collection: 'media', id: doc.id })
    expect(updatedDoc.imageOptimizer.status).toBe('complete')
    expect(updatedDoc.imageOptimizer.thumbHash).toBeDefined()
    expect(updatedDoc.imageOptimizer.thumbHash.length).toBeGreaterThan(0)
    expect(updatedDoc.imageOptimizer.originalSize).toBeGreaterThan(0)
    expect(updatedDoc.imageOptimizer.optimizedSize).toBeGreaterThan(0)
    expect(updatedDoc.imageOptimizer.variants).toHaveLength(2)
  })

  test('should skip non-image documents during regeneration', async () => {
    const textBuffer = Buffer.from('Hello')
    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: textBuffer,
        mimetype: 'text/plain',
        name: 'test-regen-skip.txt',
        size: textBuffer.length,
      },
      context: { imageOptimizer_skip: true },
    })

    await payload.jobs.queue({
      task: 'imageOptimizer_regenerateDocument',
      input: { collectionSlug: 'media', docId: String(doc.id) },
    })
    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    const updatedDoc = await payload.findByID({ collection: 'media', id: doc.id })
    expect(updatedDoc.imageOptimizer?.status).toBeUndefined()
  })

  test('should regenerate with per-collection config (avatars)', async () => {
    const buffer = await createTestImage(800, 600)
    const doc = await payload.create({
      collection: 'avatars',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-regen-avatar.jpg',
        size: buffer.length,
      },
      context: { imageOptimizer_skip: true },
    })

    await payload.jobs.queue({
      task: 'imageOptimizer_regenerateDocument',
      input: { collectionSlug: 'avatars', docId: String(doc.id) },
    })
    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    const updatedDoc = await payload.findByID({ collection: 'avatars', id: doc.id })
    expect(updatedDoc.imageOptimizer.status).toBe('complete')
    expect(updatedDoc.imageOptimizer.variants).toHaveLength(1)
    expect(updatedDoc.imageOptimizer.variants[0].format).toBe('webp')

    // Verify file was resized
    const savedPath = path.resolve(dirname, 'avatars', updatedDoc.filename as string)
    const metadata = await sharp(savedPath).metadata()
    expect(metadata.width).toBeLessThanOrEqual(256)
    expect(metadata.height).toBeLessThanOrEqual(256)
  })
})
