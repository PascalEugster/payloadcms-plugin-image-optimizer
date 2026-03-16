import type { CollectionSlug } from 'payload'

export type ImageFormat = 'webp' | 'avif'

export type FormatQuality = {
  format: ImageFormat
  quality: number // 1-100
}

export type CollectionOptimizerConfig = {
  formats?: FormatQuality[]
  maxDimensions?: { width: number; height: number }
}

export type ImageOptimizerConfig = {
  collections: Partial<Record<CollectionSlug, true | CollectionOptimizerConfig>>
  disabled?: boolean
  formats?: FormatQuality[]
  generateBlurPlaceholder?: boolean
  maxDimensions?: { width: number; height: number }
  stripMetadata?: boolean
}

export type ResolvedImageOptimizerConfig = Required<
  Pick<ImageOptimizerConfig, 'formats' | 'generateBlurPlaceholder' | 'maxDimensions' | 'stripMetadata'>
> & {
  collections: ImageOptimizerConfig['collections']
  disabled: boolean
}
