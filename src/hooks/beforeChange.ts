import path from 'path'
import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { resolveCollectionConfig } from '../defaults.js'
import { generateThumbHash } from '../processing/index.js'

/**
 * v2 — Config-injection architecture.
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
 *     thumbHash) and decision of whether an additive multi-format job is needed
 */
export const createBeforeChangeHook = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): CollectionBeforeChangeHook => {
  return async ({ context, data, originalDoc, req }) => {
    if (context?.imageOptimizer_skip) return data

    if (!req.file || !req.file.data || !req.file.mimetype?.startsWith('image/')) return data

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

    const perCollectionConfig = resolveCollectionConfig(resolvedConfig, collectionSlug)

    // Original size: captured by beforeOperation hook before generateFileData
    // mutated req.file.size. Falls back to current req.file.size when unavailable
    // (e.g. tests that bypass beforeOperation), in which case originalSize ==
    // optimizedSize.
    const originalSize =
      (context?.imageOptimizer_originalSize as number | undefined) ?? req.file.data.length

    // Optimized size: req.file.data here is the post-resize/format buffer that
    // Payload will write. data.filesize was also populated by generateFileData
    // and is the same value, but req.file.data.length is the source of truth.
    const optimizedSize = req.file.data.length

    // Multi-format mode requires the additive convertFormats job to handle
    // formats[1..N] (formats[0] is already produced natively).
    const needsAsyncJob = perCollectionConfig.formats.length > 1

    data.imageOptimizer = {
      originalSize,
      optimizedSize,
      status: needsAsyncJob ? 'pending' : 'complete',
      variants: needsAsyncJob ? undefined : [],
      error: null,
    }

    // Single-format mode: compute ThumbHash inline so it lands in the initial
    // DB write (avoids a follow-up update that fails on MongoDB transactions
    // when cloud storage is involved).
    if (resolvedConfig.generateThumbHash && !needsAsyncJob) {
      data.imageOptimizer.thumbHash = await generateThumbHash(req.file.data)
    }

    context.imageOptimizer_hasUpload = true
    if (!needsAsyncJob) {
      context.imageOptimizer_statusResolved = true
    }

    return data
  }
}
