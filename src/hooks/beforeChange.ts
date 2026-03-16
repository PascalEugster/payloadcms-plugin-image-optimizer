import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { resolveCollectionConfig } from '../defaults.js'
import { generateBlurDataURL, stripAndResize } from '../processing/index.js'

export const createBeforeChangeHook = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): CollectionBeforeChangeHook => {
  return async ({ context, data, req }) => {
    if (context?.imageOptimizer_skip) return data

    if (!req.file || !req.file.data || !req.file.mimetype?.startsWith('image/')) return data

    const originalSize = req.file.data.length

    const perCollectionConfig = resolveCollectionConfig(resolvedConfig, collectionSlug)

    // Process in memory: strip EXIF, resize, generate blur
    const processed = await stripAndResize(
      req.file.data,
      perCollectionConfig.maxDimensions,
      resolvedConfig.stripMetadata,
    )

    data.imageOptimizer = {
      originalSize,
      optimizedSize: processed.size,
      status: 'pending',
    }

    if (resolvedConfig.generateBlurPlaceholder) {
      data.imageOptimizer.blurDataURL = await generateBlurDataURL(processed.buffer)
    }

    // Store processed buffer in context for afterChange to write to disk
    // (Payload 3.0 does not use modified req.file.data for the disk write)
    context.imageOptimizer_processedBuffer = processed.buffer

    return data
  }
}
