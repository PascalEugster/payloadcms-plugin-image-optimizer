import fs from 'fs/promises'
import path from 'path'
import type { CollectionAfterChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { resolveCollectionConfig } from '../defaults.js'
import { resolveStaticDir } from '../utilities/resolveStaticDir.js'
import { isCloudStorage } from '../utilities/storage.js'

export const createAfterChangeHook = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): CollectionAfterChangeHook => {
  return async ({ context, doc, req }) => {
    if (context?.imageOptimizer_skip) return doc

    if (!req.file || !req.file.data || !req.file.mimetype?.startsWith('image/')) return doc

    const collectionConfig = req.payload.collections[collectionSlug as keyof typeof req.payload.collections].config
    const cloudStorage = isCloudStorage(collectionConfig)

    // When using local storage, overwrite the file on disk with the processed buffer.
    // Payload's uploadFiles step writes the original buffer; we replace it here.
    // When using cloud storage, skip — the cloud adapter's afterChange hook already
    // uploads the correct buffer from req.file.data (set in our beforeChange hook).
    if (!cloudStorage) {
      const staticDir = resolveStaticDir(collectionConfig)
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
    }

    const perCollectionConfig = resolveCollectionConfig(resolvedConfig, collectionSlug)

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

    // With cloud storage, variant files cannot be written — skip the async job
    // and mark complete. CDN-level image optimization (e.g. Next.js Image) can
    // serve alternative formats on the fly.
    if (cloudStorage) {
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

    // Queue async format conversion job for remaining variants (local storage only)
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
