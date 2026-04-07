import path from 'path';
import { resolveCollectionConfig } from '../defaults.js';
import { generateThumbHash, optimizeImage } from '../processing/index.js';
import { isCloudStorage } from '../utilities/storage.js';
export const createBeforeChangeHook = (resolvedConfig, collectionSlug)=>{
    return async ({ context, data, originalDoc, req })=>{
        if (context?.imageOptimizer_skip) return data;
        if (!req.file || !req.file.data || !req.file.mimetype?.startsWith('image/')) return data;
        // Detect re-upload triggered by Payload's shouldReupload() — focal point or crop change.
        // shouldReupload re-fetches the stored (already-optimized) file and sets req.file.
        // When re-fetching, Payload sets req.file.name to the stored filename verbatim
        // (via getFileByPath or getExternalFile). For genuine user uploads, req.file.name
        // comes from the user's filesystem and will differ from the stored filename.
        // Skip redundant optimization; let Payload's native image-size regeneration handle cropping.
        if (originalDoc) {
            const existingFilename = originalDoc.filename;
            if (existingFilename && req.file.name === existingFilename) {
                const existingOptimizer = originalDoc.imageOptimizer;
                if (existingOptimizer) {
                    data.imageOptimizer = existingOptimizer;
                }
                context.imageOptimizer_nativeReupload = true;
                return data;
            }
        }
        // Apply custom filename strategy (seoFilename, uuidFilename, or user-provided).
        // The callback returns a stem (no extension) — we append the original extension here,
        // and replaceOriginal may swap it to the target format extension later.
        if (resolvedConfig.generateFilename) {
            const existingFilename = originalDoc?.filename;
            const ext = path.extname(req.file.name);
            const stem = resolvedConfig.generateFilename({
                altText: data.alt,
                originalFilename: req.file.name,
                mimeType: req.file.mimetype,
                collectionSlug,
                existingFilename
            });
            const newFilename = `${stem}${ext}`;
            req.file.name = newFilename;
            data.filename = newFilename;
        }
        const originalSize = req.file.data.length;
        const perCollectionConfig = resolveCollectionConfig(resolvedConfig, collectionSlug);
        // Single-pipeline optimization: resize + strip metadata + optional format conversion.
        // Skips .rotate() — Payload's generateFileData() already auto-rotated before hooks run.
        const primaryFormat = perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0 ? perCollectionConfig.formats[0] : undefined;
        const processed = await optimizeImage(req.file.data, {
            maxDimensions: perCollectionConfig.maxDimensions,
            stripMetadata: resolvedConfig.stripMetadata,
            format: primaryFormat
        });
        let finalBuffer = processed.buffer;
        let finalSize = processed.size;
        if (primaryFormat && processed.mimeType) {
            // Update filename and mimeType so Payload stores the correct metadata
            const originalFilename = data.filename || req.file.name || '';
            const newFilename = `${path.parse(originalFilename).name}.${primaryFormat.format}`;
            context.imageOptimizer_originalFilename = originalFilename;
            data.filename = newFilename;
            data.mimeType = processed.mimeType;
            data.filesize = finalSize;
        }
        // Determine if async work (variant generation job) is needed after create.
        // If not, set status to 'complete' now so afterChange doesn't need a separate
        // update() call — which fails with 404 on MongoDB due to transaction isolation
        // when cloud storage adapters are involved.
        const collectionConfig = req.payload.collections[collectionSlug].config;
        const cloudStorage = isCloudStorage(collectionConfig);
        const needsAsyncJob = !cloudStorage && perCollectionConfig.formats.length > 0 && !(perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length <= 1);
        data.imageOptimizer = {
            originalSize,
            optimizedSize: finalSize,
            status: needsAsyncJob ? 'pending' : 'complete',
            variants: needsAsyncJob ? undefined : [],
            error: null
        };
        if (!needsAsyncJob) {
            context.imageOptimizer_statusResolved = true;
        }
        // When no async job will run, compute ThumbHash now so it's included in the
        // initial DB write. This avoids a separate update() call that would fail with
        // 404 on MongoDB due to transaction isolation. When a job WILL run, the
        // convertFormats task computes ThumbHash in the background instead.
        if (resolvedConfig.generateThumbHash && !needsAsyncJob) {
            data.imageOptimizer.thumbHash = await generateThumbHash(finalBuffer);
        }
        // Write processed buffer back to req.file so cloud storage adapters
        // (which read req.file in their afterChange hook) upload the optimized version.
        // Payload's own uploadFiles step does NOT re-read req.file.data for its local
        // disk write, so we also store the buffer in context for our afterChange hook
        // to overwrite the local file when local storage is enabled.
        req.file.data = finalBuffer;
        req.file.size = finalSize;
        if (perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0) {
            req.file.name = data.filename;
            req.file.mimetype = data.mimeType;
        }
        context.imageOptimizer_processedBuffer = finalBuffer;
        context.imageOptimizer_hasUpload = true;
        return data;
    };
};

//# sourceMappingURL=beforeChange.js.map