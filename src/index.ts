import type { Config } from 'payload'
import { deepMergeSimple } from 'payload/shared'

import type { ImageOptimizerConfig } from './types.js'
import { resolveConfig } from './defaults.js'
import { translations } from './translations/index.js'
import { getImageOptimizerField } from './fields/imageOptimizerField.js'
import { createBeforeChangeHook } from './hooks/beforeChange.js'
import { createAfterChangeHook } from './hooks/afterChange.js'
import { createConvertFormatsHandler } from './tasks/convertFormats.js'
import { createRegenerateDocumentHandler } from './tasks/regenerateDocument.js'
import { createRegenerateHandler, createRegenerateStatusHandler } from './endpoints/regenerate.js'

export type { ImageOptimizerConfig, ImageFormat, FormatQuality, CollectionOptimizerConfig, ImageOptimizerData, MediaResource, FieldsOverride } from './types.js'
export { defaultImageOptimizerFields } from './fields/imageOptimizerField.js'

export { encodeImageToThumbHash, decodeThumbHashToDataURL } from './utilities/thumbhash.js'

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

      return {
        ...collection,
        fields,
        hooks: {
          ...collection.hooks,
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
            beforeListTable: [
              ...(collection.admin?.components?.beforeListTable || []),
              '@inoo-ch/payload-image-optimizer/client#RegenerationButton',
            ],
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
      ],
    }
  }
