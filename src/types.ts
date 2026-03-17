import type { CollectionSlug, Field } from 'payload'

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

export type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

export type ImageOptimizerConfig = {
  collections: Partial<Record<CollectionSlug, true | CollectionOptimizerConfig>>
  disabled?: boolean
  fieldsOverride?: FieldsOverride
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

export type ImageOptimizerData = {
  thumbHash?: string | null
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
}
