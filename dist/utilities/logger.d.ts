import type { ResolvedLoggingConfig } from '../types.js';
export type RegenSkipReason = 'doc-deleted' | 'not-image' | 'user-cancelled';
type RegenDoc = {
    alt?: null | string;
    filename?: null | string;
    filesize?: null | number;
    mimeType?: null | string;
};
type MinimalReq = {
    payload: {
        logger: {
            error: (obj: Record<string, unknown>, msg?: string) => void;
            info: (obj: Record<string, unknown>, msg?: string) => void;
        };
    };
};
type EnterCtx = {
    collectionSlug: string;
    docId: string;
};
type ExitCtx = {
    doc: RegenDoc;
    startedAt: number;
} & EnterCtx;
type SkippedCtx = {
    reason: RegenSkipReason;
} & EnterCtx;
type ErrorCtx = {
    err: unknown;
    startedAt: number;
} & EnterCtx;
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
export declare const createRegenLogger: (resolved: ResolvedLoggingConfig, req: MinimalReq) => {
    enter(ctx: EnterCtx): void;
    exit(ctx: ExitCtx): void;
    skipped(ctx: SkippedCtx): void;
    error(ctx: ErrorCtx): void;
};
export type RegenLogger = ReturnType<typeof createRegenLogger>;
export {};
