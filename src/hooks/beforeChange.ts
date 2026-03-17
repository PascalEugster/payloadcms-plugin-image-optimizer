import path from 'path'
import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { resolveCollectionConfig } from '../defaults.js'
import { convertFormat, generateThumbHash, stripAndResize } from '../processing/index.js'

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

    let finalBuffer = processed.buffer
    let finalSize = processed.size

    if (perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0) {
      // Convert to primary format (first in the formats array)
      const primaryFormat = perCollectionConfig.formats[0]
      const converted = await convertFormat(processed.buffer, primaryFormat.format, primaryFormat.quality)

      finalBuffer = converted.buffer
      finalSize = converted.size

      // Update filename and mimeType so Payload stores the correct metadata
      const originalFilename = data.filename || req.file.name || ''
      const newFilename = `${path.parse(originalFilename).name}.${primaryFormat.format}`
      context.imageOptimizer_originalFilename = originalFilename
      data.filename = newFilename
      data.mimeType = converted.mimeType
      data.filesize = finalSize
    }

    data.imageOptimizer = {
      originalSize,
      optimizedSize: finalSize,
      status: 'pending',
    }

    if (resolvedConfig.generateThumbHash) {
      data.imageOptimizer.thumbHash = await generateThumbHash(finalBuffer)
    }

    // Write processed buffer back to req.file so cloud storage adapters
    // (which read req.file in their afterChange hook) upload the optimized version.
    // Payload's own uploadFiles step does NOT re-read req.file.data for its local
    // disk write, so we also store the buffer in context for our afterChange hook
    // to overwrite the local file when local storage is enabled.
    req.file.data = finalBuffer
    req.file.size = finalSize
    if (perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0) {
      req.file.name = data.filename
      req.file.mimetype = data.mimeType
    }
    context.imageOptimizer_processedBuffer = finalBuffer

    return data
  }
}
