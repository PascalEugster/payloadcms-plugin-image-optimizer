import type { Config } from 'payload'
import { deepMergeSimple } from 'payload/shared'

import type { ImageOptimizerConfig } from './types.js'
import { resolveCollectionConfig, resolveConfig } from './defaults.js'
import { translations } from './translations/index.js'
import { getImageOptimizerField } from './fields/imageOptimizerField.js'
import { createBeforeChangeHook } from './hooks/beforeChange.js'
import { createBeforeOperationHook } from './hooks/beforeOperation.js'
import { createAfterChangeHook } from './hooks/afterChange.js'
import { createConvertFormatsHandler } from './tasks/convertFormats.js'
import { createRegenerateDocumentHandler } from './tasks/regenerateDocument.js'
import { createRegenerateHandler, createRegenerateStatusHandler, createCancelHandler } from './endpoints/regenerate.js'

export type { ImageOptimizerConfig, ImageFormat, FormatQuality, CollectionOptimizerConfig, ImageOptimizerData, MediaResource, MediaSizeVariant, FieldsOverride, GenerateFilename, GenerateFilenameArgs } from './types.js'
export { defaultImageOptimizerFields } from './fields/imageOptimizerField.js'

export { encodeImageToThumbHash, decodeThumbHashToDataURL } from './utilities/thumbhash.js'
export { uuidFilename, seoFilename } from './utilities/filenameStrategies.js'

/**
 * Recommended maxDuration for the Payload API route on Vercel.
 * Re-export this in your route file:
 *
 *   export { maxDuration } from '@inoo-ch/payload-image-optimizer'
 */
export const maxDuration = 60

