import path from 'path';
import { fetchFileBuffer } from '../utilities/storage.js';
const GLOBAL_SLUG = 'image-optimizer-state';
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
 */ export const createRegenerateDocumentHandler = (resolvedConfig)=>{
    return async ({ input, req })=>{
        try {
            // Cancellation check
            try {
                const state = await req.payload.findGlobal({
                    slug: GLOBAL_SLUG
                });
                const collState = state?.collections?.[input.collectionSlug];
                if (collState?.cancelledAt && collState.cancelledAt > (collState.startedAt || 0)) {
                    return {
                        output: {
                            status: 'cancelled',
                            reason: 'user-cancelled'
                        }
                    };
                }
            } catch  {
            // Global may not exist yet — proceed normally
            }
            const doc = await req.payload.findByID({
                collection: input.collectionSlug,
                id: input.docId
            });
            // Skip non-image documents
            if (!doc.mimeType || !doc.mimeType.startsWith('image/')) {
                return {
                    output: {
                        status: 'skipped',
                        reason: 'not-image'
                    }
                };
            }
            const collectionConfig = req.payload.collections[input.collectionSlug].config;
            const fileBuffer = await fetchFileBuffer(doc, collectionConfig, req.payload.config.serverURL);
            const safeFilename = path.basename(doc.filename);
            // Carry forward the previously recorded `originalSize` (set on first
            // upload, possibly from the pre-client-resize byte count). Without this
            // the regeneration would fall through to `req.file.size` which is the
            // *already-optimized* stored buffer — shrinking the reported original
            // on every regen and making savings trend toward zero.
            const carriedOriginalSize = doc.imageOptimizer?.originalSize;
            // Push the file through Payload's native pipeline. The `file` argument
            // triggers `generateFileData` to run again, which respects the
            // formatOptions / resizeOptions / withMetadata injected at plugin init.
            // beforeChange re-stamps imageOptimizer (originalSize, optimizedSize,
            // thumbHash, status='complete').
            //
            // For cloud storage the same call re-uploads via the adapter's hook.
            await req.payload.update({
                collection: input.collectionSlug,
                id: input.docId,
                data: typeof carriedOriginalSize === 'number' ? {
                    imageOptimizer: {
                        originalSize: carriedOriginalSize
                    }
                } : {},
                file: {
                    data: fileBuffer,
                    mimetype: doc.mimeType,
                    name: safeFilename,
                    size: fileBuffer.length
                },
                // overwriteExistingFiles avoids the safe-filename suffix dance — we
                // want the file written with the same name (post format extension swap).
                overwriteExistingFiles: true,
                // Tell beforeChange this is an explicit regeneration so it doesn't
                // short-circuit through the focal-point re-upload path.
                context: {
                    imageOptimizer_regenerating: true
                }
            });
            return {
                output: {
                    status: 'complete'
                }
            };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            try {
                await req.payload.update({
                    collection: input.collectionSlug,
                    id: input.docId,
                    data: {
                        imageOptimizer: {
                            status: 'error',
                            error: errorMessage
                        }
                    },
                    context: {
                        imageOptimizer_skip: true
                    }
                });
            } catch (updateErr) {
                req.payload.logger.error({
                    err: updateErr,
                    docId: input.docId,
                    collectionSlug: input.collectionSlug
                }, 'Failed to persist error status for image optimizer regeneration');
            }
            throw err;
        }
    };
};

//# sourceMappingURL=regenerateDocument.js.map