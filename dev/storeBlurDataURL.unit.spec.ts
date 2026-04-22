import type { Field, GroupField } from 'payload'

import { describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createBeforeChangeHook } from '../src/hooks/beforeChange.js'
import { imageOptimizer } from '../src/index.js'
import { getImageOptimizerProps } from '../src/utilities/getImageOptimizerProps.js'
import { encodeImageToThumbHash } from '../src/utilities/thumbhash.js'

/**
 * Unit tests for the `storeBlurDataURL` plugin option.
 *
 * When enabled, the plugin pre-decodes the ThumbHash-derived base64 PNG
 * `blurDataURL` at upload time and stores it on the media document so
 * `getImageOptimizerProps()` can read it directly instead of decoding on every
 * render. The flag is opt-in (default `false`). This spec covers the resolver
 * default, the `imageOptimizer` group field injection (including the
 * `fieldsOverride` interaction), and the runtime preference order inside
 * `getImageOptimizerProps` — stored value beats thumbhash beats empty.
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
  return media as Record<string, unknown>
}

const getOptimizerGroup = (
  pluginOpts: Parameters<typeof imageOptimizer>[0],
): GroupField => {
  const media = runPlugin(pluginOpts)
  const fields = (media.fields as Field[]) ?? []
  const group = fields.find(
    (f): f is GroupField =>
      (f as { type?: string }).type === 'group' &&
      (f as { name?: string }).name === 'imageOptimizer',
  )
  if (!group) {throw new Error('imageOptimizer group field not found')}
  return group
}

describe('storeBlurDataURL resolver default', () => {
  test('defaults to false when omitted', () => {
    const resolved = resolveConfig({ collections: { media: true } })
    expect(resolved.storeBlurDataURL).toBe(false)
  })

  test('honors explicit false', () => {
    const resolved = resolveConfig({
      collections: { media: true },
      storeBlurDataURL: false,
    })
    expect(resolved.storeBlurDataURL).toBe(false)
  })

  test('honors explicit true', () => {
    const resolved = resolveConfig({
      collections: { media: true },
      storeBlurDataURL: true,
    })
    expect(resolved.storeBlurDataURL).toBe(true)
  })
})

describe('storeBlurDataURL field injection', () => {
  test('flag off (default) — imageOptimizer group has no blurDataURL sub-field', () => {
    const group = getOptimizerGroup({ collections: { media: true } })
    const names = group.fields.map((f) => (f as { name?: string }).name)
    expect(names).toEqual(['thumbHash', 'originalSize', 'optimizedSize', 'status', 'error'])
    expect(names).not.toContain('blurDataURL')
  })

  test('flag on — group contains a blurDataURL text field marked hidden + readOnly', () => {
    const group = getOptimizerGroup({
      collections: { media: true },
      storeBlurDataURL: true,
    })
    const blur = group.fields.find(
      (f) => (f as { name?: string }).name === 'blurDataURL',
    ) as { admin?: { hidden?: boolean; readOnly?: boolean }; name: string; type: string } | undefined

    expect(blur).toBeDefined()
    expect(blur?.type).toBe('text')
    expect(blur?.admin?.hidden).toBe(true)
    expect(blur?.admin?.readOnly).toBe(true)
  })

  test('flag on + fieldsOverride that spreads defaultFields — emitted fields include blurDataURL', () => {
    const group = getOptimizerGroup({
      collections: { media: true },
      fieldsOverride: ({ defaultFields }) => [
        ...defaultFields,
        { name: 'customExtra', type: 'text' },
      ],
      storeBlurDataURL: true,
    })
    const names = group.fields.map((f) => (f as { name?: string }).name)
    expect(names).toContain('blurDataURL')
    // blurDataURL is the last of the defaults, followed by the consumer's custom field
    const blurIdx = names.indexOf('blurDataURL')
    const customIdx = names.indexOf('customExtra')
    expect(blurIdx).toBeGreaterThan(-1)
    expect(customIdx).toBeGreaterThan(blurIdx)
  })

  test('flag on + fieldsOverride returning a custom array — override wins (no blurDataURL unless consumer includes it)', () => {
    const group = getOptimizerGroup({
      collections: { media: true },
      fieldsOverride: () => [
        { name: 'onlyThis', type: 'text' },
      ],
      storeBlurDataURL: true,
    })
    const names = group.fields.map((f) => (f as { name?: string }).name)
    expect(names).toEqual(['onlyThis'])
    expect(names).not.toContain('blurDataURL')
  })
})

describe('getImageOptimizerProps stored value preference', () => {
  // Build a real, decode-able thumbhash for the back-compat path. An 8x8 solid
  // opaque RGBA buffer is enough for `rgbaToThumbHash` to produce valid output.
  const buildValidThumbHash = () => {
    const width = 8
    const height = 8
    const buffer = Buffer.alloc(width * height * 4)
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 120
      buffer[i + 1] = 180
      buffer[i + 2] = 220
      buffer[i + 3] = 255
    }
    return encodeImageToThumbHash(buffer, width, height)
  }

  test('stored blurDataURL is preferred — invalid thumbHash is NOT decoded when a stored value is present', () => {
    const stored = 'data:image/png;base64,STORED_VALUE_MARKER'
    const resource = {
      imageOptimizer: {
        // Deliberately invalid base64 — if the function fell through to decode
        // this, it would throw (and land on the empty placeholder), proving the
        // stored value was NOT preferred.
        blurDataURL: stored,
        thumbHash: '!!!not-valid-base64!!!',
      },
    }
    const result = getImageOptimizerProps(resource as any)
    expect(result.placeholder).toBe('blur')
    expect(result.blurDataURL).toBe(stored)
  })

  test('back-compat: no stored blurDataURL but a valid thumbHash — decoded at runtime', () => {
    const thumbHash = buildValidThumbHash()
    const resource = {
      imageOptimizer: {
        thumbHash,
      },
    }
    const result = getImageOptimizerProps(resource as any)
    expect(result.placeholder).toBe('blur')
    expect(typeof result.blurDataURL).toBe('string')
    expect(result.blurDataURL).toMatch(/^data:image\/png;base64,/)
  })

  test('neither stored blurDataURL nor thumbHash — placeholder is empty', () => {
    const resource = {
      imageOptimizer: {},
    }
    const result = getImageOptimizerProps(resource as any)
    expect(result.placeholder).toBe('empty')
    expect(result.blurDataURL).toBeUndefined()
  })

  test('empty-string blurDataURL falls through to thumbhash decode (treat empty as absent)', () => {
    const thumbHash = buildValidThumbHash()
    const resource = {
      imageOptimizer: {
        blurDataURL: '',
        thumbHash,
      },
    }
    const result = getImageOptimizerProps(resource as any)
    expect(result.placeholder).toBe('blur')
    expect(typeof result.blurDataURL).toBe('string')
    expect(result.blurDataURL).toMatch(/^data:image\/png;base64,/)
  })

  test('focalX / focalY produce objectPosition regardless of which blur path runs', () => {
    const stored = 'data:image/png;base64,STORED_VALUE_MARKER'
    const thumbHash = buildValidThumbHash()

    // Stored-value path
    const withStored = getImageOptimizerProps({
      focalX: 25,
      focalY: 75,
      imageOptimizer: { blurDataURL: stored, thumbHash: '!!!invalid!!!' },
    } as any)
    expect(withStored.style.objectPosition).toBe('25% 75%')
    expect(withStored.placeholder).toBe('blur')

    // Thumbhash-decode path
    const withThumbHash = getImageOptimizerProps({
      focalX: 10,
      focalY: 90,
      imageOptimizer: { thumbHash },
    } as any)
    expect(withThumbHash.style.objectPosition).toBe('10% 90%')
    expect(withThumbHash.placeholder).toBe('blur')

    // Empty path
    const empty = getImageOptimizerProps({
      focalX: 50,
      focalY: 50,
      imageOptimizer: {},
    } as any)
    expect(empty.style.objectPosition).toBe('50% 50%')
    expect(empty.placeholder).toBe('empty')
  })
})

describe('beforeChange hook — upload-time blurDataURL population', () => {
  // A small JPEG buffer sharp can metadata/decode — this is the same shape the
  // real upload pipeline hands to the hook, so it exercises the full
  // `generateThumbHash` → `decodeThumbHashToDataURL` path.
  const buildJpeg = async (): Promise<Buffer> => {
    const { default: sharp } = await import('sharp')
    return sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 120, g: 180, b: 220 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer()
  }

  const invokeHook = async (
    opts: Parameters<typeof imageOptimizer>[0],
    buffer: Buffer,
  ) => {
    const resolved = resolveConfig(opts)
    const hook = createBeforeChangeHook(resolved, 'media')
    const data: Record<string, any> = {}
    const req = {
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: 'test.jpg',
        size: buffer.length,
      },
    }
    await hook({ context: {}, data, operation: 'create', req } as any)
    return data
  }

  test('flag off (default) — hook does NOT set blurDataURL', async () => {
    const buffer = await buildJpeg()
    const data = await invokeHook({ collections: { media: true } }, buffer)
    expect(data.imageOptimizer?.thumbHash).toEqual(expect.any(String))
    expect(data.imageOptimizer?.blurDataURL).toBeUndefined()
  })

  test('flag on — hook populates blurDataURL with a decoded data URL', async () => {
    const buffer = await buildJpeg()
    const data = await invokeHook(
      { collections: { media: true }, storeBlurDataURL: true },
      buffer,
    )
    expect(data.imageOptimizer?.thumbHash).toEqual(expect.any(String))
    expect(data.imageOptimizer?.blurDataURL).toMatch(/^data:image\/png;base64,/)
    // Non-trivial payload — a real decoded PNG is at least a few hundred bytes.
    expect((data.imageOptimizer.blurDataURL as string).length).toBeGreaterThan(200)
  })

  test('flag on but generateThumbHash off — blurDataURL stays absent (derived field has no source)', async () => {
    const buffer = await buildJpeg()
    const data = await invokeHook(
      {
        collections: { media: true },
        generateThumbHash: false,
        storeBlurDataURL: true,
      },
      buffer,
    )
    expect(data.imageOptimizer?.thumbHash).toBeUndefined()
    expect(data.imageOptimizer?.blurDataURL).toBeUndefined()
  })
})
