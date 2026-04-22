# @inoo-ch/payload-image-optimizer

Agent-oriented reference for v3.0.0. This file is the deeper companion to `README.md` — for the prose introduction and comparison tables, read the README first. This document focuses on the facts an LLM needs when wiring the plugin into a Payload CMS 3.x codebase or debugging its behavior.

For v2.x → v3 migration, see `MIGRATION.md`.

## Installation

```bash
pnpm add @inoo-ch/payload-image-optimizer
```

Peer requirements:

- Payload CMS `^3.37.0`
- Next.js `^14` or `^15`
- React `^18` or `^19`
- Node.js `^18.20.2` or `>=20.9.0`
- `sharp` is provided transitively by Payload — do not install separately.

Minimum config:

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { imageOptimizer } from '@inoo-ch/payload-image-optimizer'
import sharp from 'sharp'

export default buildConfig({
  collections: [
    { slug: 'media', fields: [], upload: { staticDir: './media' } },
  ],
  plugins: [
    imageOptimizer({
      collections: { media: true },
    }),
  ],
  sharp,
})
```

## Architecture (v3)

v3 **does not run its own sharp pipeline** for resize, format conversion, or metadata stripping. At plugin init (`src/index.ts`), the plugin resolves your options and **injects them onto each targeted collection's `upload` config**. Payload's native `generateFileData()` then owns the encoding.

### Keys injected onto `collection.upload`

All injections obey the **non-override rule**: if the user already set the key on their collection, the plugin leaves the existing value intact.

| Key | Value produced | Condition |
|-----|----------------|-----------|
| `upload.formatOptions` | `{ format: format.format, options: { quality: format.quality } }` | A `format` is configured (non-null) **and** `userUpload.formatOptions === undefined` |
| `upload.resizeOptions` | `{ width, height, fit: 'inside', withoutEnlargement: true }` from `maxDimensions` | `userUpload.resizeOptions === undefined` |
| `upload.withMetadata` | `metadataPolicy` callback, or `false` when `stripMetadata: true`, else unset | `userUpload.withMetadata === undefined` |
| `upload.imageSizes[i].formatOptions` | Same as parent `formatOptions` | A `format` is set **and** that size doesn't already have `formatOptions` |
| `upload.adminThumbnail` | Function preferring smallest `doc.sizes[*].url`, falling back to `/api/{slug}/file/{filename}` for `'auto'`; else pass-through | `userUpload.adminThumbnail === undefined` and `adminThumbnail !== false` |
| `upload.modifyResponseHeaders` | `Cache-Control: public, max-age=31536000, immutable` for `'immutable'`, else pass-through | `userUpload.modifyResponseHeaders === undefined` and `responseHeaders !== false` |

The per-`imageSize` `formatOptions` injection is why v3 produces `.webp` files for every configured size (e.g., `media-300x225.webp` instead of `.jpg`). Payload's `createImageSizes` derives the extension from the produced MIME type.

### What the plugin still owns in v3

Hooks registered on each targeted collection:

- `beforeOperation` — snapshot `req.file.size` into `req.context.imageOptimizer_originalSize` before `generateFileData()` mutates it.
- `beforeChange` — apply optional filename strategy, compute `imageOptimizer.originalSize/optimizedSize`, run ThumbHash inline, short-circuit on native re-uploads (focal point/crop). **Resolves synchronously — status is always `'complete'` when the upload returns.**

Other plugin-owned surfaces:

- One Payload job task: `imageOptimizer_regenerateDocument` (`retries: 2`), queued into a dedicated `image-optimizer` queue so host cron autorun can target it without interfering with the `default` queue. Only runs when the regenerate button fires.
- Three REST endpoints at `/api/image-optimizer/regenerate` (POST/GET/DELETE).
- An `image-optimizer-state` hidden global (stores per-collection `startedAt`, `cancelledAt`, `queued`).
- Injected admin components: `UploadOptimizer` (replacing the default upload component when `clientOptimization` is on) and `RegenerationButton` (beforeListTable, when `regenerateButton.enabled`).
- i18n translations merged via `deepMergeSimple`.

### What v3 dropped from v2

- **`afterChange` hook** — only existed to queue the convertFormats job, which no longer exists.
- **`convertFormats` task** — additive multi-format variants (e.g. AVIF sibling next to WebP). Only ever worked on local disk; cloud storage paths early-returned.
- **`imageOptimizer.variants` field** — unused without additive variants.
- **`formats: FormatQuality[]`** — collapsed to `format: FormatQuality | null` (singular).
- **`replaceOriginal`** — had no meaningful behavior once additive variants were gone.
- **Status enum values `'pending'` / `'processing'`** — beforeChange is synchronous; status is `'complete' | 'error'`.
- **Context flags** `imageOptimizer_processedBuffer`, `imageOptimizer_statusResolved`, `imageOptimizer_hasUpload` — async-coordination plumbing, no longer needed.

## Configuration Reference

### Top-level options (`ImageOptimizerConfig`)

```ts
export type ImageOptimizerConfig = {
  adminThumbnail?: AdminThumbnailOption
  clientOptimization?: boolean
  collections: Partial<Record<CollectionSlug, true | CollectionOptimizerConfig>>
  disabled?: boolean
  fieldsOverride?: FieldsOverride
  format?: FormatQuality | null
  generateFilename?: GenerateFilename
  generateThumbHash?: boolean
  storeBlurDataURL?: boolean
  maxDimensions?: { width: number; height: number }
  metadataPolicy?: MetadataPolicy
  regenerateButton?: boolean | RegenerateButtonConfig
  responseHeaders?: ResponseHeadersOption
  stripMetadata?: boolean
}
```

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `collections` | `Record<slug, true \| CollectionOptimizerConfig>` | **required** | Which upload collections to target. `true` = use globals. |
| `format` | `FormatQuality \| null` | `{ format: 'webp', quality: 80 }` | Target format and quality. Injected as `upload.formatOptions` on the parent + every `imageSize`. Pass `null` to disable format conversion (original extension preserved). |
| `maxDimensions` | `{ width, height }` | `{ 2560, 2560 }` | Injected as `resizeOptions` with `fit: 'inside'`, `withoutEnlargement: true`. |
| `stripMetadata` | `boolean` | `true` | Sets `upload.withMetadata = false` AND ensures the plugin's injected `formatOptions`/`resizeOptions` always trigger sharp so EXIF is actually stripped (native Payload skips sharp — and preserves EXIF — when no transform is configured). Ignored when `metadataPolicy` is set. |
| `metadataPolicy` | `(args: { metadata }) => boolean \| Promise<boolean>` | — | Richer alternative. Passed through as Payload's `withMetadata` callback. Return `true` to keep, `false` to strip. Takes precedence over `stripMetadata`. |
| `generateThumbHash` | `boolean` | `true` | Plugin-owned. Runs inline in `beforeChange` — lands in the initial DB write. |
| `storeBlurDataURL` | `boolean` | `false` | Opt-in. When `true`, appends a hidden, readOnly `imageOptimizer.blurDataURL` text field and pre-decodes the ThumbHash into its base64 PNG data URL once per upload in `beforeChange` via the internal `decodeThumbHashToDataURL()` helper. `getImageOptimizerProps()` prefers the stored value and skips the per-render `thumbHashToDataURL` decode. Falls back to runtime decode when the field is absent — full back-compat with docs uploaded before the flag was set. Trade-off: ~1–3 KB/doc extra on disk and in every listing-endpoint response. Backfill existing docs via the regeneration task (it re-runs `beforeChange`). |
| `generateFilename` | `(args: GenerateFilenameArgs) => string` | — | Returns filename **stem** (no extension). Built-ins: `uuidFilename`, `seoFilename`, `timestampFilename`. **Incompatible with `clientUploads: true`** — blob pathname is locked at sign time (`@payloadcms/storage-vercel-blob`'s `getClientUploadRoute`); any rename in `beforeChange` would desync DB from blob. With `clientUploads: true`, use `addRandomSuffix: true` on the storage adapter instead. |
| `clientOptimization` | `boolean` | `true` | Replace the admin upload component with `UploadOptimizer` (Canvas pre-resize). |
| `regenerateButton` | `boolean \| { enabled?, allowForceAll? }` | `true` | Controls the collection-list regeneration button and whether "Force re-process all" is exposed. |
| `adminThumbnail` | `'auto' \| string \| function` | `'auto'` | See below. |
| `responseHeaders` | `false \| 'immutable' \| function` | `false` | See below. |
| `fieldsOverride` | `({ defaultFields }) => Field[]` | — | Customize the injected `imageOptimizer` group field. |
| `disabled` | `boolean` | `false` | Keep fields injected but skip hooks, jobs, endpoints, and the global. |

### `adminThumbnail: AdminThumbnailOption`

```ts
type AdminThumbnailOption =
  | 'auto'
  | string
  | ((args: { doc: { filename?: string | null } }) => string | null | undefined)
