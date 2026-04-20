import type { ResolvedLoggingConfig } from '../types.js'

export type RegenSkipReason = 'doc-deleted' | 'not-image' | 'user-cancelled'

type RegenDoc = {
  alt?: null | string
  filename?: null | string
  filesize?: null | number
  mimeType?: null | string
}

type MinimalReq = {
  payload: {
    logger: {
      error: (obj: Record<string, unknown>, msg?: string) => void
      info: (obj: Record<string, unknown>, msg?: string) => void
    }
  }
}

type EnterCtx = { collectionSlug: string; docId: string }
type ExitCtx = { doc: RegenDoc; startedAt: number } & EnterCtx
type SkippedCtx = { reason: RegenSkipReason } & EnterCtx
type ErrorCtx = { err: unknown; startedAt: number } & EnterCtx

/** Maps a skip reason to its resolved gating flag. */
const skipEnabled = (
  reason: RegenSkipReason,
  skips: ResolvedLoggingConfig['skips'],
): boolean => {
  if (reason === 'user-cancelled') {return skips.userCancelled}
  if (reason === 'doc-deleted') {return skips.docDeleted}
  return skips.notImage
}

const docDetails = (doc: RegenDoc): Record<string, unknown> => ({
  alt: doc.alt ?? null,
  filename: doc.filename ?? null,
  filesize: typeof doc.filesize === 'number' ? doc.filesize : null,
  mimeType: doc.mimeType ?? null,
})

/**
 * Factory for the regeneration-task logger. Each method is gated on the
 * resolved logging flags, so the task handler can call them unconditionally
 * without threading `if` checks through its body.
 *
 * All emitted records carry a stable `event: 'imageOpt.regen.<phase>'` field
 * for log-aggregator filtering, plus a short human-readable `msg`. Error
 * records pass the caught value as `err` so Pino's std serializer captures
 * name/message/stack/cause without us reimplementing it.
 */
export const createRegenLogger = (
  resolved: ResolvedLoggingConfig,
  req: MinimalReq,
) => {
  const logger = req.payload.logger

  return {
    enter(ctx: EnterCtx): void {
      if (!resolved.lifecycle) {return}
      logger.info(
        {
          collectionSlug: ctx.collectionSlug,
          docId: ctx.docId,
          event: 'imageOpt.regen.enter',
        },
        'Regeneration started',
      )
    },

    exit(ctx: ExitCtx): void {
      if (!resolved.lifecycle) {return}
      logger.info(
        {
          collectionSlug: ctx.collectionSlug,
          docId: ctx.docId,
          durationMs: Date.now() - ctx.startedAt,
          event: 'imageOpt.regen.exit',
          ...(resolved.includeDocDetails ? docDetails(ctx.doc) : {}),
        },
        'Regeneration complete',
      )
    },

    skipped(ctx: SkippedCtx): void {
      if (!skipEnabled(ctx.reason, resolved.skips)) {return}
      logger.info(
        {
          collectionSlug: ctx.collectionSlug,
          docId: ctx.docId,
          event: 'imageOpt.regen.skipped',
          reason: ctx.reason,
        },
        'Regeneration skipped',
      )
    },

    error(ctx: ErrorCtx): void {
      if (!resolved.errors) {return}
      logger.error(
        {
          collectionSlug: ctx.collectionSlug,
          docId: ctx.docId,
          durationMs: Date.now() - ctx.startedAt,
          err: ctx.err,
          event: 'imageOpt.regen.error',
        },
        'Regeneration failed',
      )
    },
  }
}

export type RegenLogger = ReturnType<typeof createRegenLogger>
