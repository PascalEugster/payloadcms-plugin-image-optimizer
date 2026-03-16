import type { Config } from 'payload'

import type { ImageOptimizerConfig } from './types.js'
import { resolveConfig } from './defaults.js'
import { getImageOptimizerField } from './fields/imageOptimizerField.js'
import { createBeforeChangeHook } from './hooks/beforeChange.js'
import { createAfterChangeHook } from './hooks/afterChange.js'
import { createConvertFormatsHandler } from './tasks/convertFormats.js'

export type { ImageOptimizerConfig, ImageFormat, FormatQuality, CollectionOptimizerConfig } from './types.js'

export { encodeImageToThumbHash, decodeThumbHashToDataURL } from './utilities/thumbhash.js'

export const imageOptimizer =
  (pluginOptions: ImageOptimizerConfig) =>
  (config: Config): Config => {
    const resolvedConfig = resolveConfig(pluginOptions)

    if (!config.collections) {
      config.collections = []
    }

    // Inject imageOptimizer fields into targeted upload collections
    for (const collectionSlug in resolvedConfig.collections) {
      const collection = config.collections.find((c) => c.slug === collectionSlug)

      if (collection) {
        collection.fields.push(getImageOptimizerField())
      }
    }

    // If disabled, keep fields for schema consistency but skip hooks/tasks
    if (resolvedConfig.disabled) {
      return config
    }

    // Inject hooks into targeted upload collections
    for (const collectionSlug in resolvedConfig.collections) {
      const collection = config.collections.find((c) => c.slug === collectionSlug)

      if (collection) {
        if (!collection.hooks) {
          collection.hooks = {}
        }

        if (!collection.hooks.beforeChange) {
          collection.hooks.beforeChange = []
        }
        collection.hooks.beforeChange.push(createBeforeChangeHook(resolvedConfig, collectionSlug))

        if (!collection.hooks.afterChange) {
          collection.hooks.afterChange = []
        }
        collection.hooks.afterChange.push(createAfterChangeHook(resolvedConfig, collectionSlug))
      }
    }

    // Register async format conversion job task
    if (!config.jobs) {
      config.jobs = { tasks: [] }
    }
    if (!config.jobs!.tasks) {
      config.jobs!.tasks = []
    }

    config.jobs!.tasks!.push({
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
    } as any)

    return config
  }
