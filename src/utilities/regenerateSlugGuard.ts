/**
 * Helpers for RegenerationButton to avoid firing status requests for
 * collections other than the one it was mounted against. See
 * `src/components/RegenerationButton.tsx` for context.
 */

export const readSlugFromUrl = (): string | null => {
  if (typeof window === 'undefined') return null
  return window.location.pathname.split('/collections/')[1]?.split('/')[0] ?? null
}

/**
 * Returns true when a status request for `currentSlug` is safe to fire:
 * - `currentSlug` must be non-null
 * - `currentSlug` must match the slug the component was originally mounted for
 *   (if one was captured)
 * - The live URL slug must still match `currentSlug`
 *
 * Any mismatch means the component is stale (the admin shell kept it alive
 * across a navigation to an unrelated collection).
 */
export const shouldFetchStatsForSlug = (
  currentSlug: string | null,
  mountedSlug: string | null,
  urlSlug: string | null,
): currentSlug is string => {
  if (!currentSlug) return false
  if (mountedSlug && mountedSlug !== currentSlug) return false
  return urlSlug === currentSlug
}
