import type { MediaResource, MediaSizeVariant } from '../types.js'

type ImageLoaderProps = { src: string; width: number; quality?: number | undefined }
type ImageLoader = (props: ImageLoaderProps) => string

type ValidVariant = { url: string; width: number }

/**
 * Extracts usable variants from a Payload media resource's `sizes` field.
 * Filters out entries missing url or width and sorts by width ascending.
 */
function getValidVariants(media: MediaResource): ValidVariant[] {
  if (!media.sizes) return []

  return Object.values(media.sizes)
    .filter((v): v is MediaSizeVariant & { url: string; width: number } =>
      v != null && typeof v.url === 'string' && typeof v.width === 'number',
    )
    .sort((a, b) => a.width - b.width)
}

/**
 * Finds the best pre-generated variant for a requested width.
 *
 * Strategy:
 * 1. Pick the smallest variant with width >= requested (no quality loss from upscaling)
 * 2. If none is large enough, use the largest variant — but only if it covers >= 80%
 *    of the requested width (minor downscale is acceptable, large gap is not)
 * 3. Returns null when no suitable variant exists → caller should fall back to /_next/image
 */
export function findBestVariant(
  variants: ValidVariant[],
  requestedWidth: number,
): ValidVariant | null {
  if (variants.length === 0) return null

  // Smallest variant >= requested width
  const larger = variants.find((v) => v.width >= requestedWidth)
  if (larger) return larger

  // No variant large enough — use the largest if it's close
  const largest = variants[variants.length - 1]!
  if (largest.width >= requestedWidth * 0.8) return largest

  return null
}

/**
 * Creates a Next.js Image `loader` that maps requested widths to pre-generated
 * Payload size variants when a close match exists, falling back to the default
 * `/_next/image` optimization pipeline when no suitable variant is available.
 *
 * Returns `undefined` when the media has no usable size variants (i.e. no custom
 * loader needed — let next/image use its default behavior).
 *
 * ```tsx
 * import { createVariantLoader } from '@inoo-ch/payload-image-optimizer/client'
 *
 * const loader = createVariantLoader(media)
 * <NextImage loader={loader} src={media.url} ... />
 * ```
 */
export function createVariantLoader(media: MediaResource): ImageLoader | undefined {
  const variants = getValidVariants(media)
  if (variants.length === 0) return undefined

  const cacheBust = media.updatedAt ? `?${media.updatedAt}` : ''

  return ({ src, width, quality }) => {
    const match = findBestVariant(variants, width)

    if (match) {
      return `${match.url}${cacheBust}`
    }

    // Fall back to next/image optimization for unmatched widths
    return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality || 80}`
  }
}

/**
 * Returns a sensible default `sizes` attribute for responsive images.
 *
 * For `fill` mode images without an explicit `sizes` prop, this prevents the
 * browser from assuming `100vw` (which causes it to always download the
 * largest srcSet variant regardless of actual display area).
 */
export function getDefaultSizes(fill: boolean | undefined): string | undefined {
  if (!fill) return undefined
  return '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw'
}
