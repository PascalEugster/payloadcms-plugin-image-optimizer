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
 *   "Geländer aus Edelstahl" → `gelander-aus-edelstahl-20260327T120000Z`
 *
 * Processing pipeline:
 *  1. Uses alt text, falls back to original filename stem, then "media"
 *  2. Strips diacritics (ä→a, ö→o, ü→u, é→e)
 *  3. Converts to kebab-case
 *  4. Truncates to 60 characters (clean break, no trailing hyphens)
 *  5. Appends ISO timestamp for uniqueness (YYYYMMDDTHHMMSSmmm)
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

  // Truncate cleanly — don't leave a trailing hyphen
  const truncated = slug.length > MAX_STEM_LENGTH
    ? slug.slice(0, MAX_STEM_LENGTH).replace(/-$/, '')
    : slug

  // Append timestamp for uniqueness (ISO-ish, no colons for filesystem safety)
  const now = new Date()
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

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
 * Milliseconds are included (unlike `seoFilename`) because the stem alone
 * provides no variation between uploads of the same source file.
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
