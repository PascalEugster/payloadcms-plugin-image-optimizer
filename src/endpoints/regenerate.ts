import type { PayloadHandler } from 'payload'
import type { CollectionSlug, Where } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'
import { waitUntil } from '../utilities/waitUntil.js'

type CollectionState = { startedAt?: number; cancelledAt?: number; queued?: number }
type StateCollections = Record<string, CollectionState>

const GLOBAL_SLUG = 'image-optimizer-state'

async function getCollectionState(payload: any, slug: string): Promise<CollectionState> {
  try {
    const state = await payload.findGlobal({ slug: GLOBAL_SLUG })
    return (state?.collections as StateCollections)?.[slug] || {}
  } catch {
    return {}
  }
}

async function setCollectionState(payload: any, slug: string, update: Partial<CollectionState>): Promise<void> {
  let existing: StateCollections = {}
  try {
    const state = await payload.findGlobal({ slug: GLOBAL_SLUG })
    existing = (state?.collections as StateCollections) || {}
  } catch {
    // Global may not exist yet
  }
  existing[slug] = { ...existing[slug], ...update }
  await payload.updateGlobal({ slug: GLOBAL_SLUG, data: { collections: existing } })
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

    if (body.docIds && body.docIds.length > 0) {
      // Regenerate specific documents by ID
      for (const docId of body.docIds) {
        await req.payload.jobs.queue({
          task: 'imageOptimizer_regenerateDocument',
          input: {
            collectionSlug,
            docId: String(docId),
          },
        })
        queued++
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

        for (const doc of result.docs) {
          await req.payload.jobs.queue({
            task: 'imageOptimizer_regenerateDocument',
            input: {
              collectionSlug,
              docId: String(doc.id),
            },
          })
          queued++
        }

        hasMore = result.hasNextPage
        page++
      }
    }

    req.payload.logger.info(`Image optimizer: queued ${queued} images from '${collectionSlug}' for regeneration`)

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

    if (!collectionSlug || !resolvedConfig.collections[collectionSlug as CollectionSlug]) {
      return Response.json({ error: 'Invalid collection slug' }, { status: 400 })
    }

    const total = await req.payload.count({
      collection: collectionSlug as CollectionSlug,
      where: { mimeType: { contains: 'image/' } },
    })

    const complete = await req.payload.count({
      collection: collectionSlug as CollectionSlug,
      where: {
        mimeType: { contains: 'image/' },
        'imageOptimizer.status': { equals: 'complete' },
      },
    })

    const errored = await req.payload.count({
      collection: collectionSlug as CollectionSlug,
      where: {
        mimeType: { contains: 'image/' },
        'imageOptimizer.status': { equals: 'error' },
      },
    })

    // Include cancellation state so the UI can react
    const collState = await getCollectionState(req.payload, collectionSlug)
    const cancelled = !!(collState.cancelledAt && collState.startedAt && collState.cancelledAt > collState.startedAt)

    return Response.json({
      collectionSlug,
      total: total.totalDocs,
      complete: complete.totalDocs,
      errored: errored.totalDocs,
      pending: total.totalDocs - complete.totalDocs - errored.totalDocs,
      cancelled,
      allowForceAll: resolvedConfig.regenerateButton.allowForceAll,
    })
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

    req.payload.logger.info(`Image optimizer: cancellation requested for '${collectionSlug}'`)

    return Response.json({ cancelled: true, collectionSlug })
  }

  return handler
}