export const imageOptimizer =
  (pluginOptions: ImageOptimizerConfig) =>
  (config: Config): Config => {
    const resolvedConfig = resolveConfig(pluginOptions)
    const targetSlugs = Object.keys(resolvedConfig.collections)

    // Inject fields (and hooks when enabled) into targeted upload collections
    const collections = (config.collections || []).map((collection) => {
      if (!targetSlugs.includes(collection.slug)) {
        return collection
      }

      // Always inject fields for schema consistency (even when disabled)
      const fields = [...collection.fields, getImageOptimizerField(pluginOptions.fieldsOverride)]

      if (resolvedConfig.disabled) {
        return { ...collection, fields }
      }

      // ──────────────────────────────────────────────────────────────────────────
      // v2 — Config-injection: hand off resize / format conversion / metadata
      // strip to Payload's native generateFileData() pipeline. The plugin only
      // owns ThumbHash, status tracking, optional filename strategy, and
      // additive multi-format variants (e.g. AVIF alongside the WebP primary).
      //
      // Non-override rule: if the user already set any of these on their
      // collection, we leave their value intact.
      // ──────────────────────────────────────────────────────────────────────────
      // Only inject upload-pipeline config when the collection actually has an
      // upload. Targeting a non-upload collection is treated as a misconfig
      // for everything except field/hook injection.
      const hasUploadConfig = collection.upload != null && collection.upload !== false
      const perCollectionConfig = resolveCollectionConfig(resolvedConfig, collection.slug)
      const userUpload =
        typeof collection.upload === 'object' && collection.upload !== null
          ? collection.upload
          : ({} as Record<string, unknown>)

      const primaryFormat = perCollectionConfig.formats[0]

      const injectedUpload: Record<string, unknown> = { ...userUpload }

      // Parent format conversion — only when replaceOriginal AND a format is configured
      if (
        perCollectionConfig.replaceOriginal &&
        primaryFormat &&
        userUpload.formatOptions === undefined
      ) {
        injectedUpload.formatOptions = {
          format: primaryFormat.format,
          options: { quality: primaryFormat.quality },
        }
      }

      // Resize parent
      if (userUpload.resizeOptions === undefined) {
        injectedUpload.resizeOptions = {
          width: perCollectionConfig.maxDimensions.width,
          height: perCollectionConfig.maxDimensions.height,
          fit: 'inside',
          withoutEnlargement: true,
        }
      }

      // Metadata policy — `metadataPolicy` (callback) takes precedence over the
      // simple `stripMetadata` boolean. Both honor the non-override rule.
      if (userUpload.withMetadata === undefined) {
        if (resolvedConfig.metadataPolicy) {
          injectedUpload.withMetadata = resolvedConfig.metadataPolicy
        } else if (resolvedConfig.stripMetadata) {
          injectedUpload.withMetadata = false
        }
      }

      // adminThumbnail — when the user hasn't already set one on the collection.
      // - 'auto' (default): function form that returns Payload's canonical file
      //   URL from `doc.filename`, surviving the v2 parent-extension change.
      // - string / function: pass through.
      //
      // Note: Payload's `upload.staticDir` is a filesystem path, not a URL
      // prefix. The URL Payload serves files from is `/api/{slug}/file/{name}`
      // (see the per-size `url` fields). We build that pattern here.
      if (userUpload.adminThumbnail === undefined) {
        const opt = resolvedConfig.adminThumbnail
        if (opt === 'auto') {
          const slug = collection.slug
          injectedUpload.adminThumbnail = ({ doc }: { doc: Record<string, unknown> }) => {
            const filename = (doc as { filename?: string | null }).filename
            if (!filename) return null
            return `/api/${slug}/file/${filename}`
          }
        } else if (typeof opt === 'string' || typeof opt === 'function') {
          injectedUpload.adminThumbnail = opt
        }
      }

      // responseHeaders — opt-in cache header policy for file responses.
      if (userUpload.modifyResponseHeaders === undefined) {
        const opt = resolvedConfig.responseHeaders
        if (opt === 'immutable') {
          // Long-lived immutable caching is only safe when filenames are stable
          // (UUID / content-hashed). Without `generateFilename`, a re-uploaded
          // file under the same name would be served stale by intermediaries
          // for up to a year. Warn loudly at init rather than silently shipping
          // a footgun.
          if (!resolvedConfig.generateFilename) {
            const logger = (config as unknown as {
              logger?: { warn?: (msg: string) => void }
            }).logger
            const msg =
              `[image-optimizer] responseHeaders: 'immutable' is enabled on collection "${collection.slug}" ` +
              `without a custom generateFilename. Re-uploads under the same filename will be cached as ` +
              `immutable for 1 year and served stale. Use generateFilename: uuidFilename (or seoFilename) ` +
              `to make filenames content-stable.`
            if (logger?.warn) {
              logger.warn(msg)
            } else {
              // eslint-disable-next-line no-console
              console.warn(msg)
            }
          }
          injectedUpload.modifyResponseHeaders = ({ headers }: { headers: Headers }) => {
            headers.set('Cache-Control', 'public, max-age=31536000, immutable')
            return headers
          }
        } else if (typeof opt === 'function') {
          // Pass-through: adapt our (headers, args) signature to Payload's ({ headers })
          // shape. Payload doesn't currently pass `doc`, so we emit a placeholder.
          injectedUpload.modifyResponseHeaders = ({ headers }: { headers: Headers }) =>
            opt(headers, { doc: undefined }) ?? headers
        }
      }

      // Per-size format conversion — inject formatOptions on each imageSize that
      // doesn't already have one. Payload's createImageSizes derives the size
      // filename extension from the produced buffer's MIME type, so injecting
      // formatOptions causes sizes to land as `.webp` automatically.
      //
      // TODO(generateImageName): a richer per-size custom-naming injection was
      // descoped because Payload's `generateImageName` callback runs without
      // access to the document `data` (no altText, no MIME type beyond what
      // can be derived from `extension`). The user's `generateFilename`
      // strategies (especially `seoFilename`) need that runtime context to
      // produce meaningful names. Without it the only safe option is to derive
      // size names from the parent's `originalName`, which Payload already does
      // by default. Revisit if/when Payload exposes `data` to `generateImageName`.
      if (primaryFormat && Array.isArray(userUpload.imageSizes)) {
        injectedUpload.imageSizes = (userUpload.imageSizes as Array<Record<string, unknown>>).map(
          (size) => {
            if (size.formatOptions !== undefined) return size
            return {
              ...size,
              formatOptions: {
                format: primaryFormat.format,
                options: { quality: primaryFormat.quality },
              },
            }
          },
        )
      }

      return {
        ...collection,
        fields,
        ...(hasUploadConfig ? { upload: injectedUpload } : {}),
        hooks: {
          ...collection.hooks,
          beforeOperation: [
            ...(collection.hooks?.beforeOperation || []),
            createBeforeOperationHook(),
          ],
          beforeChange: [
            ...(collection.hooks?.beforeChange || []),
            createBeforeChangeHook(resolvedConfig, collection.slug),
          ],
          afterChange: [
            ...(collection.hooks?.afterChange || []),
            createAfterChangeHook(resolvedConfig, collection.slug),
          ],
        },
        admin: {
          ...collection.admin,
          components: {
            ...collection.admin?.components,
            ...(resolvedConfig.clientOptimization && !collection.admin?.components?.edit?.Upload
              ? {
                  edit: {
                    ...collection.admin?.components?.edit,
                    Upload: '@inoo-ch/payload-image-optimizer/client#UploadOptimizer',
                  },
                }
              : {}),
            ...(resolvedConfig.regenerateButton.enabled
            ? {
                beforeListTable: [
                  ...(collection.admin?.components?.beforeListTable || []),
                  '@inoo-ch/payload-image-optimizer/client#RegenerationButton',
                ],
              }
            : {}),
          },
        },
      }
    })

    const i18n = {
      ...config.i18n,
      translations: deepMergeSimple(translations, config.i18n?.translations ?? {}),
    }

    // If disabled, return with fields injected but no tasks/endpoints
    if (resolvedConfig.disabled) {
      return { ...config, collections, i18n }
    }

    return {
      ...config,
      collections,
      globals: [
        ...(config.globals || []),
        {
          slug: 'image-optimizer-state',
          admin: { hidden: true },
          access: { read: () => true, update: () => true },
          fields: [
            { name: 'collections', type: 'json' },
          ],
        },
      ],
      i18n,
      jobs: {
        ...config.jobs,
        tasks: [
          ...(config.jobs?.tasks || []),
          {
            slug: 'imageOptimizer_convertFormats',
            inputSchema: [
              { name: 'collectionSlug', type: 'text', required: true },
              { name: 'docId', type: 'text', required: true },
            ],
            outputSchema: [
              { name: 'variantsGenerated', type: 'number' },
            ],
            retries: 2,
            handler: createConvertFormatsHandler(resolvedConfig),
          } as any,
          {
            slug: 'imageOptimizer_regenerateDocument',
            inputSchema: [
              { name: 'collectionSlug', type: 'text', required: true },
              { name: 'docId', type: 'text', required: true },
            ],
            outputSchema: [
              { name: 'status', type: 'text' },
              { name: 'reason', type: 'text' },
            ],
            retries: 2,
            handler: createRegenerateDocumentHandler(resolvedConfig),
          } as any,
        ],
      },
      endpoints: [
        ...(config.endpoints ?? []),
        {
          path: '/image-optimizer/regenerate',
          method: 'post',
          handler: createRegenerateHandler(resolvedConfig),
        },
        {
          path: '/image-optimizer/regenerate',
          method: 'get',
          handler: createRegenerateStatusHandler(resolvedConfig),
        },
        {
          path: '/image-optimizer/regenerate',
          method: 'delete',
          handler: createCancelHandler(resolvedConfig),
        },
      ],
    }
  }
