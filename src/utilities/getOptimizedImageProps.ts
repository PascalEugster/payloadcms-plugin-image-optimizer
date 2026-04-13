import type { MediaResource } from '../types.js'
import { getImageOptimizerProps, type ImageOptimizerProps } from './getImageOptimizerProps.js'
import { createVariantLoader } from './responsiveImage.js'

type ImageLoaderProps = { src: string; width: number; quality?: number | undefined }
type ImageLoader = (props: ImageLoaderProps) => string

export type OptimizedImageProps = ImageOptimizerProps & {
  loader?: ImageLoader
}

/**
 * Returns all optimization props for a Next.js `<Image>` component in a single
 * spread-friendly object: ThumbHash blur placeholder, focal-point positioning,
 * and a variant-aware responsive loader.
 *
 * Designed as a drop-in enhancement for the Payload website template's `ImageMedia`:
 *
 * ```tsx
 * // In your ImageMedia component — just add the import and spread:
 * import { getOptimizedImageProps } from '@inoo-ch/payload-image-optimizer/frontend'
 *
 * const optimizedProps = getOptimizedImageProps(resource)
 *
 * <NextImage
 *   {...optimizedProps}
 *   src={src}
 *   alt={alt}
 *   fill={fill}
 *   sizes={sizes}
 *   priority={priority}
 *   loading={loading}
 * />
 * ```
 *
 * What it returns:
 * - `placeholder` / `blurDataURL` — per-image ThumbHash (replaces the template's hardcoded blur)
 * - `style.objectPosition` — focal-point-based positioning
 * - `loader` — hybrid loader that serves pre-generated Payload size variants directly,
 *   falling back to `/_next/image` when no close match exists (only present when
 *   `resource.sizes` has variants)
 */
export function getOptimizedImageProps(
  resource: MediaResource | null | undefined,
): OptimizedImageProps {
  const base = getImageOptimizerProps(resource)

  if (!resource) return base

  const loader = createVariantLoader(resource)

  return loader ? { ...base, loader } : base
}
