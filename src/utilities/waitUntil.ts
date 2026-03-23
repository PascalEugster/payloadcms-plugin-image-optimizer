/**
 * Extends the serverless function lifetime to keep a promise alive after the
 * response is sent. Uses the Next.js `waitUntil` context when available
 * (Vercel / serverless). In non-serverless environments, the promise runs
 * fire-and-forget as before — Node.js keeps the process alive regardless.
 */
export function waitUntil(promise: Promise<unknown>): void {
  const ctx = (globalThis as Record<string, unknown>).__next_request_context as
    | { waitUntil?: (p: Promise<unknown>) => void }
    | undefined

  ctx?.waitUntil?.(promise)
}
