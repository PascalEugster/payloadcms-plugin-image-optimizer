import type { PayloadHandler } from 'payload'
import type { CollectionSlug, Where } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { waitUntil } from '../utilities/waitUntil.js'

type CollectionState = { startedAt?: number; cancelledAt?: number; queued?: number }
type StateCollections = Record<string, CollectionState>

const GLOBAL_SLUG = 'image-optimizer-state'

// Serializes read-modify-write on the shared `image-optimizer-state` global
// within this process, so two concurrent regens on different collections
// can't clobber each other's `startedAt`/`cancelledAt`. Keyed by anything
// stable across calls (we use GLOBAL_SLUG since there's exactly one global).
// Cross-instance races still exist on Fluid Compute but are acceptable given
// regen is admin-triggered and rare.
const stateWriteChain = new Map<string, Promise<unknown>>()

// Short-lived per-collection memo for the status endpoint. Polling at 2s
// with a 5s TTL means ~60% of polls hit memo, and every navigation burst
// to the Media list collapses to a single DB round-trip.
type StatusPayload = {
  collectionSlug: string
  configured: true
  total: number
  complete: number
  errored: number
  pending: number
  cancelled: boolean
  allowForceAll: boolean
}
const STATUS_TTL_MS = 5_000
const statusMemo = new Map<string, { data: StatusPayload; expiresAt: number; generation: number }>()
// Monotonic generation counter per slug. Incremented on every invalidation;
// compared at memo-write time so an in-flight GET whose Promise.all started
// before a POST/DELETE invalidation can't repopulate the memo with its
// now-stale snapshot. (Classic CAS-on-version against read-your-write races.)
const statusGeneration = new Map<string, number>()

async function getCollectionState(payload: any, slug: string): Promise<CollectionState> {
  try {
    const state = await payload.findGlobal({ slug: GLOBAL_SLUG })
    return (state?.collections as StateCollections)?.[slug] || {}
  } catch {
    return {}
  }
}

async function setCollectionState(payload: any, slug: string, update: Partial<CollectionState>): Promise<void> {
  const previous = stateWriteChain.get(GLOBAL_SLUG) ?? Promise.resolve()
  const next = previous.then(async () => {
    let existing: StateCollections = {}
    try {
      const state = await payload.findGlobal({ slug: GLOBAL_SLUG })
      existing = (state?.collections as StateCollections) || {}
    } catch {
      // Global may not exist yet
    }
    existing[slug] = { ...existing[slug], ...update }
    await payload.updateGlobal({ slug: GLOBAL_SLUG, data: { collections: existing } })
  })
  // Swallow downstream errors so a failed write doesn't poison later writes
  // in the chain; the caller's await still surfaces this call's own error.
  stateWriteChain.set(GLOBAL_SLUG, next.catch(() => {}))
  await next
}

function invalidateStatusMemo(slug: string): void {
  statusMemo.delete(slug)
  statusGeneration.set(slug, (statusGeneration.get(slug) ?? 0) + 1)
}

export const createRegenerateHandler = (resolvedConfig: ResolvedImageOptimizerConfig) => {
  const handler: PayloadHandler = async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { collectionSlug?: string; force?: boolean; docIds?: string[] }
    try {
      body = await req.json!()
    } catch {
      body = {}
    }

    const collectionSlug = body.collectionSlug
    if (!collectionSlug || !resolvedConfig.collections[collectionSlug as CollectionSlug]) {
      return Response.json(
        { error: 'Invalid or unconfigured collection slug' },
        { status: 400 },
      )
    }

    // Config is the source of truth — a client that sends `force: true` when
    // the plugin hasn't opted in gets the safe default (unoptimized only).
    const forceAllowed = resolvedConfig.regenerateButton.allowForceAll
    const force = forceAllowed ? !!body.force : false

    let queued = 0

    // Queue jobs in bounded-parallel chunks. Sequential `await` per doc made
    // the POST response scale linearly with collection size — a 1k-image
    // collection held the admin UI on a spinner for ~30s just queuing. A
    // chunk size of 25 keeps DB pressure manageable while collapsing the
    // wall-clock cost by ~25x.
    const CHUNK_SIZE = 25
    const queueChunk = async (ids: string[]) => {
      await Promise.all(
        ids.map((docId) =>
          req.payload.jobs.queue({
            task: 'imageOptimizer_regenerateDocument',
            input: { collectionSlug, docId },
          }),
        ),
      )
      queued += ids.length
    }

    if (body.docIds && body.docIds.length > 0) {
      // Regenerate specific documents by ID
      const ids = body.docIds.map(String)
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        await queueChunk(ids.slice(i, i + CHUNK_SIZE))
      }
    } else {
      // Find all image documents in the collection
      // Unless force=true, skip already-processed docs
      const where: Where = force
        ? { mimeType: { contains: 'image/' } }
        : {
            and: [
              { mimeType: { contains: 'image/' } },
              {
                or: [
                  { 'imageOptimizer.status': { not_equals: 'complete' } },
                  { 'imageOptimizer.status': { exists: false } },
                ],
              },
            ],
          }

      let page = 1
      let hasMore = true

      while (hasMore) {
        const result = await req.payload.find({
          collection: collectionSlug as CollectionSlug,
          limit: 50,
          page,
          depth: 0,
          where,
          sort: 'createdAt',
        })

        const ids = result.docs.map((doc) => String(doc.id))
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
          await queueChunk(ids.slice(i, i + CHUNK_SIZE))
        }

        hasMore = result.hasNextPage
        page++
      }
    }

    req.payload.logger.info(`Image optimizer: queued ${queued} images from '${collectionSlug}' for regeneration`)

    // New batch starts — drop any cached status so the next poll reflects it.
    invalidateStatusMemo(collectionSlug)

    // Clear any previous cancellation and record the start time + batch size
    await setCollectionState(req.payload, collectionSlug, {
      startedAt: Date.now(),
      cancelledAt: undefined,
      queued,
    })

    // Fire the job runner — use waitUntil to keep the serverless function alive
    // after the response is sent, so jobs actually complete on Vercel/serverless.
    if (queued > 0) {
      const runPromise = req.payload.jobs.run({ limit: queued, sequential: true }).catch((err: unknown) => {
        req.payload.logger.error({ err }, 'Regeneration job runner failed')
      })
      waitUntil(runPromise, req)
    }

    return Response.json({ queued, collectionSlug })
  }

  return handler
}

