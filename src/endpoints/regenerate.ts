import type { PayloadHandler } from 'payload'
import type { CollectionSlug, Where } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { waitUntil } from '../utilities/waitUntil.js'

type CollectionState = { startedAt?: number; cancelledAt?: number; queued?: number }
type StateCollections = Record<string, CollectionState>

const GLOBAL_SLUG = 'image-optimizer-state'

// Dedicated queue for regeneration jobs. Keeps our jobs isolated from the
// `default` queue so host-side cron autorun (or other plugins) can target
// their own queue without picking up — or being blocked by — ours.
const IMAGE_OPTIMIZER_QUEUE = 'image-optimizer'

// Parallel jobs per wave. Tuned to balance throughput on cloud storage
// (where each job is dominated by a fetch-then-upload round-trip) against
// backpressure on sharp + the host's connection pool. 20 concurrent sharp
// passes ≈ ~1.5GB peak memory for large sources — comfortable on a 2GB
// serverless function.
const WAVE_SIZE = 20

// Wall-clock budget for the in-request wave loop. Default serverless timeout
// on Vercel is 300s; leaving 30s of headroom means the loop exits cleanly
// before the host kills the invocation mid-upload. Remaining jobs stay
// queued and are picked up by Payload's autorun or the next POST.
const WAVE_BUDGET_MS = 270_000

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
            // Isolated queue so host-side cron autorun can pick up regen jobs
            // (via `queue: 'image-optimizer'`) without the plugin interfering
            // with other consumers of the default queue.
            queue: IMAGE_OPTIMIZER_QUEUE,
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

    // Fire the job runner in bounded-parallel waves, kept alive past the
    // response via waitUntil so jobs progress on Vercel/serverless hosts
    // that don't have a separate cron runner configured.
    //
    // Three reasons this shape beats the previous `jobs.run({ sequential: true,
    // limit: queued })` call:
    //
    //   1. Parallelism. The task is network-bound (fetch original → sharp →
    //      re-upload). Sequential execution left the CPU and the host's
    //      connection pool ~90% idle per job. Running WAVE_SIZE jobs in
    //      parallel per wave gets ~5-10x more throughput on cloud storage.
    //   2. Budgeted loop. A single monolithic `run({ limit: queued })` in
    //      waitUntil held one invocation open until every job finished —
    //      on a 1k-image collection, well past any serverless timeout.
    //      Looping wave-by-wave lets us exit cleanly before the host kills
    //      us, leaving remaining jobs queued for the next tick.
    //   3. Graceful handoff. When the budget runs out (or the host cuts
    //      the invocation), remaining jobs sit in the `image-optimizer`
    //      queue. Payload autorun (if configured) picks them up; otherwise
    //      the admin UI's stall detection + re-click path queues only the
    //      still-pending docs (the `where` clause above excludes completed).
    if (queued > 0) {
      const startAt = Date.now()
      const runWaves = async () => {
        while (Date.now() - startAt < WAVE_BUDGET_MS) {
          // Cheap cancel fast-path: skip the next wave if the user hit stop.
          // Intentionally reads the global directly (not via memo) because
          // the cancellation signal MUST be fresh here — stale-by-5s would
          // leak one more full wave of work past a cancel click.
          const state = await getCollectionState(req.payload, collectionSlug)
          if (state.cancelledAt && state.cancelledAt > (state.startedAt ?? 0)) {
            return
          }

          try {
            const result = await req.payload.jobs.run({
              queue: IMAGE_OPTIMIZER_QUEUE,
              limit: WAVE_SIZE,
              // `sequential` intentionally omitted — parallel is the default
              // and the entire point of the wave-loop shape.
            })
            // `noJobsRemaining: true` is the authoritative end signal. We
            // don't use `remainingJobsFromQueried` because re-queues from a
            // concurrent POST would make it trail reality.
            if (result?.noJobsRemaining) return
          } catch (err) {
            req.payload.logger.error({ err }, 'Image optimizer: wave run failed')
            return
          }
        }
        req.payload.logger.warn(
          { collectionSlug, budgetMs: WAVE_BUDGET_MS },
          'Image optimizer: wave budget exhausted — remaining jobs stay queued for autorun or next regen',
        )
      }
      waitUntil(runWaves(), req)
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
