/**
 * Returns true when the collection uses cloud/external storage (disableLocalStorage: true).
 * When true, files are uploaded by external adapter hooks — no local FS writes should happen.
 */
export declare function isCloudStorage(collectionConfig: {
    upload?: boolean | Record<string, any>;
}): boolean;
/**
 * Reads a file buffer from local disk or fetches it from URL.
 * Tries local disk first (when available), falls back to URL fetch.
 * This makes the plugin storage-agnostic — works with local FS and cloud storage alike.
 */
export declare function fetchFileBuffer(doc: {
    filename?: string;
    url?: string;
}, collectionConfig: {
    upload?: boolean | Record<string, any>;
}): Promise<Buffer>;
