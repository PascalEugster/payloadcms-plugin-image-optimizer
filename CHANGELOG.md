# Changelog

## 3.4.0 — Bypass MongoDB transactions on regen, bump maxDuration to 300s

Field reports surfaced that the regeneration task was hanging on large originals with "Transaction with { txnNumber: N } has been aborted." The root cause: MongoDB's default `transactionLifetimeLimitSeconds` is **60 seconds**, and the `payload.update({ file })` call in the task does the whole sharp + 3-upload pipeline inside one transaction. On a 10MB+ DSLR source with cloud storage, the pipeline routinely exceeds 60s. MongoDB then aborts the transaction, the primary throw cascades, and our catch-block writeback — still running against the same poisoned transaction — also fails. Result: a hung regen with no recorded error status, visible only as "task ran, never completed" in the job logs.

The fix requires neither an Atlas plan upgrade nor a cluster config change.

### Added

- **`regenerateUseTransactions` config option** (`boolean`, default `false`). Controls whether the regeneration task's primary `payload.update({ file })` wraps in a MongoDB transaction. Default is now OFF — the pipeline runs non-transactionally via Payload's first-class `disableTransaction: true` option (same primitive Payload core uses for its own job-queue writes). The 60s transaction ceiling stops applying.
- **Task-boundary error writeback is now *always* non-transactional**, regardless of `regenerateUseTransactions`. Ensures `imageOptimizer.status = 'error'` is reliably persisted on failure — previously, a primary-transaction abort would cascade and swallow the error status.

### Changed

- **Default `maxDuration` export bumped from 60 → 300.** Matches Vercel's current platform default (was 60/90 on older plans). Consumers who re-export `maxDuration` from `@inoo-ch/payload-image-optimizer` get an additional 240s of function runtime headroom for large regens; consumers who want a tighter ceiling can still set their own `export const maxDuration = <n>` on the route file, which takes precedence.

### Tradeoffs

- Atomicity loss on regen is now the norm. A partial failure (e.g. 2 of 3 blob uploads succeed before an error) can leave a doc in a mixed state. This is acceptable because (a) each regen is a single-doc operation with no cross-doc invariants, (b) the error status + task-boundary log identify affected docs, and (c) re-running regen is idempotent and recovers the state. Set `regenerateUseTransactions: true` if your app relies on atomic regens and you've bumped your cluster's transaction lifetime.

### Internal

- `resolveConfig()` in `src/defaults.ts` now emits `regenerateUseTransactions: boolean` on `ResolvedImageOptimizerConfig`.
- `src/tasks/regenerateDocument.ts` passes `disableTransaction: !resolvedConfig.regenerateUseTransactions` on the main update and a hard-coded `disableTransaction: true` on the error writeback.
- Tests: 119/119 passing (3 new unit tests for the resolver default + override behavior).

---

## 3.3.0 — Configurable structured logging for the regeneration task

`imageOptimizer_regenerateDocument` runs silently by default today. When it throws, the message lands in `imageOptimizer.error` on the document but the task-boundary error — with our collection/doc/duration context — never gets emitted by us. Downstream consumers have been working around this by wrapping the task handler in their own `onInit`. This release retires that workaround.

### Added

- **`logging` config option** — `'silent' | 'normal' | 'verbose'` or an object for fine-grained control. Defaults to `'silent'`: errors only, zero steady-state noise on the success path.
- **Structured Pino records at each task boundary.** Every record carries a stable `event` field (`imageOpt.regen.enter` / `exit` / `skipped` / `error` / `writebackFailed`) for log-aggregator filtering. Errors pass the thrown value as `err` so Pino's std serializer captures name/message/stack/cause — no manual destructuring, no arbitrary stack truncation.
- **`durationMs` on exit and error records**, captured at handler entry. Makes post-hoc latency-per-doc analysis trivial without hooking into the job runner's instrumentation.
- **Per-reason skip gating.** `logging.skips` accepts a boolean shorthand or `{ userCancelled?, docDeleted?, notImage? }` — `'normal'` mode logs `user-cancelled` (rare + intentional) while staying quiet for `doc-deleted` (retry noise on deleted docs) and `not-image` (high-volume misrouted queue). `'verbose'` enables all three.

