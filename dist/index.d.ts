import type { Config } from 'payload';
import type { ImageOptimizerConfig } from './types.js';
export type { ImageOptimizerConfig, ImageFormat, FormatQuality, CollectionOptimizerConfig, ImageOptimizerData, MediaResource, MediaSizeVariant, FieldsOverride, GenerateFilename, GenerateFilenameArgs } from './types.js';
export { defaultImageOptimizerFields } from './fields/imageOptimizerField.js';
export { encodeImageToThumbHash, decodeThumbHashToDataURL } from './utilities/thumbhash.js';
export { uuidFilename, seoFilename, timestampFilename } from './utilities/filenameStrategies.js';
/**
 * Recommended maxDuration for the Payload API route on Vercel.
 * Re-export this in your route file:
 *
 *   export { maxDuration } from '@inoo-ch/payload-image-optimizer'
 */
export declare const maxDuration = 60;
export declare const imageOptimizer: (pluginOptions: ImageOptimizerConfig) => (config: Config) => Config;
