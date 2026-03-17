import type { Config } from 'payload';
import type { ImageOptimizerConfig } from './types.js';
export type { ImageOptimizerConfig, ImageFormat, FormatQuality, CollectionOptimizerConfig, ImageOptimizerData, MediaResource, FieldsOverride } from './types.js';
export { defaultImageOptimizerFields } from './fields/imageOptimizerField.js';
export { encodeImageToThumbHash, decodeThumbHashToDataURL } from './utilities/thumbhash.js';
export declare const imageOptimizer: (pluginOptions: ImageOptimizerConfig) => (config: Config) => Config;
