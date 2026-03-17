import type { ResolvedImageOptimizerConfig } from '../types.js';
export declare const createConvertFormatsHandler: (resolvedConfig: ResolvedImageOptimizerConfig) => ({ input, req }: {
    input: {
        collectionSlug: string;
        docId: string;
    };
    req: any;
}) => Promise<{
    output: {
        variantsGenerated: number;
    };
}>;
