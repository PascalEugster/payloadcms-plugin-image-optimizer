import fs from 'fs/promises'
import path from 'path'

import type { CollectionSlug } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { convertFormat } from '../processing/index.js'

export const createConvertFormatsHandler = (resolvedConfig: ResolvedImageOptimizerConfig) => {
  return async ({ input, req }: { input: { collectionSlug: string; docId: string }; req: any }) => {
    try {
      const doc = await req.payload.findByID({
        collection: input.collectionSlug as CollectionSlug,
        id: input.docId,
      })

      const collectionConfig = req.payload.collections[input.collectionSlug].config

      let staticDir: string = collectionConfig.upload.staticDir
      if (!path.isAbsolute(staticDir)) {
        staticDir = path.resolve(process.cwd(), staticDir)
      }

      const filePath = path.join(staticDir, doc.filename)
      const dir = path.dirname(filePath)
      const fileBuffer = await fs.readFile(filePath)

      const variants: Array<{
        filename: string
        filesize: number
        format: string
        height: number
        mimeType: string
        url: string
        width: number
      }> = []

      for (const format of resolvedConfig.formats) {
        const result = await convertFormat(fileBuffer, format.format, format.quality)
        const variantFilename = `${path.parse(doc.filename).name}-optimized.${format.format}`

        await fs.writeFile(path.join(dir, variantFilename), result.buffer)

        variants.push({
          format: format.format,
          filename: variantFilename,
          filesize: result.size,
          width: result.width,
          height: result.height,
          mimeType: result.mimeType,
          url: `/api/${input.collectionSlug}/file/${variantFilename}`,
        })
      }

      await req.payload.update({
        collection: input.collectionSlug as CollectionSlug,
        id: input.docId,
        data: {
          imageOptimizer: {
            status: 'complete',
            variants,
          },
        },
        context: { imageOptimizer_skip: true },
      })

      return { output: { variantsGenerated: variants.length } }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)

      await req.payload.update({
        collection: input.collectionSlug as CollectionSlug,
        id: input.docId,
        data: {
          imageOptimizer: {
            status: 'error',
            error: errorMessage,
          },
        },
        context: { imageOptimizer_skip: true },
      })

      throw err
    }
  }
}
