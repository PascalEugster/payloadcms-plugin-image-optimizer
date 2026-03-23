/**
 * Extends the serverless function lifetime to keep a promise alive after the
 * response is sent.
 *
 * Resolution order:
 * 1. Payload's req.context.waitUntil — the documented way for plugins on Vercel
 * 2. Next.js global context — fallback for native Next.js route handlers
 * 3. No-op — non-serverless environments keep the process alive regardless
 */
export function waitUntil(
  promise: Promise<unknown>,
  req?: { context?: { waitUntil?: (p: Promise<unknown>) => void } },
): void {
  if (typeof req?.context?.waitUntil === 'function') {
    req.context.waitUntil(promise)
    return
  }

  const ctx = (globalThis as Record<string, unknown>).__next_request_context as
    | { waitUntil?: (p: Promise<unknown>) => void }
    | undefined

  ctx?.waitUntil?.(promise)
}
