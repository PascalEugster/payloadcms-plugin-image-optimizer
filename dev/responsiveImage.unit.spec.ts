import { describe, expect, test } from 'vitest'

import type { MediaResource } from '../src/types.js'

import {
  createVariantLoader,
  findBestVariant,
  getValidVariants,
} from '../src/utilities/responsiveImage.js'

/**
 * Portrait source (1700×1365, aspect 1.2454) matching the real-world
 * "Pascal headshot" regression: a 4:3-ish source whose `og` (1200×630)
 * and `square` (500×500) Payload imageSizes leaked into the srcset and
 * produced a head-cropped render on `/ueber-uns`.
 */
const portraitMedia: MediaResource = {
  url: '/media/pascal.jpg',
  width: 1700,
  height: 1365,
  sizes: {
    thumbnail: { url: '/media/pascal-300.jpg', width: 300, height: 241 },
    small: { url: '/media/pascal-600.jpg', width: 600, height: 482 },
    medium: { url: '/media/pascal-900.jpg', width: 900, height: 723 },
    large: { url: '/media/pascal-1400.jpg', width: 1400, height: 1124 },
    og: { url: '/media/pascal-og.jpg', width: 1200, height: 630 },
    square: { url: '/media/pascal-square.jpg', width: 500, height: 500 },
  },
}

describe('getValidVariants', () => {
  test('drops variants whose aspect ratio does not match the source', () => {
    const variants = getValidVariants(portraitMedia)
    const urls = variants.map((v) => v.url)

    expect(urls).toEqual([
      '/media/pascal-300.jpg',
      '/media/pascal-600.jpg',
      '/media/pascal-900.jpg',
      '/media/pascal-1400.jpg',
    ])
    expect(urls).not.toContain('/media/pascal-og.jpg')
    expect(urls).not.toContain('/media/pascal-square.jpg')
  })

  test('keeps variants when source dimensions are missing (graceful degradation)', () => {
    const variants = getValidVariants({
      ...portraitMedia,
      width: null,
      height: null,
    })

    expect(variants.map((v) => v.url)).toContain('/media/pascal-og.jpg')
    expect(variants.map((v) => v.url)).toContain('/media/pascal-square.jpg')
  })

  test('keeps variants whose height is missing (cannot compute aspect)', () => {
    const variants = getValidVariants({
      url: '/media/x.jpg',
      width: 1000,
      height: 800,
      sizes: {
        legacy: { url: '/media/x-legacy.jpg', width: 500 },
      },
    })

    expect(variants.map((v) => v.url)).toContain('/media/x-legacy.jpg')
  })

  test('tolerates sub-pixel rounding drift from sharp', () => {
    // 1700×1365 → 1.2454, 1400×1124 → 1.2456. Drift ~0.02%, well under 3%.
    const variants = getValidVariants({
      url: '/media/x.jpg',
      width: 1700,
      height: 1365,
      sizes: {
        large: { url: '/media/x-1400.jpg', width: 1400, height: 1124 },
      },
    })

    expect(variants).toHaveLength(1)
  })

  test('returns [] when media has no sizes', () => {
    expect(getValidVariants({ url: '/media/x.jpg', width: 100, height: 100 })).toEqual([])
  })

  test('skips variants missing url or width', () => {
    const variants = getValidVariants({
      url: '/media/x.jpg',
      width: 1000,
      height: 1000,
      sizes: {
        noUrl: { width: 500, height: 500 },
        noWidth: { url: '/media/y.jpg', height: 500 },
        valid: { url: '/media/z.jpg', width: 500, height: 500 },
      },
    })

    expect(variants.map((v) => v.url)).toEqual(['/media/z.jpg'])
  })
})

describe('findBestVariant', () => {
  const variants = [
    { url: '/a.jpg', width: 300 },
    { url: '/b.jpg', width: 600 },
    { url: '/c.jpg', width: 1400 },
  ]

  test('picks smallest variant at or above the requested width', () => {
    expect(findBestVariant(variants, 500)?.url).toBe('/b.jpg')
    expect(findBestVariant(variants, 600)?.url).toBe('/b.jpg')
    expect(findBestVariant(variants, 1200)?.url).toBe('/c.jpg')
  })

  test('falls back to largest when it covers >= 80% of requested width', () => {
    // 1400 / 1600 = 0.875 ≥ 0.8
    expect(findBestVariant(variants, 1600)?.url).toBe('/c.jpg')
  })

  test('returns null when the largest variant is too small to be useful', () => {
    // 1400 / 2000 = 0.7 < 0.8
    expect(findBestVariant(variants, 2000)).toBeNull()
  })

  test('returns null for empty variants', () => {
    expect(findBestVariant([], 500)).toBeNull()
  })
})

