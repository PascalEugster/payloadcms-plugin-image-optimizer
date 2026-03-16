import type { ImageOptimizerConfig, ResolvedImageOptimizerConfig } from './types.js'

export const resolveConfig = (config: ImageOptimizerConfig): ResolvedImageOptimizerConfig => ({
  collections: config.collections,
  disabled: config.disabled ?? false,
  formats: config.formats ?? [
    { format: 'webp', quality: 80 },
    { format: 'avif', quality: 65 },
  ],
  generateBlurPlaceholder: config.generateBlurPlaceholder ?? true,
  maxDimensions: config.maxDimensions ?? { width: 2560, height: 2560 },
  stripMetadata: config.stripMetadata ?? true,
})