export const createRegenerateStatusHandler = (resolvedConfig: ResolvedImageOptimizerConfig) => {
  const handler: PayloadHandler = async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url!)
    const collectionSlug = url.searchParams.get('collection')

    // Missing query param is still a client error.
    if (!collectionSlug) {
      return Response.json({ error: 'Missing collection query param' }, { status: 400 })
    }

    // An unconfigured collection is a legitimate "nothing to report" state for
    // a read-only status endpoint — answer with a well-formed no-op payload
    // instead of 400 so consumers can ignore the response without logging
    // errors. (POST/DELETE stay 400 — they have side effects.)
    if (!resolvedConfig.collections[collectionSlug as CollectionSlug]) {
      return Response.json({
        collectionSlug,
        configured: false,
        total: 0,
        complete: 0,
        errored: 0,
        pending: 0,
        cancelled: false,
        allowForceAll: resolvedConfig.regenerateButton.allowForceAll,
      })
    }

    // Hot path: memoize the full status payload for 5s per collection.
    // Polling at 2s means ~60% of polls hit memo, and every navigation burst
    // to the Media list page collapses to a single DB round-trip. TTL is
    // short enough that users never notice stale pending counts.
    const memoEntry = statusMemo.get(collectionSlug)
    if (memoEntry && memoEntry.expiresAt > Date.now()) {
      return Response.json(memoEntry.data)
    }

    // Capture the generation before reading. If a POST/DELETE invalidates
    // mid-query (bumping the counter), the post-query memo write will see
    // a stale generation and skip caching — preventing the "in-flight read
    // repopulates memo with pre-invalidation snapshot" race.
    const generation = statusGeneration.get(collectionSlug) ?? 0

    // Fan out the three count queries + state read in parallel. Previously
    // sequential: ~4 round-trips of latency per poll. Now ~1 round-trip worth.
    const [total, complete, errored, collState] = await Promise.all([
      req.payload.count({
        collection: collectionSlug as CollectionSlug,
        where: { mimeType: { contains: 'image/' } },
      }),
      req.payload.count({
        collection: collectionSlug as CollectionSlug,
        where: {
          mimeType: { contains: 'image/' },
          'imageOptimizer.status': { equals: 'complete' },
        },
      }),
      req.payload.count({
        collection: collectionSlug as CollectionSlug,
        where: {
          mimeType: { contains: 'image/' },
          'imageOptimizer.status': { equals: 'error' },
        },
      }),
      getCollectionState(req.payload, collectionSlug),
    ])

    const cancelled = !!(collState.cancelledAt && collState.startedAt && collState.cancelledAt > collState.startedAt)

    const payload: StatusPayload = {
      collectionSlug,
      configured: true,
      total: total.totalDocs,
      complete: complete.totalDocs,
      errored: errored.totalDocs,
      pending: total.totalDocs - complete.totalDocs - errored.totalDocs,
      cancelled,
      allowForceAll: resolvedConfig.regenerateButton.allowForceAll,
    }

    // Only cache if nothing invalidated the memo while our Promise.all was
    // in flight. A mismatched generation means a newer write superseded our
    // snapshot — serve it to this caller (correct by construction, their
    // read covered the invalidation window) but don't poison the memo.
    // Safety note: this CAS is correct because Node's single-threaded event
    // loop guarantees the `.get` check and the `.set` execute without any
    // synchronous invalidation interleaving. `invalidateStatusMemo` is
    // purely synchronous, so an async invalidator can only run between
    // distinct microtasks — not between these two adjacent statements.
    if ((statusGeneration.get(collectionSlug) ?? 0) === generation) {
      statusMemo.set(collectionSlug, {
        data: payload,
        expiresAt: Date.now() + STATUS_TTL_MS,
        generation,
      })
    }

    return Response.json(payload)
  }

  return handler
}

export const createCancelHandler = (resolvedConfig: ResolvedImageOptimizerConfig) => {
  const handler: PayloadHandler = async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { collectionSlug?: string }
    try {
      body = await req.json!()
    } catch {
      body = {}
    }

    const collectionSlug = body.collectionSlug
    if (!collectionSlug || !resolvedConfig.collections[collectionSlug as CollectionSlug]) {
      return Response.json({ error: 'Invalid or unconfigured collection slug' }, { status: 400 })
    }

    await setCollectionState(req.payload, collectionSlug, {
      cancelledAt: Date.now(),
    })

    // The next poll must see `cancelled: true` immediately — don't serve it
    // a 5s-stale payload from before the DELETE.
    invalidateStatusMemo(collectionSlug)

    req.payload.logger.info(`Image optimizer: cancellation requested for '${collectionSlug}'`)

    return Response.json({ cancelled: true, collectionSlug })
  }

  return handler
}
