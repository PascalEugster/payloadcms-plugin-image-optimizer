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
    expect(result).toMatch(/^gelander-aus-edelstahl-\d{8}T\d{6}Z$/)
  })

  it('falls back to original stem when alt text is missing', () => {
    const result = seoFilename({ originalFilename: 'my-photo.jpg' })
    expect(result).toMatch(/^my-photo-\d{8}T\d{6}Z$/)
  })

  it('reuses existing stem on re-upload', () => {
    const result = seoFilename({
      originalFilename: 'photo.jpg',
      altText: 'new alt',
      existingFilename: 'old-stem.webp',
    })
    expect(result).toBe('old-stem')
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

  it('uses millisecond precision (distinct from seoFilename)', () => {
    const seo = seoFilename({ originalFilename: 'x.jpg', altText: 'test' })
    const ts = timestampFilename({ originalFilename: 'x.jpg' })
    // seoFilename strips ms → 15 chars after `T` minus `Z` = 14 digits => dateT + 6 time digits + Z
    // timestampFilename keeps ms → 9 digits (HHMMSSmmm)
    const seoTimePart = seo.match(/(\d{8}T\d+)Z$/)?.[1]
    const tsTimePart = ts.match(/(\d{8}T\d+)Z$/)?.[1]
    expect(seoTimePart).toBeDefined()
    expect(tsTimePart).toBeDefined()
    expect(tsTimePart!.length).toBeGreaterThan(seoTimePart!.length)
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
