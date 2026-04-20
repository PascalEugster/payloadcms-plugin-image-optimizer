import type { CollectionSlug, Field } from 'payload';
export type ImageFormat = 'webp' | 'avif';
export type GenerateFilenameArgs = {
    /** Alt text from the document (if the collection has an `alt` field) */
    altText?: string;
    /** Original uploaded filename (e.g., "IMG_2847.jpg") */
    originalFilename: string;
    /** The MIME type (e.g., "image/jpeg") */
    mimeType: string;
    /** The collection slug this file belongs to */
    collectionSlug: string;
    /** Existing filename from a previous upload (set on re-uploads / focal point changes).
     *  Strategies should typically reuse this to avoid cloud storage churn. */
    existingFilename?: string;
};
/**
 * Custom filename generation function.
 * Return the filename **stem** (without extension) — the plugin appends the
 * correct extension based on format conversion settings.
 *
 * Built-in strategies: `uuidFilename`, `seoFilename`
 */
export type GenerateFilename = (args: GenerateFilenameArgs) => string;
export type FormatQuality = {
    format: ImageFormat;
    quality: number;
};
export type CollectionOptimizerConfig = {
    format?: FormatQuality;
    maxDimensions?: {
        width: number;
        height: number;
    };
};
export type FieldsOverride = (args: {
    defaultFields: Field[];
}) => Field[];
export type RegenerateButtonConfig = {
    /** Whether the button is rendered at all. Defaults to `true`. */
    enabled?: boolean;
    /** Expose the "Force re-process all" opt-in that reprocesses already-optimized
     * images across the whole collection. Defaults to `false` — the primary action
     * is always "Regenerate N Unoptimized" unless this is set to `true`. */
    allowForceAll?: boolean;
};
export type ResolvedRegenerateButtonConfig = {
    enabled: boolean;
    allowForceAll: boolean;
};
/**
 * Metadata-keep policy. When set, takes precedence over the simple
 * `stripMetadata: boolean` toggle and is passed through as Payload's
 * `withMetadata` callback.
 *
 * Return `true` to KEEP metadata for this image, `false` to strip it.
 *
 * Non-override rule: if the collection already has `upload.withMetadata`, the
 * plugin leaves it untouched.
 */
export type MetadataPolicy = (args: {
    metadata: any;
}) => boolean | Promise<boolean>;
/**
 * Response header policy applied to file responses for targeted collections.
 *
 * - `false` (default) — do nothing.
 * - `'immutable'` — inject a `modifyResponseHeaders` that sets
 *   `Cache-Control: public, max-age=31536000, immutable`. Only safe when
 *   filenames are content-stable (`generateFilename` is set, e.g. `uuidFilename`
 *   or `seoFilename`). Otherwise the plugin emits a `payload.logger.warn` at
 *   init explaining the risk of stale cached files when filenames are reused.
 * - function — passed through to Payload as-is. Receives a `{ doc }` arg
 *   alongside `headers` (for richer per-doc decisions if Payload supplies it).
 *
 * Non-override rule: if the collection already has `upload.modifyResponseHeaders`,
 * the plugin leaves it untouched.
 */
export type ResponseHeadersOption = false | 'immutable' | ((headers: Headers, args: {
    doc: unknown;
}) => Headers | void);
/**
 * `adminThumbnail` strategy injected on each targeted collection.
 *
 * - `'auto'` (default) — inject a function form that returns a URL derived from
 *   `doc.filename`. Survives the parent-file extension change that format
 *   conversion introduces (e.g. `.jpg` → `.webp`), where a hand-written
 *   string-name reference like `'thumbnail'` would still work but a custom URL
 *   helper might break.
 * - `string` — passed through to Payload as a size-name reference (e.g. `'thumbnail'`).
 * - function — passed through to Payload as-is.
 *
 * Non-override rule: if the collection already has `upload.adminThumbnail`, the
 * plugin leaves it untouched.
 */
