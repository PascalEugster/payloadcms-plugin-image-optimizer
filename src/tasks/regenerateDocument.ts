import fs from 'fs/promises'
import path from 'path'

import type { CollectionSlug } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { resolveCollectionConfig } from '../defaults.js'
import { stripAndResize, generateThumbHash, convertFormat } from '../processing/index.js'

export const createRegenerateDocumentHandler = (resolvedConfig: ResolvedImageOptimizerConfig) => {
  return async ({ input, req }: { input: { collectionSlug: string; docId: string }; req: any }) => {
    try {
      const doc = await req.payload.findByID({
        collection: input.collectionSlug as CollectionSlug,
        id: input.docId,
      })

      // Skip non-image documents
      if (!doc.mimeType || !doc.mimeType.startsWith('image/')) {
        return { output: { status: 'skipped', reason: 'not-image' } }
      }

      const collectionConfig = req.payload.collections[input.collectionSlug as keyof typeof req.payload.collections].config

      let staticDir: string =
        typeof collectionConfig.upload === 'object' ? collectionConfig.upload.staticDir || '' : ''
      if (!staticDir) {
        throw new Error(`No staticDir configured for collection "${input.collectionSlug}"`)
      }
      if (!path.isAbsolute(staticDir)) {
        staticDir = path.resolve(process.cwd(), staticDir)
      }

      // Sanitize filename to prevent path traversal
      const safeFilename = path.basename(doc.filename)
      const filePath = path.join(staticDir, safeFilename)

      let fileBuffer: Buffer
      try {
        fileBuffer = await fs.readFile(filePath)
      } catch {
        // If file not on disk, try fetching from URL
        if (doc.url) {
          const url = doc.url.startsWith('http')
            ? doc.url
            : `${process.env.NEXT_PUBLIC_SERVER_URL || ''}${doc.url}`
          const response = await fetch(url)
          fileBuffer = Buffer.from(await response.arrayBuffer())
        } else {
          throw new Error(`File not found: ${filePath}`)
        }
      }

      const originalSize = fileBuffer.length
      const perCollectionConfig = resolveCollectionConfig(resolvedConfig, input.collectionSlug)

      // Step 1: Strip metadata + resize
      const processed = await stripAndResize(
        fileBuffer,
        perCollectionConfig.maxDimensions,
        resolvedConfig.stripMetadata,
      )

      let mainBuffer = processed.buffer
      let mainSize = processed.size
      let newFilename = safeFilename
      let newMimeType: string | undefined

      // Step 1b: If replaceOriginal, convert main file to primary format
      if (perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0) {
        const primaryFormat = perCollectionConfig.formats[0]
        const converted = await convertFormat(processed.buffer, primaryFormat.format, primaryFormat.quality)
        mainBuffer = converted.buffer
        mainSize = converted.size
        newFilename = `${path.parse(safeFilename).name}.${primaryFormat.format}`
        newMimeType = converted.mimeType
      }

      // Write optimized file to disk
      const newFilePath = path.join(staticDir, newFilename)
      await fs.writeFile(newFilePath, mainBuffer)

      // Clean up old file if filename changed
      if (newFilename !== safeFilename) {
        await fs.unlink(filePath).catch(() => {})
      }

      // Step 2: Generate ThumbHash
      let thumbHash: string | undefined
      if (resolvedConfig.generateThumbHash) {
        thumbHash = await generateThumbHash(mainBuffer)
      }

      // Step 3: Convert to configured formats (skip primary when replaceOriginal)
      const formatsToGenerate = perCollectionConfig.replaceOriginal && perCollectionConfig.formats.length > 0
        ? perCollectionConfig.formats.slice(1)
        : perCollectionConfig.formats

      const variants: Array<{
        filename: string
        filesize: number
        format: string
        height: number
        mimeType: string
        url: string
        width: number
      }> = []

      for (const format of formatsToGenerate) {
        const result = await convertFormat(mainBuffer, format.format, format.quality)
        const variantFilename = `${path.parse(newFilename).name}-optimized.${format.format}`
        await fs.writeFile(path.join(staticDir, variantFilename), result.buffer)

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

      // Step 4: Update the document with all optimization data
      const updateData: Record<string, any> = {
        imageOptimizer: {
          originalSize,
          optimizedSize: mainSize,
          status: 'complete',
          thumbHash,
          variants,
          error: null,
        },
      }

      // Update filename and mimeType when replaceOriginal changed them
      if (newFilename !== safeFilename) {
        updateData.filename = newFilename
        updateData.mimeType = newMimeType
      }

      await req.payload.update({
        collection: input.collectionSlug as CollectionSlug,
        id: input.docId,
        data: updateData,
        context: { imageOptimizer_skip: true },
      })

      return { output: { status: 'complete' } }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)

      try {
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
      } catch (updateErr) {
        req.payload.logger.error(
          { err: updateErr },
          'Failed to persist error status for image optimizer regeneration',
        )
      }

      throw err
    }
  }
}
