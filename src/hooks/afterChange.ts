import fs from 'fs/promises'
import path from 'path'
import type { CollectionAfterChangeHook } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'

export const createAfterChangeHook = (
  resolvedConfig: ResolvedImageOptimizerConfig,
  collectionSlug: string,
): CollectionAfterChangeHook => {
  return async ({ context, doc, req }) => {
    if (context?.imageOptimizer_skip) return doc

    if (!req.file || !req.file.mimetype?.startsWith('image/')) return doc

    // Overwrite the file on disk with the processed (stripped/resized) buffer from beforeChange
    const processedBuffer = context.imageOptimizer_processedBuffer as Buffer | undefined
    if (processedBuffer && doc.filename) {
      const collectionConfig = req.payload.collections[collectionSlug].config
      let staticDir: string =
        typeof collectionConfig.upload === 'object' ? collectionConfig.upload.staticDir || '' : ''

      if (staticDir && !path.isAbsolute(staticDir)) {
        staticDir = path.resolve(process.cwd(), staticDir)
      }

      if (staticDir) {
        const filePath = path.join(staticDir, doc.filename as string)
        await fs.writeFile(filePath, processedBuffer)
      }
    }

    // Queue async format conversion job
    await req.payload.jobs.queue({
      task: 'imageOptimizer_convertFormats',
      input: {
        collectionSlug,
        docId: String(doc.id),
      },
    })

    void req.payload.jobs.run()

    return doc
  }
}
