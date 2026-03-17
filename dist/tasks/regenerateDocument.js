import fs from 'fs/promises';
import path from 'path';
import { resolveCollectionConfig } from '../defaults.js';
import { stripAndResize, generateThumbHash, convertFormat } from '../processing/index.js';
import { resolveStaticDir } from '../utilities/resolveStaticDir.js';
import { fetchFileBuffer, isCloudStorage } from '../utilities/storage.js';
export const createRegenerateDocumentHandler = (resolvedConfig)=>{
    return async ({ input, req })=>{
        try {
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
            const cloudStorage = isCloudStorage(collectionConfig);
            const fileBuffer = await fetchFileBuffer(doc, collectionConfig);
            const originalSize = fileBuffer.length;
            const perCollectionConfig = resolveCollectionConfig(resolvedConfig, input.collectionSlug);
            // Sanitize filename to prevent path traversal
            const safeFilename = path.basename(doc.filename);
            // Step 1: Strip metadata + resize
            const processed = await stripAndResize(fileBuffer, perCollectionConfig.maxDimensions, resolvedConfig.stripMetadata);
            let mainBuffer = processed.buffer;
            let mainSize = processed.size;
            let newFilename = safeFilename;
            let newMimeType;
            // Step 1b: If replaceOriginal, convert main file to primary format
            if (perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0) {
                const primaryFormat = perCollectionConfig.formats[0];
                const converted = await convertFormat(processed.buffer, primaryFormat.format, primaryFormat.quality);
                mainBuffer = converted.buffer;
                mainSize = converted.size;
                newFilename = `${path.parse(safeFilename).name}.${primaryFormat.format}`;
                newMimeType = converted.mimeType;
            }
            // Step 2: Generate ThumbHash
            let thumbHash;
            if (resolvedConfig.generateThumbHash) {
                thumbHash = await generateThumbHash(mainBuffer);
            }
            // Step 3: Store the optimized file
            const variants = [];
            if (cloudStorage) {
                // Cloud storage: re-upload the optimized file via Payload's update API.
                // This triggers the cloud adapter's afterChange hook which uploads to cloud.
                const updateData = {
                    imageOptimizer: {
                        originalSize,
                        optimizedSize: mainSize,
                        status: 'complete',
                        thumbHash,
                        variants: [],
                        error: null
                    }
                };
                if (newFilename !== safeFilename) {
                    updateData.filename = newFilename;
                    updateData.filesize = mainSize;
                    updateData.mimeType = newMimeType;
                }
                await req.payload.update({
                    collection: input.collectionSlug,
                    id: input.docId,
                    data: updateData,
                    file: {
                        data: mainBuffer,
                        mimetype: newMimeType || doc.mimeType,
                        name: newFilename,
                        size: mainSize
                    },
                    context: {
                        imageOptimizer_skip: true
                    }
                });
            } else {
                // Local storage: write files to disk
                const staticDir = resolveStaticDir(collectionConfig);
                const newFilePath = path.join(staticDir, newFilename);
                await fs.writeFile(newFilePath, mainBuffer);
                // Clean up old file if filename changed
                if (newFilename !== safeFilename) {
                    const oldFilePath = path.join(staticDir, safeFilename);
                    await fs.unlink(oldFilePath).catch(()=>{});
                }
                // Generate variant files (local storage only)
                const formatsToGenerate = perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0 ? perCollectionConfig.formats.slice(1) : perCollectionConfig.formats;
                for (const format of formatsToGenerate){
                    const result = await convertFormat(mainBuffer, format.format, format.quality);
                    const variantFilename = `${path.parse(newFilename).name}-optimized.${format.format}`;
                    await fs.writeFile(path.join(staticDir, variantFilename), result.buffer);
                    variants.push({
                        format: format.format,
                        filename: variantFilename,
                        filesize: result.size,
                        width: result.width,
                        height: result.height,
                        mimeType: result.mimeType,
                        url: `/api/${input.collectionSlug}/file/${variantFilename}`
                    });
                }
                // Update the document with optimization data
                const updateData = {
                    imageOptimizer: {
                        originalSize,
                        optimizedSize: mainSize,
                        status: 'complete',
                        thumbHash,
                        variants,
                        error: null
                    }
                };
                if (newFilename !== safeFilename) {
                    updateData.filename = newFilename;
                    updateData.filesize = mainSize;
                    updateData.mimeType = newMimeType;
                }
                await req.payload.update({
                    collection: input.collectionSlug,
                    id: input.docId,
                    data: updateData,
                    context: {
                        imageOptimizer_skip: true
                    }
                });
            }
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
                    err: updateErr
                }, 'Failed to persist error status for image optimizer regeneration');
            }
            throw err;
        }
    };
};

//# sourceMappingURL=regenerateDocument.js.map