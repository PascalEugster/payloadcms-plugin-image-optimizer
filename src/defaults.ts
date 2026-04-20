import type { CollectionSlug } from 'payload'

import type {
  ImageOptimizerConfig,
  ResolvedCollectionOptimizerConfig,
  ResolvedImageOptimizerConfig,
  ResolvedRegenerateButtonConfig,
} from './types.js'

const DEFAULT_FORMAT = { format: 'webp' as const, quality: 80 }

const resolveRegenerateButton = (
  value: ImageOptimizerConfig['regenerateButton'],
): ResolvedRegenerateButtonConfig => {
  if (value === false) return { enabled: false, allowForceAll: false }
  if (value === true || value == null) return { enabled: true, allowForceAll: false }
  return {
    enabled: value.enabled ?? true,
    allowForceAll: value.allowForceAll ?? false,
  }
}

export const resolveConfig = (config: ImageOptimizerConfig): ResolvedImageOptimizerConfig => ({
  adminThumbnail: config.adminThumbnail ?? 'auto',
  clientOptimization: config.clientOptimization ?? true,
  collections: config.collections,
  disabled: config.disabled ?? false,
  format: config.format === null ? null : (config.format ?? DEFAULT_FORMAT),
  generateFilename: config.generateFilename,
  generateThumbHash: config.generateThumbHash ?? true,
  maxDimensions: config.maxDimensions ?? { width: 2560, height: 2560 },
  metadataPolicy: config.metadataPolicy,
  regenerateButton: resolveRegenerateButton(config.regenerateButton),
  responseHeaders: config.responseHeaders ?? false,
  stripMetadata: config.stripMetadata ?? true,
})

export const resolveCollectionConfig = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): ResolvedCollectionOptimizerConfig => {
  const collectionValue = resolvedConfig.collections[collectionSlug as CollectionSlug]

  if (!collectionValue || collectionValue === true) {
    return {
      format: resolvedConfig.format,
      maxDimensions: resolvedConfig.maxDimensions,
    }
  }

  return {
    format: collectionValue.format ?? resolvedConfig.format,
    maxDimensions: collectionValue.maxDimensions ?? resolvedConfig.maxDimensions,
  }
}
