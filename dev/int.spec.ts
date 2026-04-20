import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import path from 'path'
import fs from 'fs/promises'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
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
    // v2: originalSize is captured by the beforeOperation hook before Payload
    // mutates req.file. Optimization should produce a smaller file.
    expect(doc.imageOptimizer.optimizedSize).toBeLessThan(doc.imageOptimizer.originalSize)
    expect(doc.imageOptimizer.status).toBe('pending')

    // Verify the saved file was resized within max dimensions
    const savedPath = path.resolve(dirname, 'media', doc.filename as string)
    const metadata = await sharp(savedPath).metadata()
    expect(metadata.width).toBeLessThanOrEqual(2560)
    expect(metadata.height).toBeLessThanOrEqual(2560)
    // v2: replaceOriginal + formats[0] = webp → parent file is webp natively
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

    // ThumbHash is computed in the background (deferred from the sync save path).
    // Wait for the background job/waitUntil to complete, then re-fetch.
    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    const updatedDoc = await payload.findByID({ collection: 'media', id: doc.id })

    expect(updatedDoc.imageOptimizer.thumbHash).toBeDefined()
    expect(typeof updatedDoc.imageOptimizer.thumbHash).toBe('string')
    expect(updatedDoc.imageOptimizer.thumbHash.length).toBeGreaterThan(0)

    // Verify it's valid base64 that decodes without error
    const decoded = Buffer.from(updatedDoc.imageOptimizer.thumbHash, 'base64')
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

    // With replaceOriginal: true (default), the main file is already webp (first format).
    // Only remaining formats (avif) appear as variants.
    expect(updatedDoc.imageOptimizer.variants).toHaveLength(1)
    expect(updatedDoc.mimeType).toBe('image/webp')

    const avifVariant = updatedDoc.imageOptimizer.variants.find(
      (v: any) => v.format === 'avif',
    )

    expect(avifVariant).toBeDefined()
    expect(avifVariant.mimeType).toBe('image/avif')
    expect(avifVariant.filesize).toBeGreaterThan(0)

    // Verify variant file exists on disk
    const mediaDir = path.resolve(dirname, 'media')
    const avifExists = await fs.access(path.join(mediaDir, avifVariant.filename)).then(() => true).catch(() => false)

    expect(avifExists).toBe(true)
  })

  test('should regenerate additive variants after focal-point change (native reupload)', async () => {
    // Regression harness for the staleness bug: when Payload's shouldReupload()
    // re-runs its pipeline after a focal-point change, the parent + sizes get
    // regenerated with the new crop, but additive variants (e.g. AVIF sibling)
    // previously stayed stamped from the pre-change crop because afterChange
    // short-circuited on `imageOptimizer_nativeReupload`.
    const buffer = await createTestImage(400, 300)

    const doc = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test-focal-reupload.jpg',
        size: buffer.length,
      },
    })

    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    const initialDoc = await payload.findByID({ collection: 'media', id: doc.id })
    expect(initialDoc.imageOptimizer.status).toBe('complete')
    const initialVariants = initialDoc.imageOptimizer.variants as Array<{
      filename: string
      format: string
    }>
    const initialAvif = initialVariants.find((v) => v.format === 'avif')
    expect(initialAvif).toBeDefined()

    const mediaDir = path.resolve(dirname, 'media')
    const variantPath = path.join(mediaDir, initialAvif!.filename)
    const initialStat = await fs.stat(variantPath)

    // Ensure measurable mtime delta on coarse filesystems.
    await new Promise((resolve) => setTimeout(resolve, 1100))

    // Update focalX/focalY to trigger Payload's shouldReupload() path.
    //
    // Payload's reupload logic is finicky in the local-API context:
    //   1. `generateFileData` only re-fetches the stored file when
    //      `shouldReupload(uploadEdits, data)` returns true AND the incoming
    //      `data` carries the doc's current filename/url (used as the source
    //      of the re-fetched bytes).
    //   2. `shouldReupload` compares `uploadEdits.focalPoint` against
    //      `data.focalX/Y`. When they agree, no reupload fires.
    //   3. The browser admin UI achieves asymmetric values by sending the NEW
    //      focal in `?uploadEdits=...` while the body still carries the OLD
    //      `focalX/Y` from `originalDoc` — a legitimate reupload signal.
    //
    // Mirroring (3) here: we pass the NEW focal via `req.query.uploadEdits`
    // but keep `data.focalX/Y` at their stored (50, 50) values.
    await payload.update({
      collection: 'media',
      id: doc.id,
      data: {
        filename: initialDoc.filename,
        url: initialDoc.url,
        focalX: (initialDoc as any).focalX ?? 50,
        focalY: (initialDoc as any).focalY ?? 50,
      } as any,
      req: {
        query: { uploadEdits: { focalPoint: { x: 25, y: 75 } } },
      } as any,
    })

    // Allow the queued convertFormats job + waitUntil promise to complete.
    await payload.jobs.run()
    await new Promise((resolve) => setTimeout(resolve, 500))

    const updatedDoc = await payload.findByID({ collection: 'media', id: doc.id })

    // Status cycled through pending → complete again, meaning convertFormats
    // was re-invoked after the focal-point change.
    expect(updatedDoc.imageOptimizer.status).toBe('complete')

    const updatedVariants = updatedDoc.imageOptimizer.variants as Array<{
      filename: string
      format: string
    }>
    const updatedAvif = updatedVariants.find((v) => v.format === 'avif')
    expect(updatedAvif).toBeDefined()
    // Filename stems off doc.filename (same across updates), so the same
    // variant path is rewritten rather than orphaned.
    expect(updatedAvif!.filename).toBe(initialAvif!.filename)

    // The variant was rewritten: mtime advanced relative to the pre-change
    // snapshot. This is the cheapest signal available in the local harness
    // — full pixel comparison would require a non-constant source image.
    const updatedStat = await fs.stat(variantPath)
    expect(updatedStat.mtimeMs).toBeGreaterThan(initialStat.mtimeMs)

    // Sanity: the focal point on the parent doc really did change, confirming
    // the reupload path was taken.
    expect(updatedDoc.focalX).toBe(25)
    expect(updatedDoc.focalY).toBe(75)
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

    // With replaceOriginal: true (default) and formats: [webp], the main file
    // is already webp. No additional variants are generated (formats.slice(1) = []).
    expect(updatedDoc.imageOptimizer.variants).toHaveLength(0)
    expect(updatedDoc.mimeType).toBe('image/webp')
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

    // With replaceOriginal: true (default), main file is webp. Only avif is a variant.
    expect(updatedDoc.imageOptimizer.variants).toHaveLength(1)
    expect(updatedDoc.mimeType).toBe('image/webp')

    const formats = updatedDoc.imageOptimizer.variants.map((v: any) => v.format)
    expect(formats).toContain('avif')
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
    expect(doc.imageOptimizer.variants).toEqual([])
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
    // replaceOriginal: true → main file is webp, only avif is a variant
    expect(updatedDoc.imageOptimizer.variants).toHaveLength(1)
    expect(updatedDoc.imageOptimizer.variants[0].format).toBe('avif')
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
          formats: [{ format: 'webp', quality: 90 }],
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
    // replaceOriginal: true + formats: [webp] → main file is webp, no additional variants
    expect(updatedDoc.imageOptimizer.variants).toHaveLength(0)
    expect(updatedDoc.mimeType).toBe('image/webp')

    // Verify file was resized
    const savedPath = path.resolve(dirname, 'avatars', updatedDoc.filename as string)
    const metadata = await sharp(savedPath).metadata()
    expect(metadata.width).toBeLessThanOrEqual(256)
    expect(metadata.height).toBeLessThanOrEqual(256)
  })
})
