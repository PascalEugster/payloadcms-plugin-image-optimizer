import type { ImageOptimizerConfig, ResolvedCollectionOptimizerConfig, ResolvedImageOptimizerConfig } from './types.js';
export declare const resolveConfig: (config: ImageOptimizerConfig) => ResolvedImageOptimizerConfig;
export declare const resolveCollectionConfig: (resolvedConfig: ResolvedImageOptimizerConfig, collectionSlug: string) => ResolvedCollectionOptimizerConfig;