### Changed

- **Task-boundary error log now fires *before* the status writeback, regardless of whether the writeback succeeds.** Previously the only structured error emission was `req.payload.logger.error` on writeback failure — the primary error got re-thrown and was only captured by Payload's generic job-runner log without our context. The new `imageOpt.regen.error` event carries `collectionSlug` / `docId` / `durationMs` / `err`.
- **Writeback failure gets its own event tag** (`imageOpt.regen.writebackFailed`) so log readers can distinguish "regen failed" from "regen failed AND we couldn't record it."
- Default behavior change is **additive only**: `'silent'` default means the only net-new log lines in steady state are errors (which you want). Lifecycle noise is opt-in.

### Downstream cleanup

Sites currently monkey-patching `imageOptimizer_regenerateDocument` from `payload.config.ts` `onInit` to wrap it with `enter` / `exit` / `throw` logs can delete that code and set `logging: 'normal'` (or `'verbose'`) to get equivalent behavior with structured `event` tags.

### Internal

- New `resolveLogging()` in `src/defaults.ts`; `ResolvedLoggingConfig` added to `ResolvedImageOptimizerConfig`.
- New `src/utilities/logger.ts` — `createRegenLogger(resolved, req)` with gated `enter` / `exit` / `skipped` / `error` methods. Keeps the task handler flat.
- Tests: 116 unit + integration, all passing (19 new logger tests).

---

## 3.2.0 — Parallel-wave regeneration on a dedicated job queue

Bulk regeneration was the last serial hotspot. The POST endpoint previously kicked `payload.jobs.run({ limit: queued, sequential: true })` inside `waitUntil`, which executed every queued job one-at-a-time inside a single serverless invocation. For a cloud-storage collection (where each job is dominated by a fetch-then-upload round-trip), the CPU and connection pool sat ~90% idle per job, and the whole batch died at the first function timeout — typically around 100 docs on Vercel's 300s default.

### Performance

- **Parallel waves, not sequential.** Removed `sequential: true`. `jobs.run` now executes `WAVE_SIZE` (20) jobs in parallel per wave. On cloud storage (S3, Vercel Blob, R2) where the task is network-bound, expect roughly 5–10× higher throughput per unit wall-clock.
- **Budgeted wave loop.** The endpoint now loops `jobs.run` wave-by-wave inside `waitUntil`, exiting cleanly on `result.noJobsRemaining`, a fresh cancellation signal, or a 270-second wall-clock budget. The budget leaves 30s of headroom under Vercel's 300s default function timeout so no wave gets cut off mid-upload. Remaining jobs — if any — stay queued for Payload autorun or the next POST (which via the `!force` where-clause only re-queues still-pending docs, making re-clicks idempotent).
- **Process-local cancellation cache.** A 1-second TTL `Map` fronts the `findGlobal` cancellation check inside the task handler. Without this, every 20-job wave would hit the global in near-lockstep. Linear drop in DB pressure (N → 1 per wave) for a ≤1s delay in cancel visibility — the endpoint's own between-wave check stays uncached, so wave-boundary decisions remain authoritative.

### Changed

