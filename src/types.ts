import type { CollectionSlug, Field } from 'payload'

export type ImageFormat = 'avif' | 'webp'

export type GenerateFilenameArgs = {
  /** Alt text from the document (if the collection has an `alt` field) */
  altText?: string
  /** The collection slug this file belongs to */
  collectionSlug: string
  /** Existing filename from a previous upload (set on re-uploads / focal point changes).
   *  Strategies should typically reuse this to avoid cloud storage churn. */
  existingFilename?: string
  /** The MIME type (e.g., "image/jpeg") */
  mimeType: string
  /** Original uploaded filename (e.g., "IMG_2847.jpg") */
  originalFilename: string
}

/**
 * Custom filename generation function.
 * Return the filename **stem** (without extension) — the plugin appends the
 * correct extension based on format conversion settings.
 *
 * Built-in strategies: `uuidFilename`, `seoFilename`
 */
export type GenerateFilename = (args: GenerateFilenameArgs) => string

export type FormatQuality = {
  format: ImageFormat
  quality: number // 1-100
}

export type CollectionOptimizerConfig = {
  format?: FormatQuality
  maxDimensions?: { height: number; width: number }
}

export type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

export type RegenerateButtonConfig = {
  /** Expose the "Force re-process all" opt-in that reprocesses already-optimized
   * images across the whole collection. Defaults to `false` — the primary action
   * is always "Regenerate N Unoptimized" unless this is set to `true`. */
  allowForceAll?: boolean
  /** Whether the button is rendered at all. Defaults to `true`. */
  enabled?: boolean
}

export type ResolvedRegenerateButtonConfig = {
  allowForceAll: boolean
  enabled: boolean
}

/**
 * Logging verbosity for the `imageOptimizer_regenerateDocument` task.
 *
 * - `'silent'` (default) — errors only. No per-job lifecycle output.
 * - `'normal'` — lifecycle (enter/exit) at `info`, errors at `error`, and
 *   user-cancelled skips. Recommended when bulk regenerations are rare.
 * - `'verbose'` — adds doc details (filename/alt/mimeType/filesize) to `exit`
 *   logs and enables all skip reasons.
 * - object — merged over the `'silent'` baseline for fine-grained control.
 *
 * Errors are emitted in every mode unless `errors: false` is explicitly set on
 * the object form. The primary value of this plugin's logging is structured
 * error context at the task boundary — emitted *before* the status writeback,
 * independent of whether that writeback succeeds.
 */
export type LoggingMode = 'normal' | 'silent' | 'verbose'

/**
 * Per-reason gating for `imageOpt.regen.skipped` logs. Shorthand: pass `true`
 * (all reasons) or `false` (none) instead of an object.
 */
export type LoggingSkipsConfig = {
  docDeleted?: boolean
  notImage?: boolean
  userCancelled?: boolean
}

export type LoggingConfig = {
  /** Emit `imageOpt.regen.error` at error level, before the status writeback. */
  errors?: boolean
  /** Include `filename`, `alt`, `mimeType`, `filesize` on the exit log. */
  includeDocDetails?: boolean
  /** Emit `imageOpt.regen.enter` and `imageOpt.regen.exit` at info level. */
  lifecycle?: boolean
  /** Gate `imageOpt.regen.skipped` logs per-reason. `true`/`false` = all/none. */
  skips?: boolean | LoggingSkipsConfig
}

