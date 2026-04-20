import fs from 'fs/promises';
import path from 'path';
import { resolveCollectionConfig } from '../defaults.js';
import { convertFormat, generateThumbHash } from '../processing/index.js';
import { resolveStaticDir } from '../utilities/resolveStaticDir.js';
import { fetchFileBuffer, isCloudStorage } from '../utilities/storage.js';
/**
 * v2 — Additive multi-format job.
 *
 * Payload's native pipeline already produced the primary format (formats[0])
 * as the parent file. This task only generates additive variants for
 * formats[1..N] (e.g. AVIF alongside the WebP primary) and updates the doc's
 * `imageOptimizer.variants` array.
 *
 * Single-format collections never reach this task — `afterChange` short-circuits
 * the queue when `formats.length <= 1`.
 */ export const createConvertFormatsHandler = (resolvedConfig)=>{
    return async ({ input, req })=>{
        try {
            const doc = await req.payload.findByID({
                collection: input.collectionSlug,
                id: input.docId
            });
            const collectionConfig = req.payload.collections[input.collectionSlug].config;
            const cloudStorage = isCloudStorage(collectionConfig);
            const perCollectionConfig = resolveCollectionConfig(resolvedConfig, input.collectionSlug);
            // Only formats beyond the primary need new files — the primary is
            // already the parent file Payload produced natively.
            const formatsToGenerate = perCollectionConfig.formats.slice(1);
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
            const safeFilename = path.basename(doc.filename);
            const variants = [];
            const variantResults = await Promise.all(formatsToGenerate.map(async (format)=>{
                const result = await convertFormat(fileBuffer, format.format, format.quality);
                const variantFilename = `${path.parse(safeFilename).name}-optimized.${format.format}`;
                await fs.writeFile(path.join(staticDir, variantFilename), result.buffer);
                return {
                    format: format.format,
                    filename: variantFilename,
                    filesize: result.size,
                    width: result.width,
                    height: result.height,
                    mimeType: result.mimeType,
                    url: `/api/${input.collectionSlug}/file/${variantFilename}`
                };
            }));
            variants.push(...variantResults);
            // Compute ThumbHash from the (already-optimized) parent buffer.
            let thumbHash;
            if (resolvedConfig.generateThumbHash) {
                thumbHash = await generateThumbHash(fileBuffer);
            }
            await req.payload.update({
                collection: input.collectionSlug,
                id: input.docId,
                data: {
                    imageOptimizer: {
                        ...doc.imageOptimizer,
                        status: 'complete',
                        variants,
                        thumbHash,
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
                    err: updateErr,
                    docId: input.docId,
                    collectionSlug: input.collectionSlug
                }, 'Failed to persist error status for image optimizer');
            }
            throw err;
        }
    };
};

//# sourceMappingURL=convertFormats.js.map