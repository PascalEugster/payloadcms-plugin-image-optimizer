import type { CollectionAfterChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { resolveCollectionConfig } from '../defaults.js'
import { waitUntil } from '../utilities/waitUntil.js'

/**
 * v2 — Config-injection architecture.
 *
 * The disk overwrite logic from v1 is gone: Payload's `uploadFiles()` step
 * already wrote the optimized buffer (produced by the formatOptions /
 * resizeOptions we injected at plugin init), and cloud storage adapters
 * receive the same optimized buffer through `req.file.data`.
 *
 * This hook queues the additive `convertFormats` job when the user
 * configured more than one format (e.g. WebP primary + AVIF additive). For
 * single-format mode the work is already complete; we return the doc as-is.
 *
 * Native re-uploads (focal point/crop changes triggered by Payload's
 * `shouldReupload()`) must also re-queue `convertFormats` in multi-format
 * mode: Payload regenerates the parent file + sizes with the new crop, but
 * the additive variants we own (e.g. AVIF siblings) would otherwise remain
 * stamped from the pre-change crop. The task re-fetches the parent buffer
 * via `fetchFileBuffer(doc, collectionConfig)` so the regenerated variants
 * pick up the fresh focal point.
 */
export const createAfterChangeHook = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): CollectionAfterChangeHook => {
  return async ({ context, doc, req }) => {
    if (context?.imageOptimizer_skip) return doc

    const isFreshUpload = Boolean(context?.imageOptimizer_hasUpload)
    const isNativeReupload = Boolean(context?.imageOptimizer_nativeReupload)

    // Neither a genuine upload nor a focal-point/crop re-upload: this is a
    // metadata-only update (e.g. title, alt text) — nothing to do.
    if (!isFreshUpload && !isNativeReupload) return doc

    // Fresh upload already resolved to a `complete` status inline (single
    // format mode or non-image uploads) — no job needed.
    if (isFreshUpload && context?.imageOptimizer_statusResolved) return doc

    // Only multi-format collections need the additive convertFormats job.
    // Single-format mode has no additive variants to regenerate.
    const perCollectionConfig = resolveCollectionConfig(resolvedConfig, collectionSlug)
    if (perCollectionConfig.formats.length <= 1) return doc

    // Note on native reupload status:
    // We deliberately don't pre-flip `imageOptimizer.status` to 'pending'
    // here — that would race with the in-flight parent update that just
    // triggered this afterChange, producing a WriteConflict on MongoDB
    // transactional writes. The convertFormats task re-writes status on
    // completion (and on error), which is sufficient for consumers polling
    // the field. The window during which status reads 'complete' while
    // variants are briefly stale is bounded by the queue's runtime.

    await req.payload.jobs.queue({
      task: 'imageOptimizer_convertFormats',
      input: {
        collectionSlug,
        docId: String(doc.id),
      },
    })

    const runPromise = req.payload.jobs.run({ sequential: true }).catch((err: unknown) => {
      req.payload.logger.error({ err }, 'Image optimizer job runner failed')
    })
    waitUntil(runPromise, req)

    return doc
  }
}
