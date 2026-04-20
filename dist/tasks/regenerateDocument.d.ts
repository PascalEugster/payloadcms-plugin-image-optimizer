import type { ResolvedImageOptimizerConfig } from '../types.js';
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
