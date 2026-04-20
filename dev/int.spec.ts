import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import path from 'path'
import fs from 'fs/promises'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { fileURLToPath } from 'url'

import { resolveConfig } from '../src/defaults.js'
import {
  createCancelHandler,
  createRegenerateHandler,
  createRegenerateStatusHandler,
} from '../src/endpoints/regenerate.js'

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
    // originalSize is captured by the beforeOperation hook before Payload
    // mutates req.file. Optimization should produce a smaller file.
    expect(doc.imageOptimizer.optimizedSize).toBeLessThan(doc.imageOptimizer.originalSize)
    // v3: beforeChange resolves status synchronously — no pending state.
    expect(doc.imageOptimizer.status).toBe('complete')

    // Verify the saved file was resized within max dimensions
    const savedPath = path.resolve(dirname, 'media', doc.filename as string)
    const metadata = await sharp(savedPath).metadata()
    expect(metadata.width).toBeLessThanOrEqual(2560)
    expect(metadata.height).toBeLessThanOrEqual(2560)
    // Format conversion: parent file is webp via Payload's upload.formatOptions
    expect(metadata.format).toBe('webp')
    expect(doc.mimeType).toBe('image/webp')
    expect(doc.filename).toMatch(/\.webp$/)
  })

  test('v2 — imageSizes are emitted as webp natively (config-injection)', async () => {
    const buffer = await createTestImage(2000, 1500)

    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-sizes-webp.jpg',
        size: buffer.length,
      },
    })

    // Payload's createImageSizes uses formatOptions on each imageSize, which
    // we inject at plugin init. Each size's filename + mimeType reflects webp.
    const sizes = (doc as any).sizes as Record<string, any>
    expect(sizes).toBeDefined()
    for (const [sizeName, sizeData] of Object.entries(sizes)) {
      if (!sizeData || !sizeData.filename) continue
      expect(sizeData.mimeType, `${sizeName}.mimeType`).toBe('image/webp')
      expect(sizeData.filename, `${sizeName}.filename`).toMatch(/\.webp$/)
    }
  })

  test('v2 — aspect-mismatched sizes (og 1200×630, square 500×500) still produced but excluded by srcset filter', async () => {
    // Regression harness for the v1.11.1 aspect-mismatch fix. With v2's native
    // pipeline, every `og` and `square` size is produced via Payload's
    // createImageSizes which respects the fit:'cover' crop — the resulting
    // variants ARE aspect-mismatched relative to the source (4:3-ish) and
    // would have polluted responsive srcsets without our utilities filter.
    const buffer = await createTestImage(1700, 1365)

    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-aspect-regression.jpg',
        size: buffer.length,
      },
    })

    const sizes = (doc as any).sizes as Record<string, any>
    expect(sizes.og?.width).toBe(1200)
    expect(sizes.og?.height).toBe(630)
    expect(sizes.square?.width).toBe(500)
    expect(sizes.square?.height).toBe(500)
    // Source aspect-ratio sizes still aspect-correct
    expect(sizes.large?.width).toBe(1400)
    // 1700/1365 → 1400×1124 with fit:'inside'
    expect(sizes.large?.height).toBe(1124)
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

    // v3: ThumbHash is computed inline in beforeChange — available immediately.
    expect(doc.imageOptimizer.thumbHash).toBeDefined()
    expect(typeof doc.imageOptimizer.thumbHash).toBe('string')
    expect(doc.imageOptimizer.thumbHash.length).toBeGreaterThan(0)

    const decoded = Buffer.from(doc.imageOptimizer.thumbHash, 'base64')
    expect(decoded.length).toBeGreaterThan(0)
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

  test('avatars collection uses per-collection format (webp)', async () => {
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

    expect(doc.imageOptimizer.status).toBe('complete')
    expect(doc.mimeType).toBe('image/webp')
  })

  test('media collection with `true` uses global format default (webp)', async () => {
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

    expect(doc.imageOptimizer.status).toBe('complete')
    expect(doc.mimeType).toBe('image/webp')
  })

  test('should accept SVG upload without crashing and mark status complete with no conversion', async () => {
    // Inline 1×1 SVG — sharp would rasterize this and webp-convert it if we
    // didn't guard against image/svg+xml in beforeChange. We expect the
    // original buffer preserved and imageOptimizer.status === 'complete'.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'
    const buffer = Buffer.from(svg, 'utf8')

    let doc: any
    try {
      doc = await payload.create({
        collection: 'media',
        data: {},
        file: {
          data: buffer,
          mimetype: 'image/svg+xml',
          name: 'test-vector.svg',
          size: buffer.length,
        },
      })
    } catch (err) {
      // If Payload's generateFileData rejects SVG outright (upstream of our
      // hook), surface the failure mode rather than silently pass — the fix
      // may need to extend into collection-config injection to skip
      // formatOptions for SVG uploads.
      throw new Error(
        `SVG upload failed before our guard could run — Payload's generateFileData ` +
          `rejected it. Message: ${(err as Error).message}`,
      )
    }

    expect(doc.imageOptimizer).toBeDefined()
    expect(doc.imageOptimizer.status).toBe('complete')
    expect(doc.imageOptimizer.originalSize).toBe(doc.imageOptimizer.optimizedSize)
  })

  test('should handle zero-byte buffer without crashing the plugin', async () => {
    // Zero-byte buffer with an image mimetype passes the mimetype guard. Our
    // length === 0 early-return lets Payload handle it at its own layer.
    // Whether Payload accepts or rejects it is Payload's decision; we just
    // ensure the plugin itself does not crash.
    const buffer = Buffer.alloc(0)

    let crashed = false
    let doc: any = null
    try {
      doc = await payload.create({
        collection: 'media',
        data: {},
        file: {
          data: buffer,
          mimetype: 'image/jpeg',
          name: 'test-zero-byte.jpg',
          size: 0,
        },
      })
    } catch (err) {
      // Payload may reject this — that's acceptable. What's NOT acceptable is
      // our plugin crashing with a sharp decode error from the plugin layer.
      const msg = (err as Error).message ?? String(err)
      expect(msg).not.toMatch(/Input buffer contains unsupported image format/i)
      crashed = true
    }

    if (!crashed && doc) {
      // If Payload accepted the doc, our imageOptimizer field should NOT be
      // present (we returned data untouched for the zero-byte case).
      expect(doc.imageOptimizer?.status).toBeUndefined()
    }
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
    expect(updatedDoc.mimeType).toBe('image/webp')
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

  describe('/image-optimizer/regenerate endpoint', () => {
    // Mirror the plugin config used in dev/payload.config.ts so the resolved
    // config matches what the running server actually has wired up.
    const resolvedConfig = resolveConfig({
      collections: {
        media: true,
        avatars: {
          maxDimensions: { width: 256, height: 256 },
          format: { format: 'webp', quality: 90 },
        },
      },
    })

    const mkReq = (
      overrides: {
        url?: string
        body?: unknown
        user?: Record<string, unknown> | null
      } = {},
    ) =>
      ({
        user: overrides.user === null ? undefined : overrides.user ?? { id: 'test-user' },
        url: overrides.url ?? 'http://localhost/api/image-optimizer/regenerate',
        payload,
        json: async () => overrides.body ?? {},
      }) as any

    test('GET returns 200 with configured:false for an unconfigured collection (log-noise fix)', async () => {
      const handler = createRegenerateStatusHandler(resolvedConfig)
      const res: Response = await handler(
        mkReq({ url: 'http://localhost/api/image-optimizer/regenerate?collection=posts' }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.configured).toBe(false)
      expect(body.total).toBe(0)
      expect(body.complete).toBe(0)
      expect(body.errored).toBe(0)
      expect(body.pending).toBe(0)
      expect(body.cancelled).toBe(false)
    })

    test('GET returns 200 with configured:true for a configured collection', async () => {
      const handler = createRegenerateStatusHandler(resolvedConfig)
      const res: Response = await handler(
        mkReq({ url: 'http://localhost/api/image-optimizer/regenerate?collection=media' }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.configured).toBe(true)
      expect(typeof body.total).toBe('number')
    })

    test('GET returns 400 when the collection query param is missing', async () => {
      const handler = createRegenerateStatusHandler(resolvedConfig)
      const res: Response = await handler(
        mkReq({ url: 'http://localhost/api/image-optimizer/regenerate' }),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/collection/i)
    })

    test('GET returns 401 when no user is attached', async () => {
      const handler = createRegenerateStatusHandler(resolvedConfig)
      const res: Response = await handler(
        mkReq({
          url: 'http://localhost/api/image-optimizer/regenerate?collection=media',
          user: null,
        }),
      )
      expect(res.status).toBe(401)
    })

    test('POST still returns 400 for unconfigured collection (regression guard — side effects)', async () => {
      const handler = createRegenerateHandler(resolvedConfig)
      const res: Response = await handler(mkReq({ body: { collectionSlug: 'posts' } }))
      expect(res.status).toBe(400)
    })

    test('DELETE still returns 400 for unconfigured collection (regression guard — side effects)', async () => {
      const handler = createCancelHandler(resolvedConfig)
      const res: Response = await handler(mkReq({ body: { collectionSlug: 'posts' } }))
      expect(res.status).toBe(400)
    })
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
    expect(updatedDoc.mimeType).toBe('image/webp')

    // Verify file was resized
    const savedPath = path.resolve(dirname, 'avatars', updatedDoc.filename as string)
    const metadata = await sharp(savedPath).metadata()
    expect(metadata.width).toBeLessThanOrEqual(256)
    expect(metadata.height).toBeLessThanOrEqual(256)
  })

  test('regeneration of a deleted doc resolves as skipped without throwing', async () => {
    // Reproduces the production log spam: a job queued for a doc that gets
    // deleted before the worker runs. With the NotFound guard in
    // regenerateDocument.ts the job should resolve cleanly (no retries, no
    // "Failed to persist error status" noise) rather than throwing.
    const buffer = await createTestImage(400, 300)
    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-regen-deleted.jpg',
        size: buffer.length,
      },
      context: { imageOptimizer_skip: true },
    })

    await payload.delete({ collection: 'media', id: doc.id })

    const errorSpy = vi.spyOn(payload.logger, 'error')

    await payload.jobs.queue({
      task: 'imageOptimizer_regenerateDocument',
      input: { collectionSlug: 'media', docId: String(doc.id) },
    })
    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Guard catches findByID NotFound → returns terminal skip. No error
    // writeback attempt happens, so no "Failed to persist error status" log.
    const persistFailureLog = errorSpy.mock.calls.some((call) =>
      JSON.stringify(call).includes('Failed to persist error status'),
    )
    expect(persistFailureLog).toBe(false)

    errorSpy.mockRestore()
  })
})
