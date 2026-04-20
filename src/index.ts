import type { Config } from 'payload'

import { deepMergeSimple } from 'payload/shared'

import type { ImageOptimizerConfig } from './types.js'

import { resolveCollectionConfig, resolveConfig } from './defaults.js'
import { createCancelHandler, createRegenerateHandler, createRegenerateStatusHandler } from './endpoints/regenerate.js'
import { getImageOptimizerField } from './fields/imageOptimizerField.js'
import { createBeforeChangeHook } from './hooks/beforeChange.js'
import { createBeforeOperationHook } from './hooks/beforeOperation.js'
import { createRegenerateDocumentHandler } from './tasks/regenerateDocument.js'
import { translations } from './translations/index.js'

export { defaultImageOptimizerFields } from './fields/imageOptimizerField.js'
export type { CollectionOptimizerConfig, FieldsOverride, FormatQuality, GenerateFilename, GenerateFilenameArgs, ImageFormat, ImageOptimizerConfig, ImageOptimizerData, MediaResource, MediaSizeVariant } from './types.js'

export { seoFilename, timestampFilename, uuidFilename } from './utilities/filenameStrategies.js'
export { decodeThumbHashToDataURL, encodeImageToThumbHash } from './utilities/thumbhash.js'

/**
 * Recommended maxDuration for the Payload API route on Vercel.
 * Re-export this in your route file:
 *
 *   export { maxDuration } from '@inoo-ch/payload-image-optimizer'
 *
 * Set to 300 to match Vercel's current platform default (up from 60/90 in
 * earlier plans). Large-file regenerations routinely need more than 60s
 * between source download, sharp processing, and cloud-storage re-upload.
 * Consumers who want a tighter ceiling can set their own `export const
 * maxDuration = <n>` on the route file, which takes precedence.
 */
export const maxDuration = 300

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
      // Config-injection: hand off resize / format conversion / metadata strip
      // to Payload's native generateFileData() pipeline. The plugin only owns
      // ThumbHash, status tracking, optional filename strategy, and the
      // regeneration UI.
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

      const targetFormat = perCollectionConfig.format

      const injectedUpload: Record<string, unknown> = { ...userUpload }

      // Parent format conversion — inject when a format is configured and the
      // user hasn't supplied their own formatOptions.
      if (targetFormat && userUpload.formatOptions === undefined) {
        injectedUpload.formatOptions = {
          format: targetFormat.format,
          options: { quality: targetFormat.quality },
        }
      }

      // Resize parent
      if (userUpload.resizeOptions === undefined) {
        injectedUpload.resizeOptions = {
          fit: 'inside',
          height: perCollectionConfig.maxDimensions.height,
          width: perCollectionConfig.maxDimensions.width,
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
      // - 'auto' (default): function form that prefers the smallest
      //   pre-generated size's URL from `doc.sizes` (to avoid downloading the
      //   full parent file into a ~50px list row), falling back to Payload's
      //   canonical file URL from `doc.filename`. Surviving the v2
      //   parent-extension change.
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
            const filename = (doc as { filename?: null | string }).filename
            const sizes = (
              doc as {
                sizes?: Record<
                  string,
                  { url?: null | string; width?: null | number } | null | undefined
                >
              }
            ).sizes
            if (sizes) {
              let smallest: { url: string; width: number } | null = null
              for (const v of Object.values(sizes)) {
                if (!v) {continue}
                if (typeof v.url !== 'string' || typeof v.width !== 'number') {continue}
                if (!smallest || v.width < smallest.width) {
                  smallest = { url: v.url, width: v.width }
                }
              }
              if (smallest) {return smallest.url}
            }
            if (!filename) {return null}
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
      if (targetFormat && Array.isArray(userUpload.imageSizes)) {
        injectedUpload.imageSizes = (userUpload.imageSizes as Array<Record<string, unknown>>).map(
          (size) => {
            if (size.formatOptions !== undefined) {return size}
            return {
              ...size,
              formatOptions: {
                format: targetFormat.format,
                options: { quality: targetFormat.quality },
              },
            }
          },
        )
      }

      return {
        ...collection,
        fields,
        ...(hasUploadConfig ? { upload: injectedUpload } : {}),
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
        hooks: {
          ...collection.hooks,
          beforeChange: [
            ...(collection.hooks?.beforeChange || []),
            createBeforeChangeHook(resolvedConfig, collection.slug),
          ],
          beforeOperation: [
            ...(collection.hooks?.beforeOperation || []),
            createBeforeOperationHook(),
          ],
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
      endpoints: [
        ...(config.endpoints ?? []),
        {
          handler: createRegenerateHandler(resolvedConfig),
          method: 'post',
          path: '/image-optimizer/regenerate',
        },
        {
          handler: createRegenerateStatusHandler(resolvedConfig),
          method: 'get',
          path: '/image-optimizer/regenerate',
        },
        {
          handler: createCancelHandler(resolvedConfig),
          method: 'delete',
          path: '/image-optimizer/regenerate',
        },
      ],
      globals: [
        ...(config.globals || []),
        {
          slug: 'image-optimizer-state',
          access: { read: () => true, update: () => true },
          admin: { hidden: true },
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
            slug: 'imageOptimizer_regenerateDocument',
            handler: createRegenerateDocumentHandler(resolvedConfig),
            inputSchema: [
              { name: 'collectionSlug', type: 'text', required: true },
              { name: 'docId', type: 'text', required: true },
            ],
            outputSchema: [
              { name: 'status', type: 'text' },
              { name: 'reason', type: 'text' },
            ],
            retries: 2,
          } as any,
        ],
      },
    }
  }
