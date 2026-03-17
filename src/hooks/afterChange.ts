import fs from 'fs/promises'
import path from 'path'
import type { CollectionAfterChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { resolveCollectionConfig } from '../defaults.js'
import { resolveStaticDir } from '../utilities/resolveStaticDir.js'

export const createAfterChangeHook = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): CollectionAfterChangeHook => {
  return async ({ context, doc, req }) => {
    if (context?.imageOptimizer_skip) return doc

    if (!req.file || !req.file.data || !req.file.mimetype?.startsWith('image/')) return doc

    const collectionConfig = req.payload.collections[collectionSlug as keyof typeof req.payload.collections].config
    const staticDir = resolveStaticDir(collectionConfig)

    const perCollectionConfig = resolveCollectionConfig(resolvedConfig, collectionSlug)

    // Overwrite the file on disk with the processed (stripped/resized/converted) buffer
    // Payload 3.0 writes the original buffer to disk; we replace it here
    const processedBuffer = context.imageOptimizer_processedBuffer as Buffer | undefined
    if (processedBuffer && doc.filename && staticDir) {
      const safeFilename = path.basename(doc.filename as string)
      const filePath = path.join(staticDir, safeFilename)
      await fs.writeFile(filePath, processedBuffer)

      // If replaceOriginal changed the filename, clean up the old file Payload wrote
      const originalFilename = context.imageOptimizer_originalFilename as string | undefined
      if (originalFilename && originalFilename !== safeFilename) {
        const oldFilePath = path.join(staticDir, path.basename(originalFilename))
        await fs.unlink(oldFilePath).catch(() => {
          // Old file may not exist if Payload used the new filename
        })
      }
    }

    // When replaceOriginal is on and only one format is configured, the main file
    // is already converted — skip the async job and mark complete immediately.
    if (perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length <= 1) {
      await req.payload.update({
        collection: collectionSlug,
        id: doc.id,
        data: {
          imageOptimizer: {
            status: 'complete',
            variants: [],
          },
        },
        context: { imageOptimizer_skip: true },
      })
      return doc
    }

    // Queue async format conversion job for remaining variants
    await req.payload.jobs.queue({
      task: 'imageOptimizer_convertFormats',
      input: {
        collectionSlug,
        docId: String(doc.id),
      },
    })

    req.payload.jobs.run().catch((err: unknown) => {
      req.payload.logger.error({ err }, 'Image optimizer job runner failed')
    })

    return doc
  }
}
