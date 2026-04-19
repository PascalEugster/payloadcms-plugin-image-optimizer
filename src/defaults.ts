import type { CollectionSlug } from 'payload'

import type {
  ImageOptimizerConfig,
  ResolvedCollectionOptimizerConfig,
  ResolvedImageOptimizerConfig,
  ResolvedRegenerateButtonConfig,
} from './types.js'
import { uuidFilename } from './utilities/filenameStrategies.js'

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

/**
 * Resolve the generateFilename option:
 * - Explicit `generateFilename` callback takes priority
 * - `uniqueFileNames: true` maps to `uuidFilename` for backwards compat
 * - Otherwise undefined (keep original filename)
 */
const resolveGenerateFilename = (config: ImageOptimizerConfig) => {
  if (config.generateFilename) return config.generateFilename
  if (config.uniqueFileNames) return uuidFilename
  return undefined
}

export const resolveConfig = (config: ImageOptimizerConfig): ResolvedImageOptimizerConfig => ({
  clientOptimization: config.clientOptimization ?? true,
  collections: config.collections,
  disabled: config.disabled ?? false,
  formats: config.formats ?? [
    { format: 'webp', quality: 80 },
  ],
  generateFilename: resolveGenerateFilename(config),
  generateThumbHash: config.generateThumbHash ?? true,
  maxDimensions: config.maxDimensions ?? { width: 2560, height: 2560 },
  regenerateButton: resolveRegenerateButton(config.regenerateButton),
  replaceOriginal: config.replaceOriginal ?? true,
  stripMetadata: config.stripMetadata ?? true,
})

export const resolveCollectionConfig = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): ResolvedCollectionOptimizerConfig => {
  const collectionValue = resolvedConfig.collections[collectionSlug as CollectionSlug]

  if (!collectionValue || collectionValue === true) {
    return {
      formats: resolvedConfig.formats,
      maxDimensions: resolvedConfig.maxDimensions,
      replaceOriginal: resolvedConfig.replaceOriginal,
    }
  }

  return {
    formats: collectionValue.formats ?? resolvedConfig.formats,
    maxDimensions: collectionValue.maxDimensions ?? resolvedConfig.maxDimensions,
    replaceOriginal: collectionValue.replaceOriginal ?? resolvedConfig.replaceOriginal,
  }
}
