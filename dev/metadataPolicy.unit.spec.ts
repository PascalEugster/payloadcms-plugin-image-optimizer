import { describe, expect, test } from 'vitest'

import { imageOptimizer } from '../src/index.js'

const baseConfig = (collectionUpload: Record<string, unknown> = {}) =>
  ({
    collections: [
      {
        slug: 'media',
        fields: [],
        upload: { staticDir: 'media', ...collectionUpload },
      },
    ],
  }) as any

const runPlugin = (
  pluginOpts: Parameters<typeof imageOptimizer>[0],
  collectionUpload: Record<string, unknown> = {},
) => {
  const result = imageOptimizer(pluginOpts)(baseConfig(collectionUpload))
  const media = (result.collections ?? []).find((c) => c.slug === 'media')
  return media?.upload as Record<string, unknown>
}

describe('metadataPolicy injection', () => {
  test('default behavior: stripMetadata=true (default) injects withMetadata=false', () => {
    const upload = runPlugin({ collections: { media: true } })
    expect(upload.withMetadata).toBe(false)
  })

  test('stripMetadata=false leaves withMetadata undefined (Payload default = keep)', () => {
    const upload = runPlugin({ collections: { media: true }, stripMetadata: false })
    expect(upload.withMetadata).toBeUndefined()
  })

  test('metadataPolicy callback overrides stripMetadata and is passed through to withMetadata', () => {
    const policy = ({ metadata }: { metadata: any }) => metadata?.format === 'jpeg'

    const upload = runPlugin({
      collections: { media: true },
      stripMetadata: true, // would normally inject `false`, but policy wins
      metadataPolicy: policy,
    })

    expect(upload.withMetadata).toBe(policy)
    // Sanity-check: the callback behaves as documented (true keeps, false strips).
    expect((upload.withMetadata as typeof policy)({ metadata: { format: 'jpeg' } })).toBe(true)
    expect((upload.withMetadata as typeof policy)({ metadata: { format: 'png' } })).toBe(false)
  })

  test('metadataPolicy works even when stripMetadata is false', () => {
    const policy = () => true
    const upload = runPlugin({
      collections: { media: true },
      stripMetadata: false,
      metadataPolicy: policy,
    })
    expect(upload.withMetadata).toBe(policy)
  })

  test('non-override: user-provided upload.withMetadata wins over both stripMetadata and metadataPolicy', () => {
    const userValue = ({ metadata }: any) => Boolean(metadata)
    const upload = runPlugin(
      {
        collections: { media: true },
        stripMetadata: true,
        metadataPolicy: () => false,
      },
      { withMetadata: userValue },
    )
    expect(upload.withMetadata).toBe(userValue)
  })

  test('non-override holds for the boolean-only path too', () => {
    const upload = runPlugin(
      { collections: { media: true }, stripMetadata: true },
      { withMetadata: true }, // user explicitly wants metadata kept
    )
    expect(upload.withMetadata).toBe(true)
  })
})
