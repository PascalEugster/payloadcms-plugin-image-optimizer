import type { ResolvedImageOptimizerConfig } from '../types.js';
export declare const createRegenerateDocumentHandler: (resolvedConfig: ResolvedImageOptimizerConfig) => ({ input, req }: {
    input: {
        collectionSlug: string;
        docId: string;
    };
    req: any;
}) => Promise<{
    output: {
        status: string;
        reason: string;
    };
} | {
    output: {
        status: string;
        reason?: undefined;
    };
}>;