export type AdminThumbnailOption = 'auto' | string | ((args: {
    doc: {
        filename?: string | null;
    };
}) => string | null | undefined);
export type ImageOptimizerConfig = {
    /** Inject an `adminThumbnail` for targeted collections.
     *
     * - `'auto'` (default) — inject a function that returns the file URL from
     *   `doc.filename`, surviving the parent-file extension change when format
     *   conversion runs.
     * - string — pass through as a size-name reference.
     * - function — pass through as-is.
     *
     * Non-override: respects an existing `upload.adminThumbnail`. */
    adminThumbnail?: AdminThumbnailOption;
    clientOptimization?: boolean;
    collections: Partial<Record<CollectionSlug, true | CollectionOptimizerConfig>>;
    disabled?: boolean;
    fieldsOverride?: FieldsOverride;
    /** Target format for the uploaded image. When set, the plugin injects
     * `upload.formatOptions` into every targeted collection that doesn't already
     * have one, and also injects `formatOptions` into each `imageSize` lacking one.
     *
     * Defaults to `{ format: 'webp', quality: 80 }`. Pass `null` or override at
     * the collection level to disable format conversion entirely (original
     * extension preserved).
     *
     * Non-override: respects an existing `upload.formatOptions`. */
    format?: FormatQuality | null;
    /** Custom filename generation strategy. Return the filename **stem** (no extension).
     * The plugin appends the correct extension based on format conversion settings.
     *
     * Built-in strategies:
     * - `uuidFilename` — UUID-based, collision-free, no human readability
     * - `seoFilename` — Human-readable from alt text + timestamp (falls back to original stem)
     * - `timestampFilename` — Original filename stem + ISO timestamp with ms
     *
     * @example
     * ```ts
     * import { imageOptimizer, seoFilename } from '@inoo-ch/payload-image-optimizer'
     *
     * imageOptimizer({
     *   collections: { media: true },
     *   generateFilename: seoFilename,
     * })
     * ```
     */
    generateFilename?: GenerateFilename;
    generateThumbHash?: boolean;
    maxDimensions?: {
        width: number;
        height: number;
    };
    /** Richer metadata-keep policy. When set, takes precedence over `stripMetadata`.
     * Passed through as Payload's `withMetadata` callback.
     *
     * Return `true` to KEEP metadata, `false` to strip.
     *
     * Non-override: respects an existing `upload.withMetadata`.
     *
     * @example
     * ```ts
     * imageOptimizer({
     *   collections: { media: true },
     *   metadataPolicy: ({ metadata }) => metadata.format === 'jpeg', // keep EXIF on JPEGs only
     * })
     * ```
     */
    metadataPolicy?: MetadataPolicy;
    /** Regeneration button config for the collection list view.
     *
     * - `true` (default) — show the button; default action is "Regenerate N Unoptimized".
     * - `false` — hide the button entirely.
     * - `{ enabled?, allowForceAll? }` — fine-grained control.
     *   `allowForceAll: true` exposes the "Force re-process all" opt-in (default: `false`).
     */
    regenerateButton?: boolean | RegenerateButtonConfig;
    /** Opt-in response header policy for file responses on targeted collections.
     *
     * - `false` (default) — do nothing.
     * - `'immutable'` — inject `Cache-Control: public, max-age=31536000, immutable`.
     *   Only safe when `generateFilename` is set; otherwise the plugin warns at init.
     * - function — pass through as-is.
     *
     * Non-override: respects an existing `upload.modifyResponseHeaders`. */
    responseHeaders?: ResponseHeadersOption;
    stripMetadata?: boolean;
};
export type ResolvedCollectionOptimizerConfig = {
    /** Null means "do not convert format" — preserve original extension. */
    format: FormatQuality | null;
    maxDimensions: {
        width: number;
        height: number;
    };
};
export type ResolvedImageOptimizerConfig = Required<Pick<ImageOptimizerConfig, 'generateThumbHash' | 'maxDimensions' | 'stripMetadata'>> & {
    /** Resolved adminThumbnail option. Defaults to `'auto'`. */
    adminThumbnail: AdminThumbnailOption;
    clientOptimization: boolean;
    collections: ImageOptimizerConfig['collections'];
    disabled: boolean;
    /** Resolved format. Null means "do not convert format" — preserve original extension. */
    format: FormatQuality | null;
    /** Resolved filename generator. `undefined` means keep original filename. */
    generateFilename?: GenerateFilename;
    /** Resolved metadata-keep policy. When set, takes precedence over `stripMetadata`. */
    metadataPolicy?: MetadataPolicy;
    regenerateButton: ResolvedRegenerateButtonConfig;
    /** Resolved response-header policy. Defaults to `false`. */
    responseHeaders: ResponseHeadersOption;
};
export type ImageOptimizerData = {
    thumbHash?: string | null;
};
export type MediaSizeVariant = {
    url?: string | null;
    width?: number | null;
    height?: number | null;
    mimeType?: string | null;
    filesize?: number | null;
    filename?: string | null;
};
export type MediaResource = {
    url?: string | null;
    alt?: string | null;
    width?: number | null;
    height?: number | null;
    filename?: string | null;
    focalX?: number | null;
    focalY?: number | null;
    imageOptimizer?: ImageOptimizerData | null;
    updatedAt?: string;
    sizes?: Record<string, MediaSizeVariant | undefined>;
};
