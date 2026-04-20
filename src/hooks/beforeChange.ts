import path from 'path'
import sharp from 'sharp'
import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { generateThumbHash } from '../processing/index.js'

/**
 * Config-injection architecture.
 *
 * Payload's native `generateFileData()` pipeline (driven by
 * `upload.formatOptions`, `upload.resizeOptions`, `upload.withMetadata`, and
 * per-size `imageSize.formatOptions` injected at plugin init) handles all the
 * actual image work — resize, format conversion, EXIF strip — before this hook
 * runs. By this point `req.file.data` is the optimized buffer Payload will
 * persist to disk / cloud storage.
 *
 * This hook only owns:
 *   • the optional filename strategy (seoFilename, uuidFilename, custom)
 *   • the early-bail when Payload is re-fetching its own file for a focal-point
 *     adjustment (no need to re-stamp anything)
 *   • the imageOptimizer status field (originalSize, optimizedSize, status,
 *     thumbHash)
 *
 * Status is always `complete` after this hook runs — no async handoff.
 */
export const createBeforeChangeHook = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): CollectionBeforeChangeHook => {
  return async ({ context, data, originalDoc, req }) => {
    if (context?.imageOptimizer_skip) return data

    if (!req.file || !req.file.data || !req.file.mimetype?.startsWith('image/')) return data

    // Guard: zero-byte buffer. Sharp throws on decode; let Payload handle the
    // empty file at its own layer rather than corrupting a bogus status record.
    if (req.file.data.length === 0) return data

    // Resolve the true original size before any guard short-circuits, so SVG,
    // animated-GIF, and normal paths all report the same stat. Priority:
    //   1. Client-submitted `data.imageOptimizer.originalSize` — the only
    //      source that can see the pre-canvas byte count when client-side
    //      resize is on.
    //   2. `beforeOperation` context snapshot — the size that arrived at the
    //      server, captured before `generateFileData` mutated `req.file`.
    //   3. Current `req.file.data.length` — post-pipeline fallback for paths
    //      that bypass `beforeOperation` (tests, programmatic creates).
    //
    // Guardrail on (1): must be a finite positive number and at least as
    // large as the server-received size. A client can't legitimately claim
    // the original was *smaller* than what it uploaded — if it does, ignore
    // it rather than trust a tampered stat.
    const serverReceivedSize =
      (context?.imageOptimizer_originalSize as number | undefined) ?? req.file.data.length
    const clientReported = (data as { imageOptimizer?: { originalSize?: unknown } })
      ?.imageOptimizer?.originalSize
    const clientReportedValid =
      typeof clientReported === 'number' &&
      Number.isFinite(clientReported) &&
      clientReported >= serverReceivedSize
    const originalSize = clientReportedValid ? clientReported : serverReceivedSize

    // Guard: SVG. Sharp rasterizes vectors — format conversion to webp/avif
    // produces a blurry raster, not a vector. Skip plugin optimization while
    // still letting Payload persist the original file untouched.
    if (req.file.mimetype === 'image/svg+xml') {
      data.imageOptimizer = {
        originalSize,
        optimizedSize: req.file.data.length,
        status: 'complete',
        error: null,
      }
      return data
    }

    // Guard: animated GIF. Sharp's toFormat('webp') drops frames silently (keeps
    // only the first) — data loss. Static GIFs (single page) fall through to
    // normal processing. `pages: -1` asks sharp to read all pages so the
    // metadata reports the true frame count.
    if (req.file.mimetype === 'image/gif') {
      try {
        const metadata = await sharp(req.file.data, { pages: -1 }).metadata()
        if (typeof metadata.pages === 'number' && metadata.pages > 1) {
          data.imageOptimizer = {
            originalSize,
            optimizedSize: req.file.data.length,
            status: 'complete',
            error: null,
          }
          return data
        }
      } catch {
        // If sharp can't parse the GIF at all, fall through so Payload's
        // generateFileData surfaces the real error rather than masking it.
      }
    }

    // Detect re-upload triggered by Payload's shouldReupload() — focal point or crop change.
    // shouldReupload re-fetches the stored (already-optimized) file and sets req.file.
    // When re-fetching, Payload sets req.file.name to the stored filename verbatim
    // (via getFileByPath or getExternalFile). For genuine user uploads, req.file.name
    // comes from the user's filesystem and will differ from the stored filename.
    // Skip redundant optimization; let Payload's native image-size regeneration handle cropping.
    //
    // The regeneration task also matches this pattern (re-uploads the existing
    // file under its current name) but it explicitly opts in to a full re-stamp
    // via `imageOptimizer_regenerating`, so we don't short-circuit there.
    if (originalDoc && !context?.imageOptimizer_regenerating) {
      const existingFilename = (originalDoc as Record<string, unknown>).filename as string | undefined

      if (existingFilename && req.file.name === existingFilename) {
        const existingOptimizer = (originalDoc as Record<string, unknown>).imageOptimizer
        if (existingOptimizer) {
          data.imageOptimizer = existingOptimizer as typeof data.imageOptimizer
        }
        context.imageOptimizer_nativeReupload = true
        return data
      }
    }

    // Apply custom filename strategy (seoFilename, uuidFilename, or user-provided).
    // The callback returns a stem (no extension) — we append the extension Payload
    // will give the file (the post-formatOptions extension is reflected in
    // data.filename by the time the field hooks run, but at this point we still
    // see the original upload extension on req.file.name; data.filename has the
    // post-pipeline extension when generateFileData has produced one).
    if (resolvedConfig.generateFilename) {
      const existingFilename = (originalDoc as Record<string, unknown> | undefined)?.filename as string | undefined
      // Prefer data.filename (set by generateFileData with the converted extension)
      // over req.file.name (the original upload extension). Falls back to req.file.name.
      const sourceForExt = (data as Record<string, unknown>).filename as string | undefined ?? req.file.name
      const ext = path.extname(sourceForExt)
      const stem = resolvedConfig.generateFilename({
        altText: (data as Record<string, unknown>).alt as string | undefined,
        originalFilename: req.file.name,
        mimeType: req.file.mimetype,
        collectionSlug,
        existingFilename,
      })
      const newFilename = `${stem}${ext}`
      req.file.name = newFilename
      data.filename = newFilename
    }

    // Optimized size: req.file.data here is the post-resize/format buffer that
    // Payload will write. data.filesize was also populated by generateFileData
    // and is the same value, but req.file.data.length is the source of truth.
    // `originalSize` was resolved above (client-reported → context → fallback).
    const optimizedSize = req.file.data.length

    data.imageOptimizer = {
      originalSize,
      optimizedSize,
      status: 'complete',
      error: null,
    }

    // Compute ThumbHash inline so it lands in the initial DB write (avoids a
    // follow-up update that can fail on MongoDB transactions when cloud
    // storage is involved).
    if (resolvedConfig.generateThumbHash) {
      data.imageOptimizer.thumbHash = await generateThumbHash(req.file.data)
    }

    return data
  }
}
