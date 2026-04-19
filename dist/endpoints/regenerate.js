import { waitUntil } from '../utilities/waitUntil.js';
const GLOBAL_SLUG = 'image-optimizer-state';
async function getCollectionState(payload, slug) {
    try {
        const state = await payload.findGlobal({
            slug: GLOBAL_SLUG
        });
        return state?.collections?.[slug] || {};
    } catch  {
        return {};
    }
}
async function setCollectionState(payload, slug, update) {
    let existing = {};
    try {
        const state = await payload.findGlobal({
            slug: GLOBAL_SLUG
        });
        existing = state?.collections || {};
    } catch  {
    // Global may not exist yet
    }
    existing[slug] = {
        ...existing[slug],
        ...update
    };
    await payload.updateGlobal({
        slug: GLOBAL_SLUG,
        data: {
            collections: existing
        }
    });
}
export const createRegenerateHandler = (resolvedConfig)=>{
    const handler = async (req)=>{
        if (!req.user) {
            return Response.json({
                error: 'Unauthorized'
            }, {
                status: 401
            });
        }
        let body;
        try {
            body = await req.json();
        } catch  {
            body = {};
        }
        const collectionSlug = body.collectionSlug;
        if (!collectionSlug || !resolvedConfig.collections[collectionSlug]) {
            return Response.json({
                error: 'Invalid or unconfigured collection slug'
            }, {
                status: 400
            });
        }
        // Config is the source of truth — a client that sends `force: true` when
        // the plugin hasn't opted in gets the safe default (unoptimized only).
        const forceAllowed = resolvedConfig.regenerateButton.allowForceAll;
        const force = forceAllowed ? !!body.force : false;
        let queued = 0;
        if (body.docIds && body.docIds.length > 0) {
            // Regenerate specific documents by ID
            for (const docId of body.docIds){
                await req.payload.jobs.queue({
                    task: 'imageOptimizer_regenerateDocument',
                    input: {
                        collectionSlug,
                        docId: String(docId)
                    }
                });
                queued++;
            }
        } else {
            // Find all image documents in the collection
            // Unless force=true, skip already-processed docs
            const where = force ? {
                mimeType: {
                    contains: 'image/'
                }
            } : {
                and: [
                    {
                        mimeType: {
                            contains: 'image/'
                        }
                    },
                    {
                        or: [
                            {
                                'imageOptimizer.status': {
                                    not_equals: 'complete'
                                }
                            },
                            {
                                'imageOptimizer.status': {
                                    exists: false
                                }
                            }
                        ]
                    }
                ]
            };
            let page = 1;
            let hasMore = true;
            while(hasMore){
                const result = await req.payload.find({
                    collection: collectionSlug,
                    limit: 50,
                    page,
                    depth: 0,
                    where,
                    sort: 'createdAt'
                });
                for (const doc of result.docs){
                    await req.payload.jobs.queue({
                        task: 'imageOptimizer_regenerateDocument',
                        input: {
                            collectionSlug,
                            docId: String(doc.id)
                        }
                    });
                    queued++;
                }
                hasMore = result.hasNextPage;
                page++;
            }
        }
        req.payload.logger.info(`Image optimizer: queued ${queued} images from '${collectionSlug}' for regeneration`);
        // Clear any previous cancellation and record the start time + batch size
        await setCollectionState(req.payload, collectionSlug, {
            startedAt: Date.now(),
            cancelledAt: undefined,
            queued
        });
        // Fire the job runner — use waitUntil to keep the serverless function alive
        // after the response is sent, so jobs actually complete on Vercel/serverless.
        if (queued > 0) {
            const runPromise = req.payload.jobs.run({
                limit: queued,
                sequential: true
            }).catch((err)=>{
                req.payload.logger.error({
                    err
                }, 'Regeneration job runner failed');
            });
            waitUntil(runPromise, req);
        }
        return Response.json({
            queued,
            collectionSlug
        });
    };
    return handler;
};
export const createRegenerateStatusHandler = (resolvedConfig)=>{
    const handler = async (req)=>{
        if (!req.user) {
            return Response.json({
                error: 'Unauthorized'
            }, {
                status: 401
            });
        }
        const url = new URL(req.url);
        const collectionSlug = url.searchParams.get('collection');
        // Missing query param is still a client error.
        if (!collectionSlug) {
            return Response.json({
                error: 'Missing collection query param'
            }, {
                status: 400
            });
        }
        // An unconfigured collection is a legitimate "nothing to report" state for
        // a read-only status endpoint — answer with a well-formed no-op payload
        // instead of 400 so consumers can ignore the response without logging
        // errors. (POST/DELETE stay 400 — they have side effects.)
        if (!resolvedConfig.collections[collectionSlug]) {
            return Response.json({
                collectionSlug,
                configured: false,
                total: 0,
                complete: 0,
                errored: 0,
                pending: 0,
                cancelled: false,
                allowForceAll: resolvedConfig.regenerateButton.allowForceAll
            });
        }
        const total = await req.payload.count({
            collection: collectionSlug,
            where: {
                mimeType: {
                    contains: 'image/'
                }
            }
        });
        const complete = await req.payload.count({
            collection: collectionSlug,
            where: {
                mimeType: {
                    contains: 'image/'
                },
                'imageOptimizer.status': {
                    equals: 'complete'
                }
            }
        });
        const errored = await req.payload.count({
            collection: collectionSlug,
            where: {
                mimeType: {
                    contains: 'image/'
                },
                'imageOptimizer.status': {
                    equals: 'error'
                }
            }
        });
        // Include cancellation state so the UI can react
        const collState = await getCollectionState(req.payload, collectionSlug);
        const cancelled = !!(collState.cancelledAt && collState.startedAt && collState.cancelledAt > collState.startedAt);
        return Response.json({
            collectionSlug,
            configured: true,
            total: total.totalDocs,
            complete: complete.totalDocs,
            errored: errored.totalDocs,
            pending: total.totalDocs - complete.totalDocs - errored.totalDocs,
            cancelled,
            allowForceAll: resolvedConfig.regenerateButton.allowForceAll
        });
    };
    return handler;
};
export const createCancelHandler = (resolvedConfig)=>{
    const handler = async (req)=>{
        if (!req.user) {
            return Response.json({
                error: 'Unauthorized'
            }, {
                status: 401
            });
        }
        let body;
        try {
            body = await req.json();
        } catch  {
            body = {};
        }
        const collectionSlug = body.collectionSlug;
        if (!collectionSlug || !resolvedConfig.collections[collectionSlug]) {
            return Response.json({
                error: 'Invalid or unconfigured collection slug'
            }, {
                status: 400
            });
        }
        await setCollectionState(req.payload, collectionSlug, {
            cancelledAt: Date.now()
        });
        req.payload.logger.info(`Image optimizer: cancellation requested for '${collectionSlug}'`);
        return Response.json({
            cancelled: true,
            collectionSlug
        });
    };
    return handler;
};

//# sourceMappingURL=regenerate.js.map