import path from 'path'

import type { CollectionSlug } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { fetchFileBuffer } from '../utilities/storage.js'

const GLOBAL_SLUG = 'image-optimizer-state'

/**
 * Detects Payload's `NotFound` (HTTP 404) error. Matches any APIError-derived
 * class with a 404 status — including the "doc was deleted between queue and
 * run" case that produces retry noise without this guard.
 */
const isNotFound = (err: unknown): boolean => {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 404
}

/**
 * Process-local cache for the cancellation check. Since the endpoint now
 * runs jobs in parallel waves (WAVE_SIZE ≈ 20), without this cache every
 * wave would hit `findGlobal` N times in near-lockstep. The 1s TTL trades
 * a tiny delay on cancellation-visibility against a linear drop in DB
 * pressure (N → 1 per wave). The endpoint's own wave-entry check uses the
 * uncached path so the wave-boundary decision stays authoritative.
 */
const CANCEL_CACHE_TTL_MS = 1_000
const cancelCache = new Map<string, { value: boolean; expiresAt: number }>()

async function isCancelled(req: any, collectionSlug: string): Promise<boolean> {
  const cached = cancelCache.get(collectionSlug)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  try {
    const state = await req.payload.findGlobal({ slug: GLOBAL_SLUG })
    const collState = (state?.collections as Record<string, any>)?.[collectionSlug]
    const value = !!(collState?.cancelledAt && collState.cancelledAt > (collState.startedAt ?? 0))
    cancelCache.set(collectionSlug, { value, expiresAt: Date.now() + CANCEL_CACHE_TTL_MS })
    return value
  } catch {
    // Global may not exist yet — not cancelled.
    return false
  }
}

/**
 * Regeneration via Payload's native pipeline.
 *
 * Reads the existing parent file, then calls `payload.update({ file })` to
 * push it back through the same pipeline a fresh upload uses. Because the
 * plugin injects `formatOptions` / `resizeOptions` / `withMetadata` into the
 * upload config at init, Payload's `generateFileData()` re-applies the same
 * resize + format conversion + metadata strip pass, and our `beforeChange`
 * hook re-stamps `imageOptimizer` (status + thumbhash).
 *
 * For cloud storage the same call re-uploads via the adapter's afterChange.
 *
 * Deleted docs (typically from stale retries whose target was deleted between
 * queue and run) are treated as a terminal no-op: the task returns a
 * `doc-deleted` status instead of throwing so Payload's job queue doesn't
 * keep retrying, and the catch-block error writeback doesn't double-log.
 */
export const createRegenerateDocumentHandler = (resolvedConfig: ResolvedImageOptimizerConfig) => {
  return async ({ input, req }: { input: { collectionSlug: string; docId: string }; req: any }) => {
    try {
      // Cancellation check — cached per-process so a wave of parallel jobs
      // doesn't all hit `findGlobal` simultaneously.
      if (await isCancelled(req, input.collectionSlug)) {
        return { output: { status: 'cancelled', reason: 'user-cancelled' } }
      }

      let doc
      try {
        doc = await req.payload.findByID({
          collection: input.collectionSlug as CollectionSlug,
          id: input.docId,
          // depth: 0 — we only read scalar fields here (mimeType, filename,
          // url, imageOptimizer). Default depth (2) populates every relation
          // on the doc — including nested folder hierarchies — which on
          // production deployments adds many DB round-trips to each regen
          // for no benefit (e.g. `folder` → parent folder → sibling
          // documentsAndFolders array). Observed ~4-8s saved per job on
          // media docs nested in populated folder trees.
          depth: 0,
        })
      } catch (err) {
        if (isNotFound(err)) {
          // Stale retry for a doc that was deleted after the job was queued.
          // Return terminal skip — no throw means no further retries, no
          // noise in the logs for something we can't recover from.
          return { output: { status: 'skipped', reason: 'doc-deleted' } }
        }
        throw err
      }

      // Skip non-image documents
      if (!doc.mimeType || !doc.mimeType.startsWith('image/')) {
        return { output: { status: 'skipped', reason: 'not-image' } }
      }

      const collectionConfig =
        req.payload.collections[input.collectionSlug as keyof typeof req.payload.collections].config

      const fileBuffer = await fetchFileBuffer(doc, collectionConfig, req.payload.config.serverURL)
      const safeFilename = path.basename(doc.filename)

      // Carry forward the previously recorded `originalSize` (set on first
      // upload, possibly from the pre-client-resize byte count). Without this
      // the regeneration would fall through to `req.file.size` which is the
      // *already-optimized* stored buffer — shrinking the reported original
      // on every regen and making savings trend toward zero.
      const carriedOriginalSize = (doc as { imageOptimizer?: { originalSize?: number } })
        .imageOptimizer?.originalSize

      // Push the file through Payload's native pipeline. The `file` argument
      // triggers `generateFileData` to run again, which respects the
      // formatOptions / resizeOptions / withMetadata injected at plugin init.
      // beforeChange re-stamps imageOptimizer (originalSize, optimizedSize,
      // thumbHash, status='complete').
      //
      // For cloud storage the same call re-uploads via the adapter's hook.
      await req.payload.update({
        collection: input.collectionSlug as CollectionSlug,
        id: input.docId,
        // depth: 0 — skip re-hydrating the updated doc's relations in the
        // response. We don't use the return value; the hook writes through
        // to the DB and the admin UI polls for the fresh state separately.
        // Pairs with the depth: 0 on findByID above.
        depth: 0,
        data:
          typeof carriedOriginalSize === 'number'
            ? { imageOptimizer: { originalSize: carriedOriginalSize } }
            : {},
        file: {
          data: fileBuffer,
          mimetype: doc.mimeType,
          name: safeFilename,
          size: fileBuffer.length,
        },
        // overwriteExistingFiles avoids the safe-filename suffix dance — we
        // want the file written with the same name (post format extension swap).
        overwriteExistingFiles: true,
        // Tell beforeChange this is an explicit regeneration so it doesn't
        // short-circuit through the focal-point re-upload path.
        context: { imageOptimizer_regenerating: true },
      })

      return { output: { status: 'complete' } }
    } catch (err) {
      // If the doc vanished mid-flight (e.g. deleted during the pipeline),
      // treat as a terminal skip — same as the findByID NotFound path above.
      // Prevents retry-spam for an unrecoverable state.
      if (isNotFound(err)) {
        return { output: { status: 'skipped', reason: 'doc-deleted' } }
      }

      const errorMessage = err instanceof Error ? err.message : String(err)

      try {
        await req.payload.update({
          collection: input.collectionSlug as CollectionSlug,
          id: input.docId,
          depth: 0,
          data: {
            imageOptimizer: {
              status: 'error',
              error: errorMessage,
            },
          },
          context: { imageOptimizer_skip: true },
        })
      } catch (updateErr) {
        // Suppress the double-log when the error-writeback also hits a
        // NotFound — nothing to persist to, and the outer throw would be
        // retried anyway. For other update failures, keep the log.
        if (!isNotFound(updateErr)) {
          req.payload.logger.error(
            { err: updateErr, docId: input.docId, collectionSlug: input.collectionSlug },
            'Failed to persist error status for image optimizer regeneration',
          )
        }
      }

      throw err
    }
  }
}
