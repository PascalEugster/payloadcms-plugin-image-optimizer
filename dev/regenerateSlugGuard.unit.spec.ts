import { describe, expect, test } from 'vitest'

import { shouldFetchStatsForSlug } from '../src/utilities/regenerateSlugGuard.js'

describe('shouldFetchStatsForSlug', () => {
  test('returns false when currentSlug is null', () => {
    expect(shouldFetchStatsForSlug(null, 'media', 'media')).toBe(false)
  })

  test('returns false when URL slug differs from currentSlug', () => {
    // Component thinks it is on `media` but the URL says `pages`.
    expect(shouldFetchStatsForSlug('media', 'media', 'pages')).toBe(false)
  })

  test('returns false when mounted slug differs from currentSlug', () => {
    // Component was mounted for `media` but is now being asked about `pages`.
    expect(shouldFetchStatsForSlug('pages', 'media', 'pages')).toBe(false)
  })

  test('returns true when currentSlug, mountedSlug, and URL slug all match', () => {
    expect(shouldFetchStatsForSlug('media', 'media', 'media')).toBe(true)
  })

  test('tolerates null mountedSlug when URL + currentSlug agree', () => {
    // First fetch after mount, before the ref is populated.
    expect(shouldFetchStatsForSlug('media', null, 'media')).toBe(true)
  })

  test('returns false when URL slug is null (no /collections/ segment)', () => {
    expect(shouldFetchStatsForSlug('media', 'media', null)).toBe(false)
  })
})
