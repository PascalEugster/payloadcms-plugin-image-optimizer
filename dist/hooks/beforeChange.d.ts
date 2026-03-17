import type { CollectionBeforeChangeHook } from 'payload';
import type { ResolvedImageOptimizerConfig } from '../types.js';
export declare const createBeforeChangeHook: (resolvedConfig: ResolvedImageOptimizerConfig, collectionSlug: string) => CollectionBeforeChangeHook;
