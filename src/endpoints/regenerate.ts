import type { PayloadHandler } from 'payload'
import type { CollectionSlug } from 'payload'

import type { ResolvedImageOptimizerConfig } from '../types.js'

export const createRegenerateHandler = (resolvedConfig: ResolvedImageOptimizerConfig) => {
  const handler: PayloadHandler = async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { collectionSlug?: string; force?: boolean }
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

    // Find all image documents in the collection
    const where: any = {
      mimeType: { contains: 'image/' },
    }
    // Unless force=true, skip already-processed docs
    if (!body.force) {
      where.or = [
        { 'imageOptimizer.status': { not_equals: 'complete' } },
        { 'imageOptimizer.status': { exists: false } },
      ]
    }

    let queued = 0
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

    // Fire the job runner (non-blocking)
    if (queued > 0) {
      req.payload.jobs.run().catch((err: unknown) => {
        req.payload.logger.error({ err }, 'Regeneration job runner failed')
      })
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

    return Response.json({
      collectionSlug,
      total: total.totalDocs,
      complete: complete.totalDocs,
      errored: errored.totalDocs,
      pending: total.totalDocs - complete.totalDocs - errored.totalDocs,
    })
  }

  return handler
}
