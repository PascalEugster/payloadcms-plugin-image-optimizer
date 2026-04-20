import type { CollectionBeforeChangeHook } from 'payload';
import type { ResolvedImageOptimizerConfig } from '../types.js';
/**
 * v2 — Config-injection architecture.
 *
 * Payload's native `generateFileData()` pipeline (driven by
 * `upload.formatOptions`, `upload.resizeOptions`, `upload.withMetadata`, and
 * per-size `imageSize.formatOptions` injected at plugin init) handles all the
 * actual image work — resize, format conversion, EXIF strip — before this hook
 * runs. By this point `req.file.data` is the optimized buffer Payload will
 * persist to disk / cloud storage.
 *
 * This hook only owns:
 *   • the optional filename strategy (seoFilename, uuidFilename, custom)
 *   • the early-bail when Payload is re-fetching its own file for a focal-point
 *     adjustment (no need to re-stamp anything)
 *   • the imageOptimizer status field (originalSize, optimizedSize, status,
 *     thumbHash) and decision of whether an additive multi-format job is needed
 */
export declare const createBeforeChangeHook: (resolvedConfig: ResolvedImageOptimizerConfig, collectionSlug: string) => CollectionBeforeChangeHook;
