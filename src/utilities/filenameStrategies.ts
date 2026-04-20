import crypto from 'crypto'
import path from 'path'

import type { GenerateFilenameArgs } from '../types.js'
import { stripDiacritics } from './stripDiacritics.js'
import { toKebabCase } from './toKebabCase.js'

const MAX_STEM_LENGTH = 60

/**
 * UUID-based filename strategy.
 *
 * Generates collision-free filenames like `a1b2c3d4-e5f6-7890-abcd-ef1234567890`.
 * On re-uploads (focal point / crop changes), reuses the existing filename stem
 * to avoid unnecessary file churn on cloud storage.
 */
export const uuidFilename = ({ existingFilename }: GenerateFilenameArgs): string => {
  if (existingFilename) {
    return path.parse(existingFilename).name
  }
  return crypto.randomUUID()
}

/**
 * SEO-friendly filename strategy.
 *
 * Generates human-readable, URL-safe filenames from alt text:
 *   "Geländer aus Edelstahl" → `gelander-aus-edelstahl-20260327T120000000Z`
 *
 * Processing pipeline:
 *  1. Uses alt text, falls back to original filename stem, then "media"
 *  2. Strips diacritics (ä→a, ö→o, ü→u, é→e)
 *  3. Converts to kebab-case
 *  4. If the slug is empty (non-Latin scripts like Cyrillic, CJK, Arabic that
 *     can't be ASCII'd), falls back to `img-<8 hex chars>` derived from a
 *     sha256 hash of the source + current time for uniqueness.
 *  5. Truncates to 60 characters (clean break, no trailing hyphens)
 *  6. Appends ISO timestamp with milliseconds for uniqueness (YYYYMMDDTHHMMSSmmmZ)
 *
 * On re-uploads, reuses the existing filename stem to avoid cloud storage churn.
 */
export const seoFilename = ({
  altText,
  existingFilename,
  originalFilename,
}: GenerateFilenameArgs): string => {
  if (existingFilename) {
    return path.parse(existingFilename).name
  }

  const source = altText?.trim() || path.parse(originalFilename).name || 'media'
  const slug = toKebabCase(stripDiacritics(source))

  // When the source can't be ASCII'd (Cyrillic, CJK, Arabic, emoji, etc.) the
  // slug collapses to empty. Fall back to a short hash of the original source
  // so users still get unique, non-colliding filenames.
  const stem = slug.length === 0
    ? `img-${crypto.createHash('sha256').update(source + Date.now()).digest('hex').slice(0, 8)}`
    : slug

  // Truncate cleanly — don't leave a trailing hyphen
  const truncated = stem.length > MAX_STEM_LENGTH
    ? stem.slice(0, MAX_STEM_LENGTH).replace(/-$/, '')
    : stem

  // Append timestamp for uniqueness (ISO-ish, no colons/dots for filesystem safety)
  // Keep milliseconds so two uploads in the same second don't collide.
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '')

  return `${truncated || 'media'}-${timestamp}`
}

/**
 * Original filename + timestamp strategy.
 *
 * Keeps the original filename stem and appends an ISO-compact timestamp with
 * milliseconds for uniqueness:
 *   `photo.jpg` → `photo-20260420T104530123Z`
 *
 * Useful when you want human-recognizable filenames (like `seoFilename`) but
 * don't care about alt text — e.g. bulk uploads where the uploader already
 * curated filenames and you just need collision avoidance.
 *
 * Processing pipeline:
 *  1. Uses the original filename stem, falls back to "media"
 *  2. Strips diacritics (ä→a, ö→o, ü→u, é→e)
 *  3. Converts to kebab-case
 *  4. Truncates to 60 characters (clean break, no trailing hyphens)
 *  5. Appends ISO timestamp with milliseconds (YYYYMMDDTHHMMSSmmmZ)
 *
 * Milliseconds are included because the stem alone provides no variation
 * between uploads of the same source file.
 *
 * On re-uploads, reuses the existing filename stem to avoid cloud storage churn.
 */
export const timestampFilename = ({
  existingFilename,
  originalFilename,
}: GenerateFilenameArgs): string => {
  if (existingFilename) {
    return path.parse(existingFilename).name
  }

  const source = path.parse(originalFilename).name || 'media'
  const slug = toKebabCase(stripDiacritics(source))

  const truncated = slug.length > MAX_STEM_LENGTH
    ? slug.slice(0, MAX_STEM_LENGTH).replace(/-$/, '')
    : slug

  const timestamp = new Date().toISOString().replace(/[-:.]/g, '')

  return `${truncated || 'media'}-${timestamp}`
}