describe('createVariantLoader', () => {
  test('serves only aspect-matched variants for the portrait regression case', () => {
    const loader = createVariantLoader(portraitMedia)
    expect(loader).toBeDefined()

    // Next.js requests widths around 1080/1200 for large responsive images.
    // Before the fix these picked `og` (1200×630). After the fix: `large` (1400×1124).
    const url1080 = loader!({ src: '/media/pascal.jpg', width: 1080 })
    const url1200 = loader!({ src: '/media/pascal.jpg', width: 1200 })

    expect(url1080).toContain('/media/pascal-1400.jpg')
    expect(url1200).toContain('/media/pascal-1400.jpg')
    expect(url1080).not.toContain('/media/pascal-og.jpg')
    expect(url1200).not.toContain('/media/pascal-og.jpg')
  })

  test('falls back to /_next/image when no aspect-matched variant covers the width', () => {
    const loader = createVariantLoader(portraitMedia)!
    // 3840 is far above the largest matched variant (1400); 1400/3840 = 0.36 < 0.8.
    const url = loader({ src: '/media/pascal.jpg', width: 3840, quality: 75 })

    expect(url).toMatch(/^\/_next\/image\?/)
    expect(url).toContain('w=3840')
    expect(url).toContain('q=75')
  })

  test('falls back to /_next/image WITHOUT a `q` param when quality is omitted', () => {
    // Regression: previously hardcoded `q=80`, which 400'd on any consumer
    // whose `next.config.images.qualities` didn't list 80. Default behavior
    // should defer to Next.js's server-side default (75), which is required
    // to be in the qualities array.
    const loader = createVariantLoader(portraitMedia)!
    const url = loader({ src: '/media/pascal.jpg', width: 3840 })

    expect(url).toMatch(/^\/_next\/image\?/)
    expect(url).toContain('w=3840')
    expect(url).not.toContain('q=')
  })

  test('falls back to /_next/image and passes through a non-default explicit quality', () => {
    const loader = createVariantLoader(portraitMedia)!
    const url = loader({ src: '/media/pascal.jpg', width: 3840, quality: 90 })

    expect(url).toContain('q=90')
    expect(url).not.toContain('q=80')
  })

  test('saturates to the largest variant when the source has no more pixels (skips /_next/image hop)', () => {
    // Source dimensions equal the largest variant — every pixel that exists
    // is already in the variant, so /_next/image would just round-trip the
    // same bytes through a server hop. Direct blob URL is strictly better.
    const saturatedMedia: MediaResource = {
      url: '/media/saturated.jpg',
      width: 1400,
      height: 1124,
      sizes: {
        thumbnail: { url: '/media/saturated-300.jpg', width: 300, height: 241 },
        small: { url: '/media/saturated-600.jpg', width: 600, height: 482 },
        medium: { url: '/media/saturated-900.jpg', width: 900, height: 723 },
        large: { url: '/media/saturated-1400.jpg', width: 1400, height: 1124 },
      },
    }
    const loader = createVariantLoader(saturatedMedia)!
    const url = loader({ src: '/media/saturated.jpg', width: 3840 })

    expect(url).toBe('/media/saturated-1400.jpg')
    expect(url).not.toMatch(/^\/_next\/image/)
  })

  test('does NOT saturate when source still has pixels beyond the largest variant', () => {
    // Source is 2560 (post-resize ceiling), largest variant is 1400 — the
    // parent file has more detail than our largest variant, so /_next/image
    // can legitimately deliver a higher-resolution render.
    const wideMedia: MediaResource = {
      url: '/media/wide.jpg',
      width: 2560,
      height: 2055,
      sizes: {
        large: { url: '/media/wide-1400.jpg', width: 1400, height: 1124 },
      },
    }
    const loader = createVariantLoader(wideMedia)!
    const url = loader({ src: '/media/wide.jpg', width: 3840 })

    expect(url).toMatch(/^\/_next\/image\?/)
    expect(url).toContain('w=3840')
  })

  test('does NOT saturate when source dimensions are unknown (defensive)', () => {
    // Without resource.width we cannot prove saturation; conservatively fall
    // back to /_next/image rather than guess.
    const unknownDimsMedia: MediaResource = {
      url: '/media/unknown.jpg',
      sizes: {
        large: { url: '/media/unknown-1400.jpg', width: 1400, height: 1124 },
      },
    }
    const loader = createVariantLoader(unknownDimsMedia)!
    const url = loader({ src: '/media/unknown.jpg', width: 3840 })

    expect(url).toMatch(/^\/_next\/image\?/)
  })

  test('saturation path still applies the updatedAt cache-buster', () => {
    const saturatedMedia: MediaResource = {
      url: '/media/saturated.jpg',
      width: 1400,
      height: 1124,
      updatedAt: '2026-04-26T10:00:00.000Z',
      sizes: {
        large: { url: '/media/saturated-1400.jpg', width: 1400, height: 1124 },
      },
    }
    const loader = createVariantLoader(saturatedMedia)!
    const url = loader({ src: '/media/saturated.jpg', width: 3840 })

    expect(url).toMatch(/^\/media\/saturated-1400\.jpg\?v=/)
  })

  test('returns undefined when media has no usable variants', () => {
    expect(createVariantLoader({ url: '/x.jpg', width: 100, height: 100 })).toBeUndefined()
  })

  test('appends updatedAt as url-encoded cache-buster on variant urls', () => {
    const loader = createVariantLoader({
      ...portraitMedia,
      updatedAt: '2026-04-20T10:45:30.123Z',
    })!

    const url = loader({ src: '/media/pascal.jpg', width: 600 })
    // Colons in the ISO timestamp must be percent-encoded (%3A) so CDNs
    // and URL parsers treat the value as a single opaque query param.
    expect(url).toBe('/media/pascal-600.jpg?v=2026-04-20T10%3A45%3A30.123Z')
  })

  test('omits cache-bust suffix when updatedAt is missing', () => {
    const loader = createVariantLoader({
      ...portraitMedia,
      updatedAt: undefined,
    })!

    const url = loader({ src: '/media/pascal.jpg', width: 600 })
    expect(url).toBe('/media/pascal-600.jpg')
    expect(url).not.toContain('?')
  })

  test('omits cache-bust suffix when updatedAt is null', () => {
    const loader = createVariantLoader({
      ...portraitMedia,
      // Payload may surface null for unpersisted resources
      updatedAt: null as unknown as undefined,
    })!

    const url = loader({ src: '/media/pascal.jpg', width: 600 })
    expect(url).toBe('/media/pascal-600.jpg')
    expect(url).not.toContain('?')
  })

  test('uses & separator when the variant url already has a query string', () => {
    // Some CDNs serve pre-generated variants through signed or parameterized URLs.
    // Naively appending `?v=...` would corrupt the existing query; the loader must
    // detect an existing `?` and switch to `&`.
    const loader = createVariantLoader({
      ...portraitMedia,
      sizes: {
        ...portraitMedia.sizes,
        small: {
          url: '/media/pascal-600.jpg?sig=abc123',
          width: 600,
          height: 482,
        },
      },
      updatedAt: '2026-04-20T10:45:30.123Z',
    })!

    const url = loader({ src: '/media/pascal.jpg', width: 600 })
    expect(url).toBe('/media/pascal-600.jpg?sig=abc123&v=2026-04-20T10%3A45%3A30.123Z')
  })

  test('coerces non-string updatedAt safely (e.g. Date object)', () => {
    const loader = createVariantLoader({
      ...portraitMedia,
      // Simulates call sites where updatedAt arrives as a Date instead of string
      updatedAt: new Date('2026-04-20T10:45:30.123Z') as unknown as string,
    })!

    const url = loader({ src: '/media/pascal.jpg', width: 600 })
    // String(Date) yields "Mon Apr 20 2026 ...", which after encodeURIComponent
    // has its spaces and colons percent-escaped — producing a safe URL rather
    // than a broken one.
    expect(url).toMatch(/^\/media\/pascal-600\.jpg\?v=/)
    expect(url).not.toContain(' ')
    expect(url).not.toMatch(/\?v=[^&]*:/)
  })
})
