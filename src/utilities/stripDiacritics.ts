/**
 * Strip diacritics (combining marks) from a string using Unicode NFKD normalization.
 *
 * Examples: ä→a, ö→o, ü→u, é→e, ñ→n
 *
 * Note: This maps ä→a (not ä→ae). For German, the ae/oe/ue transliteration
 * is sometimes preferred for SEO — but plain ASCII is simpler and works well for URLs.
 */
export const stripDiacritics = (input: string): string =>
  input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
