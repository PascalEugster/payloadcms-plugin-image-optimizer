import type { CollectionAfterChangeHook } from 'payload';
import type { ResolvedImageOptimizerConfig } from '../types.js';
export declare const createAfterChangeHook: (resolvedConfig: ResolvedImageOptimizerConfig, collectionSlug: string) => CollectionAfterChangeHook;
