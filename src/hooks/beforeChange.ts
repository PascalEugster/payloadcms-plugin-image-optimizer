import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { generateBlurDataURL, stripAndResize } from '../processing/index.js'

export const createBeforeChangeHook = (
  resolvedConfig: ResolvedImageOptimizerConfig,
): CollectionBeforeChangeHook => {
  return async ({ context, data, req }) => {
    if (context?.imageOptimizer_skip) return data

    if (!req.file || !req.file.mimetype?.startsWith('image/')) return data

    const originalSize = req.file.data.length

    // Process in memory for blur placeholder and size calculations
    const processed = await stripAndResize(
      req.file.data,
      resolvedConfig.maxDimensions,
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

    // Store the processed buffer in context so afterChange can use it to overwrite the file on disk
    context.imageOptimizer_processedBuffer = processed.buffer

    return data
  }
}
