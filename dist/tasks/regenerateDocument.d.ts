import type { ResolvedImageOptimizerConfig } from '../types.js';
/**
 * v2 — Regeneration via Payload's native pipeline.
 *
 * Reads the existing parent file, then calls `payload.update({ file })` to
 * push it back through the same pipeline a fresh upload uses. Because the
 * plugin injects `formatOptions` / `resizeOptions` / `withMetadata` into the
 * upload config at init, Payload's `generateFileData()` re-applies the same
 * resize + format conversion + metadata strip pass, and our `beforeChange`
 * hook re-stamps `imageOptimizer` (status + thumbhash) and queues additive
 * variants if the collection is multi-format.
 *
 * For cloud storage we re-upload via the same update call so the cloud
 * adapter's afterChange hook re-uploads the file.
 */
export declare const createRegenerateDocumentHandler: (resolvedConfig: ResolvedImageOptimizerConfig) => ({ input, req }: {
    input: {
        collectionSlug: string;
        docId: string;
    };
    req: any;
}) => Promise<{
    output: {
        status: string;
        reason: string;
    };
} | {
    output: {
        status: string;
        reason?: undefined;
    };
}>;
