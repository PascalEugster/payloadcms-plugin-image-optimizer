import fs from 'fs/promises';
import path from 'path';
import { resolveStaticDir } from '../utilities/resolveStaticDir.js';
import { isCloudStorage } from '../utilities/storage.js';
import { waitUntil } from '../utilities/waitUntil.js';
export const createAfterChangeHook = (resolvedConfig, collectionSlug)=>{
    return async ({ context, doc, req })=>{
        if (context?.imageOptimizer_skip) return doc;
        // Use context flag from beforeChange instead of checking req.file.data directly.
        // Cloud storage adapters may consume req.file.data in their own afterChange hook
        // before ours runs, which would cause this guard to bail out and leave status as 'pending'.
        if (!context?.imageOptimizer_hasUpload) return doc;
        const collectionConfig = req.payload.collections[collectionSlug].config;
        const cloudStorage = isCloudStorage(collectionConfig);
        // When using local storage, overwrite the file on disk with the processed buffer.
        // Payload's uploadFiles step writes the original buffer; we replace it here.
        // When using cloud storage, skip — the cloud adapter's afterChange hook already
        // uploads the correct buffer from req.file.data (set in our beforeChange hook).
        if (!cloudStorage) {
            const staticDir = resolveStaticDir(collectionConfig);
            const processedBuffer = context.imageOptimizer_processedBuffer;
            if (processedBuffer && doc.filename && staticDir) {
                const safeFilename = path.basename(doc.filename);
                const filePath = path.join(staticDir, safeFilename);
                await fs.writeFile(filePath, processedBuffer);
                // If replaceOriginal changed the filename, clean up the old file Payload wrote
                const originalFilename = context.imageOptimizer_originalFilename;
                if (originalFilename && originalFilename !== safeFilename) {
                    const oldFilePath = path.join(staticDir, path.basename(originalFilename));
                    await fs.unlink(oldFilePath).catch(()=>{
                    // Old file may not exist if Payload used the new filename
                    });
                }
            }
        }
        // When status was already resolved in beforeChange (cloud storage, or
        // replaceOriginal with a single format), no async job or update is needed.
        // This avoids a separate update() call that fails with 404 on MongoDB due to
        // transaction isolation when cloud storage adapters are involved.
        if (context?.imageOptimizer_statusResolved) {
            return doc;
        }
        // Queue async format conversion job for remaining variants (local storage only)
        await req.payload.jobs.queue({
            task: 'imageOptimizer_convertFormats',
            input: {
                collectionSlug,
                docId: String(doc.id)
            }
        });
        const runPromise = req.payload.jobs.run().catch((err)=>{
            req.payload.logger.error({
                err
            }, 'Image optimizer job runner failed');
        });
        waitUntil(runPromise);
        return doc;
    };
};

//# sourceMappingURL=afterChange.js.map