```

- `'auto'` (default): returns the URL of the smallest-by-width entry in `doc.sizes` (so list views don't pull the full parent), falling back to `/api/{collection.slug}/file/{doc.filename}` when no sizes are available.
- `string`: passed through to Payload as a size-name reference (e.g., `'thumbnail'`).
- function: passed through as-is.

The reason for `'auto'` is that format conversion renames the parent from `.jpg` to `.webp`. A hand-written URL helper that appended `.jpg` would break; reading `doc.filename` always sees the converted extension.

### `responseHeaders: ResponseHeadersOption`

```ts
type ResponseHeadersOption =
  | false
  | 'immutable'
  | ((headers: Headers, args: { doc: unknown }) => Headers | void)
```

- `false` (default): no-op.
- `'immutable'`: injects `modifyResponseHeaders` that sets `Cache-Control: public, max-age=31536000, immutable`. **At init the plugin emits `payload.logger.warn` (falling back to `console.warn`) if `generateFilename` is not set**, because a re-upload under the same filename would be cached as immutable for a year by intermediaries.
- function: passed through. Note: Payload's `modifyResponseHeaders` currently only passes `{ headers }`; the plugin adapts your `(headers, { doc })` signature and the `doc` is currently `undefined` until Payload exposes it.

### `metadataPolicy: MetadataPolicy`

```ts
type MetadataPolicy = (args: { metadata: any }) => boolean | Promise<boolean>
```

Example (keep EXIF on JPEGs only):

```ts
imageOptimizer({
  collections: { media: true },
  metadataPolicy: ({ metadata }) => metadata.format === 'jpeg',
})
```

### Per-collection overrides (`CollectionOptimizerConfig`)

```ts
type CollectionOptimizerConfig = {
  format?: FormatQuality
  maxDimensions?: { width; height }
}
```

Only these two keys can be overridden per collection. Everything else (`stripMetadata`, `generateThumbHash`, `generateFilename`, `clientOptimization`, etc.) is global.

```ts
imageOptimizer({
  collections: {
    media: true,
    avatars: {
      format: { format: 'webp', quality: 90 },
      maxDimensions: { width: 256, height: 256 },
    },
  },
})
```

## Hook Lifecycle (v3)

The two hooks the plugin attaches, in order:

### `beforeOperation` (`src/hooks/beforeOperation.ts`)

Runs only for `create`/`update` operations on requests where `req.file.mimetype` starts with `image/` and `req.file.size` is a number. Writes `req.context.imageOptimizer_originalSize = req.file.size` before Payload's `generateFileData()` mutates `req.file.data`/`req.file.size` in place.

Required because by the time `beforeChange` runs, `req.file.size` reflects the **post-resize/format** buffer and the original byte count is gone.

### `beforeChange` (`src/hooks/beforeChange.ts`)

Short-circuits when any of these hold:

- `context.imageOptimizer_skip === true`
- No `req.file` / no `req.file.data` / `mimetype` not `image/*`
- `req.file.data.length === 0` (zero-byte guard — let Payload's upstream validation handle the error)
- `req.file.mimetype === 'image/svg+xml'` (SVG guard — sharp would rasterize the vector; write `status: 'complete'` and return)
- `req.file.mimetype === 'image/gif'` and `sharp(buf).metadata().pages > 1` (animated GIF guard — sharp's `.toFormat('webp')` silently drops frames; write `status: 'complete'` and return)
- **Native re-upload detection**: `originalDoc && !context.imageOptimizer_regenerating && req.file.name === originalDoc.filename`. This is how Payload's `shouldReupload()` re-stamps a file after a focal point / crop change — re-feeding the stored (already-optimized) file. The hook preserves the existing `imageOptimizer` group, sets `context.imageOptimizer_nativeReupload = true`, and returns. The regeneration task uses the same re-upload shape but sets `imageOptimizer_regenerating` so it doesn't short-circuit.

Otherwise:

1. If `resolvedConfig.generateFilename` is set, compute `stem` from `{ altText, originalFilename, mimeType, collectionSlug, existingFilename }`, read the extension from `data.filename` (set by `generateFileData` with the converted extension) or `req.file.name`, and write both `req.file.name = stem + ext` and `data.filename = stem + ext`.
2. Read `originalSize` from `context.imageOptimizer_originalSize` (falls back to `req.file.data.length` when the snapshot is missing, in which case `originalSize === optimizedSize`).
3. `optimizedSize = req.file.data.length` (this is the post-sharp buffer Payload will persist).
4. Stamp `data.imageOptimizer = { originalSize, optimizedSize, status: 'complete', error: null }`.
5. If `generateThumbHash`, run `generateThumbHash(req.file.data)` **inline** and set `data.imageOptimizer.thumbHash`. Lands in the same DB write.
6. If `storeBlurDataURL` *and* the ThumbHash is present, run `decodeThumbHashToDataURL(thumbHash)` and set `data.imageOptimizer.blurDataURL`. Also inline, same DB write. Skipped when `storeBlurDataURL: false` (the default).

No afterChange hook. No async jobs queued on upload. The doc is returned fully stamped.

## Client-side Canvas optimization

When `clientOptimization: true` (default), the plugin injects `@inoo-ch/payload-image-optimizer/client#UploadOptimizer` as the collection's `admin.components.edit.Upload` **only if the user hasn't already set one**.

### `UploadOptimizer` (`src/components/UploadOptimizer.tsx`)

- Renders Payload's stock `<Upload>` plus a status hint.
- Subscribes to the `file` field via `useField<File | null>`.
- On each new `File` instance it hasn't processed yet:
  1. Calls `setUploadStatus?.('uploading')` from `useDocumentInfo()`. **This gates Payload's `SaveButton`** so Save is blocked while the Canvas resize runs. Without this gate, submit would snapshot the field before `setFileValue(resized)` lands, either sending the oversized original or (on Vercel) reaching `/api/media` with an empty body and getting `MissingFile` 400.
  2. Sets `optimizing = true` to render a spinner + the translated label `plugin-imageOptimizer:optimizing` (falls back to `"Optimizing image…"`).
  3. Awaits `resizeImage(file)`.
  4. If not cancelled, tracks the resized file in a `WeakSet` and calls `setFileValue(resized)`.
  5. In `finally`, resets `optimizing = false` and `setUploadStatus?.('idle')`.
- Cleanup (`cancelled = true`) also re-enables Save to avoid leaving it blocked forever on unmount.

### `resizeImage` (`src/utilities/clientResize.ts`)

Defaults: `maxWidth = 2560`, `maxHeight = 2560`, `jpegQuality = 0.85`. Resizable types: `image/jpeg`, `image/png`, `image/webp`, `image/bmp`, `image/tiff`. Other MIME types (e.g. SVG, GIF) are returned unchanged.

**Every failure path falls back to the original `File`** — never a null/empty File:

- `createImageBitmap(file)` throws → return original (corrupt image, unsupported subtype, OOM).
- Image already within bounds → `bitmap.close()` and return original.
- `canvas.getContext('2d')` returns `null` → `bitmap.close()` and return original.
- `canvas.toBlob` resolves `null` or a `blob.size === 0` → return original.

On success: output is `image/png` when the source has any alpha pixel (sparse RGBA scan after draw), otherwise `image/jpeg`. JPEGs skip the alpha scan (always opaque). Tainted canvases fall back to PNG.

Server-side format conversion (WebP/AVIF), ThumbHash, and per-size variants still run on the server even with client optimization enabled — the client only replaces the **resize** step.

### Limitation

Client optimization only applies to single-file uploads in the admin panel. Bulk uploads and API/programmatic `payload.create({ file })` calls skip the component entirely.

## Admin UI

### `OptimizationStatus` (document sidebar)

Injected as a sidebar component on each targeted collection. Displays:

- Status badge (`complete` / `error`).
- Original vs optimized size + savings percentage.
- ThumbHash blur preview thumbnail.
- Per-document "Regenerate this image" button.

The component polls `/api/{slug}/{id}?depth=0` every 2s only while a user-initiated regeneration is in flight. Fresh uploads don't poll — the status is terminal by the time the save response returns.

### `RegenerationButton` (collection list)

Injected as `admin.components.beforeListTable` when `regenerateButton.enabled` (default true). Default action is `"Regenerate N Unoptimized"` (or `"All images optimized"` when nothing pending). Selecting rows scopes the action to those IDs.

The full-collection `"Force re-process all"` checkbox is hidden unless `regenerateButton: { allowForceAll: true }` is set. The client may send `force: true` anyway, but the server ignores it when `allowForceAll` is false.

Progress polling fires the `GET` endpoint every 2 seconds and detects stalls.

## REST API

All three endpoints are mounted at `/api/image-optimizer/regenerate` and require `req.user`. Implemented in `src/endpoints/regenerate.ts`.

### `POST /api/image-optimizer/regenerate`

Request body:

```json
{
  "collectionSlug": "media",
  "force": false,
  "docIds": ["optional-array-of-ids"]
}
```

- 401 if unauthenticated.
- 400 if `collectionSlug` missing or **not configured** for the plugin.
- `force` is coerced to `false` server-side unless `regenerateButton.allowForceAll` is true.
- With `docIds`: queues one `imageOptimizer_regenerateDocument` per ID (no pagination).
- Without `docIds`: paginates `payload.find` (50 per page, `sort: 'createdAt'`, `depth: 0`). Query is `{ mimeType: { contains: 'image/' } }` plus a status filter (`not_equals: 'complete'` OR `exists: false`) unless `force` is true.
- Jobs are queued into a dedicated `image-optimizer` queue (via `payload.jobs.queue({ queue: 'image-optimizer', ... })`) — not the `default` queue. This isolates regen from other plugins' cron autorun and lets you target this queue from a host-side scheduler if you want.
- Writes `{ startedAt: Date.now(), cancelledAt: undefined, queued }` to the `image-optimizer-state` global for this slug.
- Kicks a **wave loop** inside `waitUntil` (so jobs progress past the response on Vercel/serverless without a separate cron runner): each wave runs `payload.jobs.run({ queue: 'image-optimizer', limit: 20 })` — parallel by default (`sequential` omitted). The loop repeats until `result.noJobsRemaining === true`, a cancellation signal is observed, or the 270-second wall-clock budget is exceeded (leaves a 30s buffer under Vercel's 300s default function timeout). If the budget exhausts, remaining jobs stay queued — Payload autorun (if configured) picks them up; otherwise the next POST re-queues only the still-pending docs (the `!force` where-clause excludes `'complete'`).
- Response: `{ queued: number, collectionSlug: string }` — returns immediately after queueing, before any wave has finished running.

### `GET /api/image-optimizer/regenerate?collection=<slug>`

- 401 if unauthenticated.
- 400 if `collection` query param missing.
- **200 `{ configured: false, ... }` for unconfigured collections** (read-only status shouldn't generate error-log noise for UI polling on collections the plugin doesn't manage).
- Happy path returns:
  ```json
  {
    "collectionSlug": "media",
    "configured": true,
    "total": 42,
    "complete": 30,
    "errored": 1,
    "pending": 11,
    "cancelled": false,
    "allowForceAll": false
  }
  ```
- `cancelled` is true when `state.cancelledAt && state.startedAt && state.cancelledAt > state.startedAt`.

### `DELETE /api/image-optimizer/regenerate`

Request body: `{ "collectionSlug": "media" }`.

- 401 if unauthenticated.
- 400 if `collectionSlug` missing or not configured (DELETE has side effects, so it doesn't follow the GET's permissive mode).
- Writes `{ cancelledAt: Date.now() }` to the `image-optimizer-state` global for the slug. The per-doc task reads this flag and aborts mid-run.
- Response: `{ cancelled: true, collectionSlug }`.

## Filename Strategies

`GenerateFilenameArgs`:

```ts
type GenerateFilenameArgs = {
  altText?: string
  originalFilename: string  // e.g. "IMG_2847.jpg"
  mimeType: string          // e.g. "image/jpeg"
  collectionSlug: string
  existingFilename?: string // set on re-uploads; reuse to avoid cloud storage churn
}
```

`GenerateFilename` returns a **stem only** — the plugin appends the extension derived from Payload's already-converted `data.filename` (or the original `req.file.name` as a fallback).

Built-in strategies exported from the package root:

- `uuidFilename` — UUID v4 stem. No human readability, no collisions.
- `seoFilename` — slugified alt text + millisecond-precision ISO timestamp. Falls back to the original stem when alt text is missing. Non-Latin alt text (Cyrillic / CJK / Arabic / Greek) that would produce an empty slug gets an 8-char SHA-256 hash suffix for uniqueness.
- `timestampFilename` — original stem (slugified) + millisecond-precision ISO timestamp. Use when you want the original filename preserved but still need uniqueness.

Resolution (`src/defaults.ts`): `config.generateFilename` is passed through; `undefined` keeps the original stem.

## ThumbHash / Blur Placeholder

Plugin-owned (Payload has no native ThumbHash).

- `generateThumbHash(buffer)` produces a base64 ThumbHash string from an optimized buffer.
- Stored at `doc.imageOptimizer.thumbHash`.
- Runs **inline in `beforeChange`** — lands in initial DB write (survives MongoDB transactions + cloud storage atomicity).
- Client utilities convert it to a `blurDataURL` via `decodeThumbHashToDataURL(thumbHash)`.

Server-side helpers exported from `@inoo-ch/payload-image-optimizer`:

- `encodeImageToThumbHash(buffer, width, height)` — encode raw RGBA pixel data.
- `decodeThumbHashToDataURL(thumbHash)` — decode to an `<img src>`-compatible data URL.

## Injected Document Schema

The plugin adds an `imageOptimizer` group field to every targeted collection (even when `disabled: true` — for schema consistency):

```ts
imageOptimizer: {
  status: 'complete' | 'error',
  error: string | null,
  thumbHash: string | null,
  originalSize: number,          // bytes (pre-pipeline)
  optimizedSize: number,         // bytes (post-pipeline)
}
```

Override the field set with `fieldsOverride: ({ defaultFields }) => Field[]` — exported helper `defaultImageOptimizerFields` is available as a starting point.

## Context Flags

All set on `req.context`:

| Flag | Written by | Consumed by | Effect |
|------|-----------|-------------|--------|
| `imageOptimizer_skip` | User code | Both hooks | Skip all plugin processing for this op. Use for programmatic updates that shouldn't re-trigger optimization. |
| `imageOptimizer_originalSize` | `beforeOperation` | `beforeChange` | Captures pre-pipeline byte count. |
| `imageOptimizer_nativeReupload` | `beforeChange` | (unused externally; reserved for telemetry) | Focal point / crop re-upload detected — hook returned early. |
| `imageOptimizer_regenerating` | `regenerateDocument` task | `beforeChange` | Opt into a full re-stamp even when `req.file.name === originalDoc.filename`. |

```ts
await payload.update({
  collection: 'media',
  id: docId,
  data: { alt: 'Updated alt text' },
  context: { imageOptimizer_skip: true },
})
```

## Background Jobs

One Payload job task is registered (`retries: 2`), queued into a dedicated `image-optimizer` queue (not `default`):

| Slug | Queue | Input | Output | Trigger | Purpose |
|------|-------|-------|--------|---------|---------|
| `imageOptimizer_regenerateDocument` | `image-optimizer` | `{ collectionSlug, docId }` | `{ status: 'complete' \| 'skipped' \| 'cancelled', reason?: string }` | Regenerate endpoint | Fully re-optimize one doc by re-triggering the native pipeline via `payload.update({ file })` with `context.imageOptimizer_regenerating = true`. Generates a new filename when a filename strategy is active. |

### Execution model

- **Parallel waves, not sequential.** The POST endpoint runs `payload.jobs.run({ queue: 'image-optimizer', limit: WAVE_SIZE })` in a loop inside `waitUntil`. `WAVE_SIZE` is 20 by default. Each wave runs in parallel (`sequential` omitted — Payload's default).
- **Budgeted.** The loop exits cleanly after `WAVE_BUDGET_MS` (270s, chosen to leave 30s headroom under Vercel's 300s default function timeout). Remaining jobs stay in the queue for Payload autorun or the next POST.
- **Cancellation.** Between waves, the endpoint reads the `image-optimizer-state` global and aborts if `cancelledAt > startedAt`. Inside a wave, each task also runs an `isCancelled()` check with a 1-second process-local cache so 20 parallel jobs don't all hit `findGlobal` simultaneously.
- **Cooperative with host autorun.** The dedicated queue means you can wire a host-side scheduler (e.g. Vercel Cron calling `payload.jobs.run({ queue: 'image-optimizer' })`) without interfering with other consumers of the `default` queue — and without double-running because Payload's job lock prevents concurrent execution of the same job row.

### Task handler behavior

- **Cancellation check first** (cached). Returns `{ status: 'cancelled', reason: 'user-cancelled' }`.
- **`findByID` with `depth: 0`** — scalar fields only. Avoids pulling populated folder trees on every job (observed 4–8s savings per job on folder-heavy collections).
- **NotFound (HTTP 404) is terminal** — a doc deleted between queue and run returns `{ status: 'skipped', reason: 'doc-deleted' }` instead of throwing, so Payload doesn't retry. Same guard in the outer catch for mid-flight deletions.
- **Non-image docs** are skipped (`{ status: 'skipped', reason: 'not-image' }`).
- **`fetchFileBuffer`** reads from local disk when the collection has `disableLocalStorage: false`; falls back to fetching `doc.url` (with 30s timeout) for cloud storage.
- **`payload.update({ file })` with `depth: 0`** — re-runs `generateFileData` through the injected `formatOptions`/`resizeOptions`/`withMetadata`; `beforeChange` re-stamps `imageOptimizer.{originalSize, optimizedSize, status, thumbHash}`. `overwriteExistingFiles: true` prevents a filename suffix on the rewrite. `context.imageOptimizer_regenerating: true` tells `beforeChange` this is an explicit regeneration, not a native focal-point re-upload.
- **Carries forward** `doc.imageOptimizer.originalSize` on the `data` payload so regenerations don't collapse the "saved X%" metric toward zero over repeated runs.
- **On error** (non-NotFound): writes `imageOptimizer.status = 'error'` with the message (via `context.imageOptimizer_skip: true` so `beforeChange` doesn't fire on the writeback), then rethrows so Payload's retry machinery observes the failure.

Upload path has **no jobs** — everything resolves synchronously in `beforeChange`.

## Client-side Display Utilities

Import display helpers from **`@inoo-ch/payload-image-optimizer/frontend`** (zero `@payloadcms/ui` dependency — safe on public pages). The `/client` entry is reserved for Payload admin `importMap` resolution; importing display helpers from `/client` on public pages pulls admin UI into your frontend bundle.

### `ImageBox` (recommended for new code)

Drop-in `next/image` wrapper. Extends `ImageProps` minus `src`.

```tsx
import { ImageBox } from '@inoo-ch/payload-image-optimizer/frontend'

<ImageBox media={doc.hero} alt="Hero" fill priority />
<ImageBox media={doc.image} alt="Card" fill sizes="(max-width: 768px) 100vw, 33vw" />
<ImageBox media={doc.avatar} alt="Avatar" width={64} height={64} fade={false} />
<ImageBox media="/images/fallback.jpg" alt="Fallback" width={800} height={600} />
```

Props beyond `ImageProps`:

| Prop | Type | Default |
|------|------|---------|
| `media` | `MediaResource \| string` | — |
| `alt` | `string` | falls back to `media.alt` |
| `fade` | `boolean` | `true` |
| `fadeDuration` | `number` | `500` |

Built-in behavior: ThumbHash blur placeholder, focal point via `objectPosition` from `focalX/focalY`, responsive variant loader (serves pre-generated Payload size variants directly), smart `sizes` default for fill mode (`(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw`), fade transition, `updatedAt` cache busting.

### `getOptimizedImageProps(resource)` (integration into existing `<NextImage>`)

Returns a single spread-friendly object with `placeholder`, `blurDataURL`, `style.objectPosition`, and a variant-aware `loader`. Recommended way to patch the Payload website template's `ImageMedia`.

### `getImageOptimizerProps(resource)`

Lighter alternative — returns only `placeholder`, `blurDataURL`, `style.objectPosition` (no loader).

### `createVariantLoader(media)`

Returns a `next/image` `loader` or `undefined` when no variants are present. Algorithm:

1. Filter variants whose aspect ratio matches the source within 3% (excludes fixed-crop variants like `og` 1200×630 or `square` 500×500 from the srcset).
2. Find smallest matching variant with `width >= requestedWidth`.
3. If none found, use the largest matching variant when it covers `>= 80%` of `requestedWidth`.
4. Otherwise fall back to `/_next/image`.

Cache-bust query is URL-encoded: `?v={encodedUpdatedAt}` (or `&v=...` when the variant URL already contains `?`, e.g. signed CDN URLs).

### `getDefaultSizes(fill: boolean)`

Returns `'(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw'` when `fill === true`, else `undefined`.

### `FadeImage`

`next/image` wrapper with fade-in for use with `getImageOptimizerProps()` when `ImageBox` isn't a fit.

### Decision guide

| Scenario | Use |
|----------|-----|
| New code, fresh components | `ImageBox` |
| Existing `<NextImage>` (e.g., Payload website template) | `getOptimizedImageProps` |
| Custom component, no variant loader needed | `getImageOptimizerProps` |
| Fully custom loader logic | `createVariantLoader` |
| Custom component + fade | `FadeImage` + `getImageOptimizerProps` |

## TypeScript

Exports from the package root:

```ts
import type {
  ImageOptimizerConfig,
  CollectionOptimizerConfig,
  FormatQuality,
  ImageFormat,             // 'webp' | 'avif'
  ImageOptimizerData,
  MediaResource,
  MediaSizeVariant,
  FieldsOverride,
  GenerateFilename,
  GenerateFilenameArgs,
} from '@inoo-ch/payload-image-optimizer'
```

Exports from `/frontend`:

```ts
import type {
  ImageBoxProps,
  FadeImageProps,
  ImageOptimizerProps,
  OptimizedImageProps,
} from '@inoo-ch/payload-image-optimizer/frontend'
```

`MediaResource` is structurally loose and matches any Payload media document shape:

```ts
type MediaResource = {
  url?: string | null
  alt?: string | null
  width?: number | null
  height?: number | null
  filename?: string | null
  focalX?: number | null
  focalY?: number | null
  imageOptimizer?: ImageOptimizerData | null
  updatedAt?: string
  sizes?: Record<string, MediaSizeVariant | undefined>
}
```

## Serverless / Vercel Notes

### `maxDuration`

Re-export from the Payload API route. This sets a 60-second function timeout — enough headroom for AVIF encoding, ThumbHash, and metadata ops.

```ts
// src/app/(payload)/api/[...slug]/route.ts
export { maxDuration } from '@inoo-ch/payload-image-optimizer'
```

### Vercel Blob body size (4.5MB) and `clientUploads`

Large admin uploads hit Vercel's 4.5MB serverless body limit. The plugin's default `clientOptimization` (Canvas pre-resize) keeps most photos under the limit without any extra config — prefer that path. `clientUploads: true` on `@payloadcms/storage-vercel-blob` is the escape hatch for non-image or otherwise non-resizable uploads (raw DSLR, video):

```ts
vercelBlobStorage({
  collections: { media: true },
  token: process.env.BLOB_READ_WRITE_TOKEN,
  clientUploads: true,
})
```

**What breaks with `clientUploads: true` (Payload + storage-vercel-blob constraint, not plugin-specific):**

The browser PUTs directly to Blob using a signed URL. The pathname is locked at sign time (`getClientUploadRoute.ts`'s `onBeforeGenerateToken` only decides `addRandomSuffix` / `cacheControlMaxAge` — it cannot mutate the pathname). The metadata POST re-fetches the bytes so server hooks run, but `plugin-cloud-storage`'s `afterChange` hook filters files with `clientUploadContext` set before calling `adapter.handleUpload` (`afterChange.ts`: `.filter((file) => !file.clientUploadContext)`). Net effect:

- `upload.formatOptions` runs in `generateFileData` but the optimized buffer is **discarded** — blob retains the browser's original bytes
- `upload.resizeOptions` same
- `generateFilename` runs in `beforeChange` and mutates `data.filename`, but the blob is already at the original pathname → DB/blob desync, 404s
- Per-size variants (`imageSizes`) **still work** — those go through `generateFileData` + `payloadUploadSizes` and are uploaded server-side via `handleUpload` (separate code path, not filtered by `clientUploadContext`)

**Compatibility matrix:**

| Feature | `clientUploads: false` (default) | `clientUploads: true` |
|---|---|---|
| Server-side format conversion on parent | ✅ | ❌ (buffer discarded) |
| Server-side resize on parent | ✅ | ❌ (buffer discarded) |
| EXIF strip on parent | ✅ | ❌ |
| `imageSize` variants (format + resize) | ✅ | ✅ |
| ThumbHash | ✅ | ✅ (computed from re-fetched buffer) |
| `uuidFilename` / `seoFilename` / custom `generateFilename` | ✅ | ❌ — do not set; use `addRandomSuffix: true` on the adapter |
| `addRandomSuffix: true` on storage adapter | ✅ | ✅ |
| Client-side Canvas pre-resize (`clientOptimization`) | ✅ | ✅ (the one thing that still shrinks the parent) |

### "This blob already exists" (server-side uploads only)

Only applies with `clientUploads: false`. When a `format` is configured (the default), the parent filename changes (`photo.jpg` → `photo.webp`). If a blob under the new name exists, Vercel Blob throws. `@payloadcms/storage-vercel-blob` doesn't pass `allowOverwrite`.

**Fix:** use a filename strategy so names are unique per upload:

```ts
imageOptimizer({
  collections: { media: true },
  generateFilename: uuidFilename,  // or seoFilename (server-side uploads only)
})
```

This fixes both initial uploads and the regeneration task. Payload stores the full URL in the database, so UUID filenames are transparent to your application.

**Alternative:** `addRandomSuffix: true` on the storage adapter — fixes initial uploads only. This is the **only** filename-uniqueness approach that works with `clientUploads: true`.

## Full Example

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { imageOptimizer, seoFilename } from '@inoo-ch/payload-image-optimizer'
import sharp from 'sharp'

export default buildConfig({
  collections: [
    { slug: 'media', fields: [], upload: { staticDir: './media' } },
    { slug: 'avatars', fields: [], upload: { staticDir: './avatars' } },
  ],
  plugins: [
    imageOptimizer({
      collections: {
        media: true,
        avatars: {
          maxDimensions: { width: 256, height: 256 },
          format: { format: 'webp', quality: 90 },
        },
      },
      format: { format: 'webp', quality: 80 },
      generateFilename: seoFilename,
      metadataPolicy: ({ metadata }) => metadata.format === 'jpeg',
      adminThumbnail: 'auto',
      responseHeaders: 'immutable',  // safe: generateFilename is set
      regenerateButton: { enabled: true, allowForceAll: false },
    }),
  ],
  sharp,
})
```

```tsx
// components/Hero.tsx
import { ImageBox } from '@inoo-ch/payload-image-optimizer/frontend'

export function Hero({ image }) {
  return (
    <div style={{ position: 'relative', height: '60vh' }}>
      <ImageBox media={image} alt="Hero" fill sizes="100vw" priority />
    </div>
  )
}
```
