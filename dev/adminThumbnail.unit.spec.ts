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
  test("'auto' (default) injects a function that returns Payload's canonical file URL from doc.filename", () => {
    const upload = runPlugin({ collections: { media: true } })

    expect(typeof upload.adminThumbnail).toBe('function')

    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    expect(fn({ doc: { filename: 'photo.webp' } })).toBe('/api/media/file/photo.webp')
    expect(fn({ doc: { filename: 'nested-name.webp' } })).toBe('/api/media/file/nested-name.webp')
    // Survives extension change (the v2 motivation): same function works for
    // both .jpg and .webp because it reads `doc.filename` at runtime.
    expect(fn({ doc: { filename: 'legacy.jpg' } })).toBe('/api/media/file/legacy.jpg')
  })

  test("'auto' uses /api/<slug>/file/ pattern regardless of staticDir (which is a filesystem path, not a URL prefix)", () => {
    // staticDir might be an absolute filesystem path; we still emit Payload's URL pattern.
    const result = imageOptimizer({ collections: { media: true } })({
      collections: [
        { slug: 'media', fields: [], upload: { staticDir: '/var/data/media-files' } },
      ],
    } as any)
    const upload = (result.collections?.[0] as any).upload
    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    expect(fn({ doc: { filename: 'a.webp' } })).toBe('/api/media/file/a.webp')
  })

  test("'auto' returns null when doc.filename is missing", () => {
    const upload = runPlugin({ collections: { media: true } })
    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    expect(fn({ doc: {} })).toBeNull()
    expect(fn({ doc: { filename: null } })).toBeNull()
  })

  test("'auto' returns the smallest-by-width size URL when doc.sizes has multiple entries", () => {
    const upload = runPlugin({ collections: { media: true } })
    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    const doc = {
      filename: 'photo.webp',
      sizes: {
        thumbnail: { url: '/api/media/file/photo-300x200.webp', width: 300 },
        card: { url: '/api/media/file/photo-768x512.webp', width: 768 },
        tablet: { url: '/api/media/file/photo-1024x683.webp', width: 1024 },
      },
    }
    expect(fn({ doc })).toBe('/api/media/file/photo-300x200.webp')
  })

  test("'auto' falls back to parent filename URL when all doc.sizes entries have missing width or url", () => {
    const upload = runPlugin({ collections: { media: true } })
    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    const doc = {
      filename: 'photo.webp',
      sizes: {
        thumbnail: { url: null, width: 300 },
        card: { url: '/api/media/file/photo-768x512.webp', width: null },
        tablet: null,
        broken: undefined,
      },
    }
    expect(fn({ doc })).toBe('/api/media/file/photo.webp')
  })

  test("'auto' falls back to parent filename URL when doc.sizes is missing/undefined", () => {
    const upload = runPlugin({ collections: { media: true } })
    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    expect(fn({ doc: { filename: 'photo.webp' } })).toBe('/api/media/file/photo.webp')
    expect(fn({ doc: { filename: 'photo.webp', sizes: undefined } })).toBe(
      '/api/media/file/photo.webp',
    )
  })

  test("'auto' returns null when doc.filename is null AND sizes missing", () => {
    const upload = runPlugin({ collections: { media: true } })
    const fn = upload.adminThumbnail as (args: { doc: Record<string, unknown> }) => string | null
    expect(fn({ doc: { filename: null } })).toBeNull()
    expect(fn({ doc: { filename: null, sizes: undefined } })).toBeNull()
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