- **Dedicated job queue.** Regeneration jobs are now queued into an `image-optimizer` queue via `payload.jobs.queue({ queue: 'image-optimizer', ... })` instead of the `default` queue. Isolation is the motivation: host-side cron autorun (Vercel Cron, Payload's built-in autorun, etc.) can target this queue without picking up — or being blocked by — jobs from other plugins. No migration needed: any existing queued jobs from previous versions still complete under the default queue via the plugin's task registration; new regenerations flow through the isolated queue.

### Internal

- New constants in `src/endpoints/regenerate.ts`: `IMAGE_OPTIMIZER_QUEUE`, `WAVE_SIZE` (20), `WAVE_BUDGET_MS` (270_000).
- New `isCancelled(req, slug)` helper in `src/tasks/regenerateDocument.ts` with module-scope `cancelCache` Map and `CANCEL_CACHE_TTL_MS` (1_000).
- No public API changes. Request/response shapes for all three endpoints are unchanged; the wave shape is entirely server-side. Tasks queued against the old `default` queue by pre-3.2 callers still complete — Payload's task registration is queue-agnostic.
- Tests: 75 unit + 22 integration, all passing.

---

## 3.1.0 — Regenerate endpoints: parallel counts, memoized status, batched job queue

### Performance

- **Status GET runs four reads in parallel.** `createRegenerateStatusHandler` was issuing three sequential `payload.count` queries (total / complete / errored) plus a `findGlobal`, so each poll paid ~4 round-trips of latency back-to-back. The handler now fans them out with `Promise.all`, collapsing the end-to-end cost to roughly one round-trip. Visible win on every admin poll and every navigation to the Media list.
- **Status payload memoized for 5s per collection.** The UI polls at 2s; the status shape changes slowly. A module-scope memo returns the last payload to subsequent polls within a 5s TTL, so ~60% of polls skip the database entirely. Memo is explicitly invalidated by POST (new batch) and DELETE (cancel) so UI state transitions are never served a stale copy.
- **Memo is race-safe against concurrent invalidation.** A per-slug generation counter bumps on every invalidation; status handlers capture the generation before their parallel reads and only write the memo if the counter still matches. Prevents the classic "in-flight read repopulates cache with pre-invalidation snapshot" footgun that would otherwise briefly serve `cancelled: false` right after a Stop click, or pre-queue counts right after a regen click.
- **Regenerate POST queues jobs in bounded-parallel chunks.** Was a serial `await payload.jobs.queue` per doc — for a 1k-image collection that held the admin UI on a spinner for ~30s before the response came back. Now chunked at 25 with `Promise.all`, collapsing the wall-clock cost by roughly 25×.

### Fixed

- **Concurrent regens on different collections no longer clobber each other's state.** `setCollectionState` read-modify-write on the shared `image-optimizer-state` global had no serialization; two near-simultaneous regens could each read the same baseline and overwrite each other's `startedAt` / `cancelledAt`. The write path now chains through an in-process promise, guaranteeing per-process ordering. Cross-instance races on Fluid Compute remain possible (regen is admin-triggered and rare) — documented in the source.

### Internal

- New helpers: `invalidateStatusMemo(slug)`, module-scope `statusMemo` / `statusGeneration` / `stateWriteChain` maps, `StatusPayload` type.
- Sequential pagination in POST preserved (50 docs per page) — the batching is applied to job queueing within each page.
- No public API changes. Same request/response shapes for all three endpoints.

---

## 3.0.3 — Fix slow regeneration on docs in populated folder hierarchies

### Fixed

- **Regeneration jobs now read the target doc with `depth: 0`.** The `imageOptimizer_regenerateDocument` task was calling `payload.findByID` and `payload.update` without specifying `depth`, so Payload defaulted to `depth: 2` and recursively populated every relation on the doc. On projects using Payload's folder feature (or any collection with deep nested relations), this meant each regen pulled a full folder tree — parent folders, sibling `documentsAndFolders` arrays — producing dozens of extra DB round-trips before the sharp pipeline even started. Production log analysis on a single regen showed ~12s spent in this prep phase for a 47KB WebP. The task now passes `depth: 0` on both the initial read and the `payload.update` call (we don't use the update's return value) — scalar fields are all that's needed. Expect 4-8s faster per regenerate on cloud-stored media in folder-heavy collections.

### Internal

- Matching `depth: 0` added to the catch-block error-writeback `payload.update` for consistency.

---

## 3.0.2 — Silence retry spam from regenerate jobs on deleted docs

### Fixed

- **Stale regenerate jobs no longer retry-loop against deleted docs.** When a media doc was deleted after a regenerate job was queued (possible in normal admin workflows), `imageOptimizer_regenerateDocument` would throw `NotFound` on its `findByID` call, bubble up through Payload's retry machinery, get retried twice, and each retry would ALSO fail the catch block's error-status writeback — producing repeated `"Failed to persist error status for image optimizer regeneration"` log entries for a single vanished doc. The task now detects `NotFound` (HTTP 404 APIError) at the initial read and returns `{ status: 'skipped', reason: 'doc-deleted' }` — terminal, no retries, no noise. The catch block has the same guard so a doc deleted mid-flight also resolves cleanly.

### Internal

- New `isNotFound(err)` helper checks `err.status === 404` — avoids a direct import of Payload's internal `NotFound` class while still matching it reliably.
- Regression test added: queue → delete → run, assert no "Failed to persist error status" log.

---

## 3.0.1 — Accurate savings stat when client-side optimization is on

### Fixed

- **`imageOptimizer.originalSize` now reflects the true pre-upload file size.** When `clientOptimization: true` (default), the browser canvas pre-resizes large images before upload, and the server-only `beforeOperation` snapshot could only see the already-shrunk buffer — so the admin UI's "saved X%" stat silently under-reported the real optimization win. The client now writes `file.size` into `imageOptimizer.originalSize` via `useField` before canvas runs, and `beforeChange` trusts that value subject to a guardrail (`clientReported >= serverReceivedSize`; otherwise falls back to the server snapshot). Uploads that bypass the admin UI (REST API, programmatic creates) are unaffected — the server fallback path gives the same value it always has.
- **Regeneration no longer collapses `originalSize` toward zero.** The `regenerateDocument` task previously passed `data: {}` to `payload.update`, so `beforeChange` re-resolved `originalSize` to the already-optimized stored buffer on each run. The task now carries forward the doc's existing `imageOptimizer.originalSize` through the same data path, which lets the hook's trust-but-verify logic handle both fresh uploads and regeneration uniformly.

### Internal

- Hoisted the `originalSize` resolution in `beforeChange` above the SVG and animated-GIF guard paths so all three write-sites report a consistent value.

---

## 3.0.0 — Honest positioning: remove features Payload already does

Breaking release. The plugin now only ships what Payload can't do natively. Everything Payload handles well (resize, format, EXIF strip, per-size variants, focal-point crops) stays configured through the plugin, but via one-to-one pass-throughs to `upload.formatOptions` / `upload.resizeOptions` / `upload.withMetadata`. The additional plumbing that existed to layer *on top of* that pipeline is gone.

See [MIGRATION.md](./MIGRATION.md) for the full v2.x → v3 migration guide.

### Removed

- **Additive multi-format variants.** The `convertFormats` task, the `afterChange` hook that queued it, the `imageOptimizer.variants` field, and the `formats: FormatQuality[]` (array) config are all gone. The feature only ever produced variants on local-disk storage — cloud storage paths (S3, Vercel Blob, R2) early-returned with `variants: []`. It was 150 lines of async job plumbing for a feature most production deployments couldn't use. For different formats per size, use Payload's native per-`imageSize.formatOptions`.
- **`replaceOriginal` option.** Without additive variants, `replaceOriginal: false` had no meaningful behavior. When `format` is set, the original is always replaced via Payload's native `upload.formatOptions`. To keep the original unchanged, pass `format: null`.
- **Status values `'pending'` and `'processing'`.** `beforeChange` now resolves status synchronously. The enum is `'complete' | 'error'`.
- **Context flags** `imageOptimizer_processedBuffer`, `imageOptimizer_statusResolved`, `imageOptimizer_hasUpload` — all were async-coordination plumbing, none needed.

### Changed (breaking)

- **`formats: FormatQuality[]` → `format: FormatQuality | null`.** Singular. Pass `null` to disable format conversion.
- **`CollectionOptimizerConfig`** mirrors the same change (`formats` → `format`, no more `replaceOriginal`).
- **`imageOptimizer.status` enum** narrowed to `'complete' | 'error'`.
- **`imageOptimizer.variants` field** removed from the group.

### Improvements this simplification enables

- **Upload is faster.** No async job, no `waitUntil` follow-up, no second document write. Every upload is one DB commit with the full `imageOptimizer` record.
- **Cloud storage atomicity improved.** The old flow could commit a new filename to the DB before the follow-up blob upload completed — if the follow-up failed, the DB referenced a missing blob. That failure window is gone.
- **Regeneration simplified.** The `regenerateDocument` task no longer has to coordinate with a downstream `convertFormats` job.
- **Smaller plugin.** ~250 fewer lines of non-delegating plumbing.

### Unchanged

- Everything you actually use day-to-day: `clientOptimization`, `generateFilename` + strategies, `generateThumbHash`, `adminThumbnail`, `responseHeaders`, `metadataPolicy` / `stripMetadata`, `regenerateButton`, `<ImageBox>` / `<FadeImage>` / `getOptimizedImageProps()` / `createVariantLoader()`, the REST endpoints.

### Tests

96/96 passing: 8 test files (7 unit + 1 integration) + 1 e2e admin smoke test.

---

## 2.2.0 — Lifecycle audit fixes

A maintenance release from an end-to-end audit of the upload → save → read lifecycle. Seven fixes land together — each disjoint, unit-covered, and verified against the dev admin. One minor type tightening is technically breaking but runtime-identical.

### Fixed

- **`seoFilename` no longer collapses non-Latin alt text to `media-*`.** `stripDiacritics` only removes combining marks; Cyrillic / CJK / Arabic / Greek characters were wiped by the subsequent ASCII-only regex, producing collision-prone fallback filenames. When the kebab-cased slug would be empty, the strategy now appends an 8-char SHA-256 hash — `img-a3f7b2c1-20260420T104530123Z.webp` — so non-Latin inputs still get unique, recognizable filenames. No new dependencies.

- **`seoFilename` timestamp now keeps milliseconds.** Previously had 1-second resolution; two uploads in the same second with the same alt text produced identical filenames. Matches `timestampFilename`'s `YYYYMMDDTHHMMSSmmmZ` format.

- **Multi-format variants regenerate on focal-point changes.** When a user adjusted focal point or crop, Payload's native re-upload refreshed the parent WebP and all `sizes`, but the additive AVIF/secondary-format variants kept pointing at buffers produced from the pre-change crop. The `convertFormats` job now re-runs on native re-uploads in multi-format collections, reading the freshly-written parent so variants match the new crop.

- **`adminThumbnail: 'auto'` no longer downloads full-size originals in list views.** It now picks the smallest-by-width entry from `doc.sizes`, falling back to `/api/{slug}/file/{filename}` only when no size has a valid URL. A 50-row list that previously pulled 50 × 2560-wide WebPs now pulls 50 × thumbnail-size files.

- **Responsive-image cache-bust URLs are now URL-safe.** `createVariantLoader` was appending the raw ISO timestamp as `?2026-04-20T10:45:30.123Z` — browsers tolerate it, some CDNs and proxies don't. Now emits `?v={encoded}`; when the variant URL already contains `?` (e.g. signed CDN URL) the separator flips to `&`.

- **`fetchFileBuffer` accepts an explicit `serverURL` parameter.** The internal helper previously relied on `NEXT_PUBLIC_SERVER_URL` (a Next.js-only env convention) to build absolute URLs from relative `doc.url`. It now takes the server URL as an argument; both tasks (`convertFormats`, `regenerateDocument`) thread `req.payload.config.serverURL` through. `NEXT_PUBLIC_SERVER_URL` is kept as a last-resort fallback for backwards compatibility.

- **Client-side Canvas resize preserves alpha.** WebP / BMP / TIFF uploads with transparency were silently flattened to JPEG. A sparse RGBA scan after draw now detects alpha; when present the output is PNG (correctness over size). JPEGs skip the scan. Tainted canvases fall back to PNG too.

- **Upload guards for zero-byte, SVG, and animated GIF.** SVG uploads now save with `imageOptimizer.status = 'complete'` instead of being rasterized to blurry WebP. Animated GIFs (detected via `sharp().metadata().pages > 1`) get the same treatment — no silent flattening to a single-frame WebP. Zero-byte buffers return without touching anything (Payload's upstream check already rejects them with a FileUploadError).

### Breaking (type-level only)

- **`MetadataPolicy` signature no longer declares `req`.** Payload's `withMetadata` callback never actually passed `req` — it was always `undefined` at runtime. The type is now `(args: { metadata: any }) => boolean | Promise<boolean>`. Destructuring `req` from the argument will now emit a TS error, but the runtime value was already `undefined`, so the behavior on that field is unchanged.

### Other

- `OptimizationStatus` edit-page panel now shows "Optimize this image" (instead of an empty placeholder) when no optimization record exists yet, so legacy docs without `imageOptimizer` can be kicked into the pipeline from the edit view.

---

## 2.1.2 — New `timestampFilename` strategy

Additive, non-breaking. Adds a third built-in filename strategy for users who want to keep the original filename but need collision-free uniqueness without UUID noise or alt-text dependency.

### Added

- **`timestampFilename`** — exported from the package root alongside `uuidFilename` and `seoFilename`. Takes the original filename stem (slugified — diacritics stripped, kebab-cased, truncated to 60 chars) and appends an ISO timestamp with milliseconds.

  ```ts
  import { imageOptimizer, timestampFilename } from '@inoo-ch/payload-image-optimizer'

  imageOptimizer({
    collections: { media: true },
    generateFilename: timestampFilename, // Geländer.jpg → gelander-20260420T104530123Z.webp
  })
  ```

  Milliseconds are included (unlike `seoFilename`'s second precision) because the stem alone provides no variation between two uploads of the same source file.

  Re-upload behavior (crop / focal point edits) reuses the existing stem to avoid cloud-storage churn, same as the other two built-ins.

### Choosing a strategy

| Strategy | Output | When to use |
|---|---|---|
| `uuidFilename` | `a1b2c3d4-e5f6-....webp` | You want total collision avoidance and don't care about readability. Shortest filenames. |
| `seoFilename` | `gelander-aus-edelstahl-20260420T104530Z.webp` | You have meaningful `altText` and want URLs that describe the content. |
| `timestampFilename` | `gelander-foto-20260420T104530123Z.webp` | You curated filenames before upload and want them preserved, but still need uniqueness. |

All three are subject to the same `clientUploads: true` incompatibility documented in 2.1.1 — use `addRandomSuffix: true` on the storage adapter in that mode.

---

## 2.1.1 — Docs: `clientUploads` incompatibility with `generateFilename`

Documentation-only patch. No code changes.

### Docs

- **README + AGENT_DOCS**: clarified that `@payloadcms/storage-vercel-blob`'s `clientUploads: true` is **incompatible** with this plugin's `generateFilename` (including `seoFilename` and `uuidFilename`).

  **Why**: verified against upstream source — when `clientUploads: true`, the browser PUTs directly to Blob using a signed URL whose pathname is locked at sign time (`getClientUploadRoute.ts`'s `onBeforeGenerateToken` can only decide `addRandomSuffix`, not the pathname). On the follow-up metadata POST, `plugin-cloud-storage`'s `afterChange` hook filters files with `clientUploadContext` set before calling `adapter.handleUpload`, so any server-side rename just desyncs `data.filename` from the actual blob pathname → 404s. Same mechanism means server-side `upload.formatOptions` / `upload.resizeOptions` on the parent are computed then discarded — the blob retains the browser's original bytes. Per-size `imageSizes` still work (separate code path).

- **New compatibility matrix** in both docs showing which plugin features work under each `clientUploads` mode.
- **Corrected guidance**: with `clientUploads: true`, use `addRandomSuffix: true` on the storage adapter — that's the only filename-uniqueness approach that survives client uploads. `generateFilename` (including `seoFilename`) requires the Payload default `clientUploads: false`.
- **Repositioned client-side pre-resize** as the primary workaround for Vercel's 4.5MB serverless body limit, since `clientOptimization` (on by default) keeps most photos under the limit without requiring `clientUploads: true` and its trade-offs.

## 2.1.0 — Honest positioning + `uniqueFileNames` removed

A documentation and API-cleanup release following an audit of what this plugin actually adds on top of Payload core. No behavior changes for images; no hook rewrites.

### Breaking

- **`uniqueFileNames` option removed.** It was already marked `@deprecated` in 2.0.0 and was a straight alias for `generateFilename: uuidFilename`. If you were relying on it, update your config:

  ```ts
  // Before
  imageOptimizer({ collections: { media: true }, uniqueFileNames: true })

  // After
  import { imageOptimizer, uuidFilename } from '@inoo-ch/payload-image-optimizer'
  imageOptimizer({ collections: { media: true }, generateFilename: uuidFilename })
  ```

  TypeScript will flag this as an unknown property. Nothing else changes — `uuidFilename` produces the same UUID-stem output.

### Docs

- **README rewritten to be honest about what Payload does natively.** Previous Features section read like the plugin owned format conversion, resize, and EXIF stripping — all of which Payload 3 exposes via `upload.formatOptions`, `upload.resizeOptions`, and `upload.withMetadata`. New structure separates:
  - *Things Payload can do natively — this plugin makes them turnkey* (coordinated defaults, per-collection overrides, opinionated quality ladder)
  - *Things Payload does not do out of the box* (ThumbHash, bulk regeneration, status UI, client pre-resize, filename strategies, Next.js display components)
- **New "Native edge cases this plugin handles for you" subsection** documenting three real gotchas the plugin closes:
  - `withoutEnlargement: undefined` silent drop of small images from `imageSizes`
  - Per-size `formatOptions` does not inherit from `upload.formatOptions`
  - Sharp-skip EXIF leak when no transform is configured (plugin's injected `resizeOptions` + `formatOptions` guarantee sharp always runs)
- **`stripMetadata` option docs rewritten** — it no longer claims to own EXIF stripping (sharp does that when it runs); it's now documented as guaranteeing sharp *always* runs, which is the real contribution.
- **AGENT_DOCS migration section updated** with a v2.0.x → v2.1.0 block.

### Investigation artifacts

Under `.planning/investigation/`:
- `payload-native-audit.md` — what Payload core 3.79 does out of the box, with source cites
- `plugin-surface-map.md` — 21 plugin features tiered A/B/C against native coverage
- `RECOMMENDATIONS.md` — cut/keep synthesis, which drove this release

---

## 2.0.0 — Config-injection architecture

**Breaking change.** The plugin no longer runs its own sharp pipeline for resize, format conversion, or metadata stripping. Instead, at plugin init it resolves your options and injects them onto each targeted upload collection as native Payload upload config:

- `upload.formatOptions = { format: formats[0].format, options: { quality } }` (when `replaceOriginal: true`)
- `upload.resizeOptions = { ...maxDimensions, fit: 'inside', withoutEnlargement: true }`
- `upload.withMetadata = false` (when `stripMetadata: true`)
- Per-`imageSize` `formatOptions` so every size lands as `.webp` natively

Payload's own `generateFileData()` then handles the entire image pass in a single sharp pipeline. The plugin's hooks only own:

- ThumbHash placeholder generation
- Optimization status (originalSize, optimizedSize, status)
- Optional filename strategy (`uuidFilename`, `seoFilename`, custom)
- Additive multi-format variants (e.g. AVIF alongside the WebP primary) via the existing `imageOptimizer_convertFormats` job
- Regeneration via `payload.update({ file })` which re-triggers the native pipeline

### What changed for users

The user-facing `ImageOptimizerConfig` shape is unchanged. Existing configs work as-is.

- **Per-size files now carry the converted extension** (e.g. `media-300x225.webp` instead of `media-300x225.jpg`). If you persisted size filenames anywhere outside Payload, they will need to be regenerated.
- **The `imageOptimizer.variants` array is empty for single-format collections.** v1 used to push the primary format into `variants` even when it was already the parent file; v2 only populates `variants` with formats beyond the primary.
- **Non-override rule:** if you already set `upload.formatOptions`, `upload.resizeOptions`, `upload.withMetadata`, or per-size `formatOptions` on your collection, the plugin leaves your value intact.

### Why

Running sharp ourselves duplicated work Payload already did, fought with cloud-storage adapters that consumed `req.file.data`, and required hooks that mutated buffers Payload had already captured by reference. Letting Payload do the encoding is fewer moving parts, fewer race conditions, and fewer custom format-aware code paths.

### Migration

Bump the dependency. No code changes needed for typical setups. If you have pre-existing `formatOptions` / `resizeOptions` on a Payload upload collection, the plugin will respect them — or remove them and let the plugin manage them via its own config.

### UploadOptimizer: Save-gate + hardened fallbacks

Addresses a client-side race where the Payload admin could POST `/api/media` before `UploadOptimizer`'s async Canvas resize finished. In production this surfaced as a 400 "MissingFile" log entry preceding every successful 201; locally it manifested as the resize being silently discarded (the oversized original was sent instead).

- Save is now gated via `useDocumentInfo().setUploadStatus('uploading')` for the duration of the resize — Payload's `SaveButton` short-circuits on this status, so submit never runs with a stale field snapshot. Reset on completion, error, and unmount.
- Visible "Optimizing image…" spinner hint below the upload widget while resizing, with new i18n key `plugin-imageOptimizer:optimizing` (en / de / fr).
- `resizeImage` extracted to `src/utilities/clientResize.ts` and hardened — every failure path (`createImageBitmap` throw, `canvas.toBlob` null, empty blob, missing 2D context) falls back to the original `File` rather than producing a garbage `File` from a null BlobPart.

### Additional config-injection options (additive, non-breaking)

- **`adminThumbnail`** — `'auto' | string | function`, defaults to `'auto'`. The `'auto'` mode injects a function that returns a URL from `doc.filename`, so admin thumbnails survive the v2 parent-extension change (e.g. `.jpg` → `.webp`). String and function modes pass through to Payload as-is. Honors the non-override rule.
- **`responseHeaders`** — opt-in cache header policy. `'immutable'` injects `Cache-Control: public, max-age=31536000, immutable` for file responses; the plugin emits a `payload.logger.warn` at init if no `generateFilename` is set (re-uploads under the same filename would be served stale). A function form is passed through. Honors the non-override rule.
- **`metadataPolicy`** — richer alternative to `stripMetadata: boolean`. When set, takes precedence over `stripMetadata` and is passed through as Payload's `withMetadata` callback (`true` keeps, `false` strips). Honors the non-override rule.
- **`generateImageName` per-size injection — descoped.** Documented as a TODO in `src/index.ts`. Payload's `generateImageName` callback runs without access to document data (no altText, no MIME beyond what `extension` carries), so user strategies like `seoFilename` cannot produce meaningful per-size names. Will revisit if Payload exposes `data` to the callback.

---

## 1.12.1
- Fix log noise from GET regenerate on unconfigured collections

## 1.12.0
- Safer regenerate defaults: unoptimized-first + per-doc button

## 1.11.1
- Fix aspect-mismatched variants polluting responsive srcsets
