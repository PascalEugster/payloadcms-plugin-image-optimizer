import type { Config } from 'payload';
import type { ImageOptimizerConfig } from './types.js';
export { defaultImageOptimizerFields } from './fields/imageOptimizerField.js';
export type { CollectionOptimizerConfig, FieldsOverride, FormatQuality, GenerateFilename, GenerateFilenameArgs, ImageFormat, ImageOptimizerConfig, ImageOptimizerData, MediaResource, MediaSizeVariant } from './types.js';
export { seoFilename, timestampFilename, uuidFilename } from './utilities/filenameStrategies.js';
export { decodeThumbHashToDataURL, encodeImageToThumbHash } from './utilities/thumbhash.js';
/**
 * Recommended maxDuration for the Payload API route on Vercel.
 * Re-export this in your route file:
 *
 *   export { maxDuration } from '@inoo-ch/payload-image-optimizer'
 *
 * Set to 300 to match Vercel's current platform default (up from 60/90 in
 * earlier plans). Large-file regenerations routinely need more than 60s
 * between source download, sharp processing, and cloud-storage re-upload.
 * Consumers who want a tighter ceiling can set their own `export const
 * maxDuration = <n>` on the route file, which takes precedence.
 */
export declare const maxDuration = 300;
export declare const imageOptimizer: (pluginOptions: ImageOptimizerConfig) => (config: Config) => Config;
