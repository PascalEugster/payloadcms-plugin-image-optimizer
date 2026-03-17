import type { CollectionSlug } from 'payload'

export type ImageFormat = 'webp' | 'avif'

export type FormatQuality = {
  format: ImageFormat
  quality: number // 1-100
}

export type CollectionOptimizerConfig = {
  formats?: FormatQuality[]
  maxDimensions?: { width: number; height: number }
  replaceOriginal?: boolean
}

export type ImageOptimizerConfig = {
  collections: Partial<Record<CollectionSlug, true | CollectionOptimizerConfig>>
  disabled?: boolean
  formats?: FormatQuality[]
  generateThumbHash?: boolean
  maxDimensions?: { width: number; height: number }
  replaceOriginal?: boolean
  stripMetadata?: boolean
}

export type ResolvedCollectionOptimizerConfig = {
  formats: FormatQuality[]
  maxDimensions: { width: number; height: number }
  replaceOriginal: boolean
}

export type ResolvedImageOptimizerConfig = Required<
  Pick<ImageOptimizerConfig, 'formats' | 'generateThumbHash' | 'maxDimensions' | 'stripMetadata'>
> & {
  collections: ImageOptimizerConfig['collections']
  disabled: boolean
  replaceOriginal: boolean
}