export type ResolvedLoggingConfig = {
  errors: boolean
  includeDocDetails: boolean
  lifecycle: boolean
  skips: Required<LoggingSkipsConfig>
}

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
export type MetadataPolicy = (args: { metadata: any }) => boolean | Promise<boolean>

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
export type ResponseHeadersOption =
  | 'immutable'
  | ((headers: Headers, args: { doc: unknown }) => Headers | void)
  | false

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
export type AdminThumbnailOption =
  | 'auto'
  | ((args: { doc: { filename?: null | string } }) => null | string | undefined)
  | string

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
  adminThumbnail?: AdminThumbnailOption
  clientOptimization?: boolean
  collections: Partial<Record<CollectionSlug, CollectionOptimizerConfig | true>>
  disabled?: boolean
  fieldsOverride?: FieldsOverride
  /** Target format for the uploaded image. When set, the plugin injects
   * `upload.formatOptions` into every targeted collection that doesn't already
   * have one, and also injects `formatOptions` into each `imageSize` lacking one.
   *
   * Defaults to `{ format: 'webp', quality: 80 }`. Pass `null` or override at
   * the collection level to disable format conversion entirely (original
   * extension preserved).
   *
   * Non-override: respects an existing `upload.formatOptions`. */
  format?: FormatQuality | null
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
  generateFilename?: GenerateFilename
  generateThumbHash?: boolean
  /** Lifecycle logging for the `imageOptimizer_regenerateDocument` task.
   *
   * - `'silent'` (default) — errors only.
   * - `'normal'` — lifecycle (enter/exit) + errors + user-cancelled skips.
   * - `'verbose'` — adds doc details on exit + all skip reasons.
   * - object — fine-grained control, merged over the `'silent'` baseline.
   *
   * Errors are always emitted unless explicitly disabled via the object form
   * (`{ errors: false }`). Logs flow through `req.payload.logger` (Pino). */
  logging?: LoggingConfig | LoggingMode
  maxDimensions?: { height: number; width: number }
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
  metadataPolicy?: MetadataPolicy
  /** Regeneration button config for the collection list view.
   *
   * - `true` (default) — show the button; default action is "Regenerate N Unoptimized".
   * - `false` — hide the button entirely.
   * - `{ enabled?, allowForceAll? }` — fine-grained control.
   *   `allowForceAll: true` exposes the "Force re-process all" opt-in (default: `false`).
   */
  regenerateButton?: boolean | RegenerateButtonConfig
  /** Wrap the regeneration task's `payload.update({ file })` in a MongoDB
   * transaction. Defaults to `false`.
   *
   * The update runs the full sharp + cloud-storage upload pipeline, which on
   * large originals can easily exceed MongoDB's default
   * `transactionLifetimeLimitSeconds` of 60s — aborting the transaction and
   * cascading into the error-writeback step. Disabling transactions on this
   * specific operation sidesteps that ceiling entirely.
   *
   * Per-doc regens are independent and idempotent, so the atomicity loss is
   * acceptable: a partial failure leaves the doc in a recoverable state
   * (`imageOptimizer.status = 'error'` on the doc, plus the task-boundary
   * error log). Re-running the regen on that doc resolves it.
   *
   * Set to `true` only if you've already bumped your cluster's transaction
   * lifetime and prefer atomicity over throughput on regeneration. */
  regenerateUseTransactions?: boolean
  /** Opt-in response header policy for file responses on targeted collections.
   *
   * - `false` (default) — do nothing.
   * - `'immutable'` — inject `Cache-Control: public, max-age=31536000, immutable`.
   *   Only safe when `generateFilename` is set; otherwise the plugin warns at init.
   * - function — pass through as-is.
   *
   * Non-override: respects an existing `upload.modifyResponseHeaders`. */
  responseHeaders?: ResponseHeadersOption
  /** Pre-compute and persist the ThumbHash-derived base64 PNG `blurDataURL`
   *  on the media document at upload time, so `getImageOptimizerProps()` can
   *  read it directly instead of decoding at every render.
   *
   *  Requires `generateThumbHash` to also be on (the value is derived from
   *  the thumbhash). Has no effect when thumbhash generation is disabled.
   *
   *  When enabled:
   *   - `beforeChange` runs `decodeThumbHashToDataURL()` once per upload and
   *     persists the result to `imageOptimizer.blurDataURL`.
   *   - `getImageOptimizerProps()` prefers the stored value; when absent it
   *     falls back to runtime decode (full back-compat with old docs).
   *   - The plugin's `imageOptimizer` group gains a hidden, readOnly
   *     `blurDataURL` text field on targeted collections.
   *
   *  Trade-off: adds ~1–3 KB per media doc to both MongoDB storage and every
   *  listing-endpoint response. Worth it when pages carry many images and
   *  you've measured client-side decode cost as a TBT contributor.
   *
   *  Back-compat: old docs without the field fall through to runtime decode,
   *  so flipping this on is non-breaking. Run the plugin's regeneration task
   *  to backfill existing documents.
   *
   *  Defaults to `false`. */
  storeBlurDataURL?: boolean
  stripMetadata?: boolean
}

export type ResolvedCollectionOptimizerConfig = {
  /** Null means "do not convert format" — preserve original extension. */
  format: FormatQuality | null
  maxDimensions: { height: number; width: number }
}

export type ResolvedImageOptimizerConfig = {
  /** Resolved adminThumbnail option. Defaults to `'auto'`. */
  adminThumbnail: AdminThumbnailOption
  clientOptimization: boolean
  collections: ImageOptimizerConfig['collections']
  disabled: boolean
  /** Resolved format. Null means "do not convert format" — preserve original extension. */
  format: FormatQuality | null
  /** Resolved filename generator. `undefined` means keep original filename. */
  generateFilename?: GenerateFilename
  /** Resolved logging config. Defaults to the `'silent'` preset. */
  logging: ResolvedLoggingConfig
  /** Resolved metadata-keep policy. When set, takes precedence over `stripMetadata`. */
  metadataPolicy?: MetadataPolicy
  regenerateButton: ResolvedRegenerateButtonConfig
  /** Resolved regeneration transaction mode. Defaults to `false`. */
  regenerateUseTransactions: boolean
  /** Resolved response-header policy. Defaults to `false`. */
  responseHeaders: ResponseHeadersOption
  /** Resolved pre-decoded-blur flag. Defaults to `false`. */
  storeBlurDataURL: boolean
} & Required<
  Pick<ImageOptimizerConfig, 'generateThumbHash' | 'maxDimensions' | 'stripMetadata'>
>

export type ImageOptimizerData = {
  blurDataURL?: null | string
  thumbHash?: null | string
}

export type MediaSizeVariant = {
  filename?: null | string
  filesize?: null | number
  height?: null | number
  mimeType?: null | string
  url?: null | string
  width?: null | number
}

export type MediaResource = {
  alt?: null | string
  filename?: null | string
  focalX?: null | number
  focalY?: null | number
  height?: null | number
  imageOptimizer?: ImageOptimizerData | null
  sizes?: Record<string, MediaSizeVariant | undefined>
  updatedAt?: string
  url?: null | string
  width?: null | number
}
