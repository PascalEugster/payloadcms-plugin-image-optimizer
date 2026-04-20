import { resolveCollectionConfig } from '../defaults.js';
import { waitUntil } from '../utilities/waitUntil.js';
/**
 * v2 — Config-injection architecture.
 *
 * The disk overwrite logic from v1 is gone: Payload's `uploadFiles()` step
 * already wrote the optimized buffer (produced by the formatOptions /
 * resizeOptions we injected at plugin init), and cloud storage adapters
 * receive the same optimized buffer through `req.file.data`.
 *
 * This hook only queues the additive `convertFormats` job when the user
 * configured more than one format (e.g. WebP primary + AVIF additive). For
 * single-format mode the work is already complete; we return the doc as-is.
 */ export const createAfterChangeHook = (resolvedConfig, collectionSlug)=>{
    return async ({ context, doc, req })=>{
        if (context?.imageOptimizer_skip) return doc;
        // Native re-uploads (focal point/crop changes): nothing to do — Payload's
        // native image-size regeneration already happened with the injected
        // formatOptions / resizeOptions.
        if (context?.imageOptimizer_nativeReupload) return doc;
        if (!context?.imageOptimizer_hasUpload) return doc;
        if (context?.imageOptimizer_statusResolved) return doc;
        // Multi-format mode: queue additive variants. The convertFormats task
        // produces formats[1..N] (formats[0] is already the parent file).
        const perCollectionConfig = resolveCollectionConfig(resolvedConfig, collectionSlug);
        if (perCollectionConfig.formats.length <= 1) return doc;
        await req.payload.jobs.queue({
            task: 'imageOptimizer_convertFormats',
            input: {
                collectionSlug,
                docId: String(doc.id)
            }
        });
        const runPromise = req.payload.jobs.run({
            sequential: true
        }).catch((err)=>{
            req.payload.logger.error({
                err
            }, 'Image optimizer job runner failed');
        });
        waitUntil(runPromise, req);
        return doc;
    };
};

//# sourceMappingURL=afterChange.js.map