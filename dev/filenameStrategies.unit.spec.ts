import { describe, expect, it } from 'vitest'

import {
  seoFilename,
  timestampFilename,
  uuidFilename,
} from '../src/utilities/filenameStrategies.js'

describe('uuidFilename', () => {
  it('returns a UUID stem on first upload', () => {
    const result = uuidFilename({ originalFilename: 'photo.jpg' })
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('reuses existing stem on re-upload', () => {
    const result = uuidFilename({
      originalFilename: 'photo.jpg',
      existingFilename: 'abc123.webp',
    })
    expect(result).toBe('abc123')
  })
})

describe('seoFilename', () => {
  it('slugifies alt text with timestamp suffix', () => {
    const result = seoFilename({
      originalFilename: 'IMG_1234.jpg',
      altText: 'Geländer aus Edelstahl',
    })
    expect(result).toMatch(/^gelander-aus-edelstahl-\d{8}T\d{9}Z$/)
  })

  it('falls back to original stem when alt text is missing', () => {
    const result = seoFilename({ originalFilename: 'my-photo.jpg' })
    expect(result).toMatch(/^my-photo-\d{8}T\d{9}Z$/)
  })

  it('reuses existing stem on re-upload', () => {
    const result = seoFilename({
      originalFilename: 'photo.jpg',
      altText: 'new alt',
      existingFilename: 'old-stem.webp',
    })
    expect(result).toBe('old-stem')
  })

  it('falls back to img-<hash> for Cyrillic alt text', () => {
    const result = seoFilename({
      originalFilename: 'IMG_1234.jpg',
      altText: 'Мой файл',
    })
    expect(result).toMatch(/^img-[0-9a-f]{8}-\d{8}T\d{9}Z$/)
  })

  it('falls back to img-<hash> for Chinese alt text', () => {
    const result = seoFilename({
      originalFilename: 'IMG_1234.jpg',
      altText: '我的图片',
    })
    expect(result).toMatch(/^img-[0-9a-f]{8}-\d{8}T\d{9}Z$/)
  })

  it('falls back to img-<hash> when both alt text and stem are non-ASCII', () => {
    // Empty altText → uses originalFilename stem. If that also can't be
    // slugified (e.g. pure emoji/symbols), the hash fallback still kicks in.
    const result = seoFilename({ originalFilename: '!@#.jpg', altText: '' })
    expect(result).toMatch(/^img-[0-9a-f]{8}-\d{8}T\d{9}Z$/)
  })

  it('uses millisecond precision — two calls ≥1ms apart in the same second differ', async () => {
    // The prior bug: seoFilename stripped ms, so two uploads within the same
    // second produced identical filenames and collided on cloud storage. With
    // ms retained, any two calls >=1ms apart are distinct. (Real HTTP uploads
    // are always orders of magnitude farther apart than that.)
    const a = seoFilename({ originalFilename: 'x.jpg', altText: 'same alt' })
    await new Promise((resolve) => setTimeout(resolve, 2))
    const b = seoFilename({ originalFilename: 'x.jpg', altText: 'same alt' })
    expect(a).not.toBe(b)
    // Both should have 9-digit time parts (HHMMSSmmm) — confirming ms are kept.
    expect(a).toMatch(/^same-alt-\d{8}T\d{9}Z$/)
    expect(b).toMatch(/^same-alt-\d{8}T\d{9}Z$/)
  })
})

describe('timestampFilename', () => {
  it('keeps original stem and appends ISO timestamp with ms', () => {
    const result = timestampFilename({ originalFilename: 'photo.jpg' })
    expect(result).toMatch(/^photo-\d{8}T\d{9}Z$/)
  })

  it('slugifies diacritics and spaces in the stem', () => {
    const result = timestampFilename({ originalFilename: 'Geländer Foto.jpg' })
    expect(result).toMatch(/^gelander-foto-\d{8}T\d{9}Z$/)
  })

  it('uses millisecond precision (same ms resolution as seoFilename)', () => {
    const seo = seoFilename({ originalFilename: 'x.jpg', altText: 'test' })
    const ts = timestampFilename({ originalFilename: 'x.jpg' })
    // Both strategies now keep ms → 9 digits (HHMMSSmmm) after the `T`.
    const seoTimePart = seo.match(/T(\d+)Z$/)?.[1]
    const tsTimePart = ts.match(/T(\d+)Z$/)?.[1]
    expect(seoTimePart).toBeDefined()
    expect(tsTimePart).toBeDefined()
    expect(seoTimePart!.length).toBe(9)
    expect(tsTimePart!.length).toBe(9)
  })

  it('ignores missing alt text (uses stem only)', () => {
    const result = timestampFilename({
      originalFilename: 'photo.jpg',
      altText: 'this should be ignored',
    })
    expect(result).toMatch(/^photo-/)
    expect(result).not.toContain('this-should-be-ignored')
  })

  it('reuses existing stem on re-upload', () => {
    const result = timestampFilename({
      originalFilename: 'photo.jpg',
      existingFilename: 'photo-20260420T104530123Z.webp',
    })
    expect(result).toBe('photo-20260420T104530123Z')
  })

  it('falls back to "media" when stem slugifies to empty', () => {
    const result = timestampFilename({ originalFilename: '!@#.jpg' })
    expect(result).toMatch(/^media-\d{8}T\d{9}Z$/)
  })

  it('truncates very long stems to 60 chars', () => {
    const longStem = 'a'.repeat(100)
    const result = timestampFilename({ originalFilename: `${longStem}.jpg` })
    const stemPart = result.split(/-\d{8}T/)[0]
    expect(stemPart.length).toBeLessThanOrEqual(60)
  })
})
