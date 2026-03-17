export declare function stripAndResize(buffer: Buffer, maxDimensions: {
    width: number;
    height: number;
}, stripMetadata: boolean): Promise<{
    buffer: Buffer;
    width: number;
    height: number;
    size: number;
}>;
export declare function generateThumbHash(buffer: Buffer): Promise<string>;
export declare function convertFormat(buffer: Buffer, format: 'webp' | 'avif', quality: number): Promise<{
    buffer: Buffer;
    width: number;
    height: number;
    size: number;
    mimeType: string;
}>;
