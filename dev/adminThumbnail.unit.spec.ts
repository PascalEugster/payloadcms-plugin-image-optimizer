import { describe, expect, test } from 'vitest'

import { imageOptimizer } from '../src/index.js'

/**
 * Unit tests for the `adminThumbnail` plugin option.
 *
 * The plugin function is a `(config) => config` transform — we feed it a
 * minimal Payload config (with one upload collection) and assert the resulting
 * `collection.upload.adminThumbnail` shape.
 */

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

describe('adminThumbnail injection', () => {
  test("'auto' (default) injects a function that returns a URL from doc.filename", () => {
    const upload = runPlugin({ collections: { media: true } })

    expect(typeof upload.adminThumbnail).toBe('function')

    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    expect(fn({ doc: { filename: 'photo.webp' } })).toBe('/media/photo.webp')
    expect(fn({ doc: { filename: 'nested-name.webp' } })).toBe('/media/nested-name.webp')
    // Survives extension change (the v2 motivation): same function works for
    // both .jpg and .webp because it reads `doc.filename` at runtime.
    expect(fn({ doc: { filename: 'legacy.jpg' } })).toBe('/media/legacy.jpg')
  })

  test("'auto' falls back to /<slug>/ when no staticDir is configured", () => {
    // No staticDir on the upload — the closure should fall back to the slug.
    const result = imageOptimizer({ collections: { media: true } })({
      collections: [{ slug: 'media', fields: [], upload: {} }],
    } as any)
    const upload = (result.collections?.[0] as any).upload
    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    expect(fn({ doc: { filename: 'a.webp' } })).toBe('/media/a.webp')
  })

  test("'auto' returns null when doc.filename is missing", () => {
    const upload = runPlugin({ collections: { media: true } })
    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    expect(fn({ doc: {} })).toBeNull()
    expect(fn({ doc: { filename: null } })).toBeNull()
  })

  test('string mode passes through to Payload as a size-name reference', () => {
    const upload = runPlugin({
      collections: { media: true },
      adminThumbnail: 'thumbnail',
    })
    expect(upload.adminThumbnail).toBe('thumbnail')
  })

  test('function mode passes through to Payload as-is', () => {
    const customFn = ({ doc }: { doc: { filename?: string | null } }) =>
      doc.filename ? `https://cdn.example.com/${doc.filename}` : null

    const upload = runPlugin({
      collections: { media: true },
      adminThumbnail: customFn,
    })
    expect(upload.adminThumbnail).toBe(customFn)
  })

  test('non-override: leaves user-provided upload.adminThumbnail intact', () => {
    const userFn = () => 'user-set'
    const upload = runPlugin(
      { collections: { media: true } /* default 'auto' */ },
      { adminThumbnail: userFn },
    )
    expect(upload.adminThumbnail).toBe(userFn)
  })

  test('non-override: leaves user string adminThumbnail intact even when plugin set to "auto"', () => {
    const upload = runPlugin(
      { collections: { media: true }, adminThumbnail: 'auto' },
      { adminThumbnail: 'thumbnail' },
    )
    expect(upload.adminThumbnail).toBe('thumbnail')
  })
})
