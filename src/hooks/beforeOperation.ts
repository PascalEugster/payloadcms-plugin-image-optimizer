import type { CollectionBeforeOperationHook } from 'payload'

/**
 * Captures the original (pre-pipeline) upload size into request context.
 *
 * Why: Payload's `generateFileData()` runs BEFORE any `beforeChange` hook and
 * mutates `req.file.data` / `req.file.size` in-place to reflect the post-resize
 * + post-format-conversion buffer. By the time our `beforeChange` hook runs,
 * the original byte count is gone.
 *
 * `beforeOperation` is the earliest collection hook in the create/update
 * pipeline — it runs before access checks and before `generateFileData`. We
 * snapshot `req.file.size` here and read it back in `beforeChange`.
 */
export const createBeforeOperationHook = (): CollectionBeforeOperationHook => {
  return async ({ args, operation }) => {
    if (operation !== 'create' && operation !== 'update') return args
    const req = args.req as {
      file?: { size?: number; mimetype?: string }
      context?: Record<string, unknown>
    }
    if (!req?.file?.mimetype?.startsWith('image/')) return args
    if (typeof req.file.size !== 'number') return args
    if (!req.context) (req as { context: Record<string, unknown> }).context = {}
    req.context!.imageOptimizer_originalSize = req.file.size
    return args
  }
}
