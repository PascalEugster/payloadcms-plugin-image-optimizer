import fs from 'fs/promises';
import path from 'path';
import { resolveCollectionConfig } from '../defaults.js';
import { convertFormat } from '../processing/index.js';
import { resolveStaticDir } from '../utilities/resolveStaticDir.js';
import { fetchFileBuffer, isCloudStorage } from '../utilities/storage.js';
export const createConvertFormatsHandler = (resolvedConfig)=>{
    return async ({ input, req })=>{
        try {
            const doc = await req.payload.findByID({
                collection: input.collectionSlug,
                id: input.docId
            });
            const collectionConfig = req.payload.collections[input.collectionSlug].config;
            const cloudStorage = isCloudStorage(collectionConfig);
            // Cloud storage: variant files cannot be uploaded without direct adapter access.
            // Mark as complete — CDN-level image optimization handles format conversion.
            if (cloudStorage) {
                await req.payload.update({
                    collection: input.collectionSlug,
                    id: input.docId,
                    data: {
                        imageOptimizer: {
                            ...doc.imageOptimizer,
                            status: 'complete',
                            variants: [],
                            error: null
                        }
                    },
                    context: {
                        imageOptimizer_skip: true
                    }
                });
                return {
                    output: {
                        variantsGenerated: 0
                    }
                };
            }
            const staticDir = resolveStaticDir(collectionConfig);
            if (!staticDir) {
                throw new Error(`No staticDir configured for collection "${input.collectionSlug}"`);
            }
            const fileBuffer = await fetchFileBuffer(doc, collectionConfig);
            const variants = [];
            const perCollectionConfig = resolveCollectionConfig(resolvedConfig, input.collectionSlug);
            // When replaceOriginal is on, the main file is already in the primary format —
            // skip it and only generate variants for the remaining formats.
            const formatsToGenerate = perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0 ? perCollectionConfig.formats.slice(1) : perCollectionConfig.formats;
            const safeFilename = path.basename(doc.filename);
            for (const format of formatsToGenerate){
                const result = await convertFormat(fileBuffer, format.format, format.quality);
                const variantFilename = `${path.parse(safeFilename).name}-optimized.${format.format}`;
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
            await req.payload.update({
                collection: input.collectionSlug,
                id: input.docId,
                data: {
                    imageOptimizer: {
                        ...doc.imageOptimizer,
                        status: 'complete',
                        variants,
                        error: null
                    }
                },
                context: {
                    imageOptimizer_skip: true
                }
            });
            return {
                output: {
                    variantsGenerated: variants.length
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
                }, 'Failed to persist error status for image optimizer');
            }
            throw err;
        }
    };
};

//# sourceMappingURL=convertFormats.js.map