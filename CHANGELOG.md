# Changelog

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
