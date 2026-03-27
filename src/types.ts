import type { CollectionSlug, Field } from 'payload'

export type ImageFormat = 'webp' | 'avif'

export type GenerateFilenameArgs = {
  /** Alt text from the document (if the collection has an `alt` field) */
  altText?: string
  /** Original uploaded filename (e.g., "IMG_2847.jpg") */
  originalFilename: string
  /** The MIME type (e.g., "image/jpeg") */
  mimeType: string
  /** The collection slug this file belongs to */
  collectionSlug: string
  /** Existing filename from a previous upload (set on re-uploads / focal point changes).
   *  Strategies should typically reuse this to avoid cloud storage churn. */
  existingFilename?: string
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
  formats?: FormatQuality[]
  maxDimensions?: { width: number; height: number }
  replaceOriginal?: boolean
}

export type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

export type ImageOptimizerConfig = {
  clientOptimization?: boolean
  collections: Partial<Record<CollectionSlug, true | CollectionOptimizerConfig>>
  disabled?: boolean
  fieldsOverride?: FieldsOverride
  formats?: FormatQuality[]
  /** Custom filename generation strategy. Return the filename **stem** (no extension).
   * The plugin appends the correct extension based on format conversion settings.
   *
   * Built-in strategies:
   * - `uuidFilename` — UUID-based, collision-free (same as `uniqueFileNames: true`)
   * - `seoFilename` — Human-readable from alt text + timestamp
   *
   * When set, `uniqueFileNames` is ignored.
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
  maxDimensions?: { width: number; height: number }
  /** Show the "Regenerate All Images" button in the collection list view.
   * Defaults to `true`. */
  regenerateButton?: boolean
  replaceOriginal?: boolean
  stripMetadata?: boolean
  /** Replace original filenames with UUIDs (e.g., `photo.jpg` → `a1b2c3d4.webp`).
   * Prevents Vercel Blob "already exists" errors and avoids leaking original filenames.
   * Defaults to `false`.
   * @deprecated Use `generateFilename: uuidFilename` instead. */
  uniqueFileNames?: boolean
}

export type ResolvedCollectionOptimizerConfig = {
  formats: FormatQuality[]
  maxDimensions: { width: number; height: number }
  replaceOriginal: boolean
}

export type ResolvedImageOptimizerConfig = Required<
  Pick<ImageOptimizerConfig, 'formats' | 'generateThumbHash' | 'maxDimensions' | 'stripMetadata'>
> & {
  clientOptimization: boolean
  collections: ImageOptimizerConfig['collections']
  disabled: boolean
  /** Resolved filename generator. `undefined` means keep original filename. */
  generateFilename?: GenerateFilename
  regenerateButton: boolean
  replaceOriginal: boolean
}

export type ImageOptimizerData = {
  thumbHash?: string | null
}

export type MediaSizeVariant = {
  url?: string | null
  width?: number | null
  height?: number | null
  mimeType?: string | null
  filesize?: number | null
  filename?: string | null
}

export type MediaResource = {
  url?: string | null
  alt?: string | null
  width?: number | null
  height?: number | null
  filename?: string | null
  focalX?: number | null
  focalY?: number | null
  imageOptimizer?: ImageOptimizerData | null
  updatedAt?: string
  sizes?: Record<string, MediaSizeVariant | undefined>
}
