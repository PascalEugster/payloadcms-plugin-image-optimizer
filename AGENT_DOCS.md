# @inoo-ch/payload-image-optimizer

Agent-oriented reference for v2.0.0. This file is the deeper companion to `README.md` — for the prose introduction and comparison tables, read the README first. This document focuses on the facts an LLM needs when wiring the plugin into a Payload CMS 3.x codebase or debugging its behavior.

## Installation

```bash
pnpm add @inoo-ch/payload-image-optimizer
```

Peer requirements (same as v1):

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

## Architecture (v2)

v2 **does not run its own sharp pipeline** for resize, format conversion, or metadata stripping. At plugin init (`src/index.ts`), the plugin resolves your options and **injects them onto each targeted collection's `upload` config**. Payload's native `generateFileData()` then owns the encoding.

### Keys injected onto `collection.upload`

All injections obey the **non-override rule**: if the user already set the key on their collection, the plugin leaves the existing value intact.

| Key | Value produced | Condition |
|-----|----------------|-----------|
| `upload.formatOptions` | `{ format: formats[0].format, options: { quality: formats[0].quality } }` | `replaceOriginal: true` **and** a format is configured **and** `userUpload.formatOptions === undefined` |
| `upload.resizeOptions` | `{ width, height, fit: 'inside', withoutEnlargement: true }` from `maxDimensions` | `userUpload.resizeOptions === undefined` |
| `upload.withMetadata` | `metadataPolicy` callback, or `false` when `stripMetadata: true`, else unset | `userUpload.withMetadata === undefined` |
| `upload.imageSizes[i].formatOptions` | Same as parent `formatOptions` | A primary format is set **and** that size doesn't already have `formatOptions` |
| `upload.adminThumbnail` | Function returning `{staticDir|slug}/{filename}` for `'auto'`, else pass-through | `userUpload.adminThumbnail === undefined` and `adminThumbnail !== false` |
| `upload.modifyResponseHeaders` | `Cache-Control: public, max-age=31536000, immutable` for `'immutable'`, else pass-through | `userUpload.modifyResponseHeaders === undefined` and `responseHeaders !== false` |

The per-`imageSize` `formatOptions` injection is why v2 produces `.webp` files for every configured size (e.g., `media-300x225.webp` instead of `.jpg`). Payload's `createImageSizes` derives the extension from the produced MIME type.

### What the plugin still owns in v2

Hooks registered on each targeted collection:

- `beforeOperation` — snapshot `req.file.size` into `req.context.imageOptimizer_originalSize` before `generateFileData()` mutates it.
- `beforeChange` — apply optional filename strategy, compute `imageOptimizer.originalSize/optimizedSize/status`, run ThumbHash inline when no additive job is needed, short-circuit on native re-uploads (focal point/crop).
- `afterChange` — for multi-format configs only, queue the `imageOptimizer_convertFormats` job and kick the job runner through `waitUntil`.

Other plugin-owned surfaces:

- Two Payload job tasks: `imageOptimizer_convertFormats` and `imageOptimizer_regenerateDocument` (both `retries: 2`).
- Three REST endpoints at `/api/image-optimizer/regenerate` (POST/GET/DELETE).
- An `image-optimizer-state` hidden global (stores per-collection `startedAt`, `cancelledAt`, `queued`).
- Injected admin components: `UploadOptimizer` (replacing the default upload component when `clientOptimization` is on) and `RegenerationButton` (beforeListTable, when `regenerateButton.enabled`).
- i18n translations merged via `deepMergeSimple`.

### What v2 dropped from v1

- No sharp pipeline inside the plugin for the parent file (formats/resize/EXIF all run through Payload now).
- No `afterChange` disk write — `uploadFiles()` already wrote the optimized buffer; cloud storage adapters receive the same buffer through `req.file.data`.
- No buffer mutation inside the plugin's hooks.
- The `imageOptimizer.variants` array is **empty for single-format collections**. v1 pushed the primary format into `variants` even when it was already the parent file; v2 only populates `variants` with formats beyond `formats[0]`.

## Configuration Reference

### Top-level options (`ImageOptimizerConfig`)

```ts
export type ImageOptimizerConfig = {
  adminThumbnail?: AdminThumbnailOption
  clientOptimization?: boolean
  collections: Partial<Record<CollectionSlug, true | CollectionOptimizerConfig>>
  disabled?: boolean
  fieldsOverride?: FieldsOverride
  formats?: FormatQuality[]
  generateFilename?: GenerateFilename
  generateThumbHash?: boolean
  maxDimensions?: { width: number; height: number }
  metadataPolicy?: MetadataPolicy
  regenerateButton?: boolean | RegenerateButtonConfig
  replaceOriginal?: boolean
  responseHeaders?: ResponseHeadersOption
  stripMetadata?: boolean
}
```

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `collections` | `Record<slug, true \| CollectionOptimizerConfig>` | **required** | Which upload collections to target. `true` = use globals. |
| `formats` | `FormatQuality[]` | `[{ format: 'webp', quality: 80 }]` | `formats[0]` becomes the parent format (when `replaceOriginal`); `formats[1..N]` run as additive variants via the `convertFormats` job. |
| `maxDimensions` | `{ width, height }` | `{ 2560, 2560 }` | Injected as `resizeOptions` with `fit: 'inside'`, `withoutEnlargement: true`. |
| `stripMetadata` | `boolean` | `true` | Sets `upload.withMetadata = false` AND ensures the plugin's injected `formatOptions`/`resizeOptions` always trigger sharp so EXIF is actually stripped (native Payload skips sharp — and preserves EXIF — when no transform is configured). Ignored when `metadataPolicy` is set. |
| `metadataPolicy` | `(args: { metadata, req }) => boolean \| Promise<boolean>` | — | Richer alternative. Passed through as Payload's `withMetadata` callback. Return `true` to keep, `false` to strip. Takes precedence over `stripMetadata`. |
| `replaceOriginal` | `boolean` | `true` | When true, injects `formatOptions` for the parent file. When false, parent stays in its original format and every configured format lands as an additive variant. |
| `generateThumbHash` | `boolean` | `true` | Plugin-owned. Runs inline in `beforeChange` for single-format configs; runs inside `convertFormats` job for multi-format configs. |
| `generateFilename` | `(args: GenerateFilenameArgs) => string` | — | Returns filename **stem** (no extension). Built-ins: `uuidFilename`, `seoFilename`. |
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

- `'auto'` (default): injects a function that returns `` `${staticBase}/${doc.filename}` ``, where `staticBase` is the collection's `upload.staticDir` (normalized to strip slashes) or `/${collection.slug}` when no `staticDir` is set. The `staticBase` is captured at init time — the function does not depend on per-request state.
- `string`: passed through to Payload as a size-name reference (e.g., `'thumbnail'`).
- function: passed through as-is.

The reason for `'auto'` is that `replaceOriginal: true` renames the parent from `.jpg` to `.webp`. A hand-written URL helper that appended `.jpg` would break; reading `doc.filename` always sees the converted extension.

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
type MetadataPolicy = (args: { metadata: any; req: any }) => boolean | Promise<boolean>
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
  formats?: FormatQuality[]
  maxDimensions?: { width; height }
  replaceOriginal?: boolean
}
```

Only these three keys can be overridden per collection. Everything else (`stripMetadata`, `generateThumbHash`, `generateFilename`, `clientOptimization`, etc.) is global.

```ts
imageOptimizer({
  collections: {
    media: true,
    avatars: {
      formats: [{ format: 'webp', quality: 90 }],
      maxDimensions: { width: 256, height: 256 },
      replaceOriginal: false,
    },
  },
})
```

## Hook Lifecycle (v2)

The three hooks the plugin attaches, in order:

### `beforeOperation` (`src/hooks/beforeOperation.ts`)

Runs only for `create`/`update` operations on requests where `req.file.mimetype` starts with `image/` and `req.file.size` is a number. Writes `req.context.imageOptimizer_originalSize = req.file.size` before Payload's `generateFileData()` mutates `req.file.data`/`req.file.size` in place.

Required because by the time `beforeChange` runs, `req.file.size` reflects the **post-resize/format** buffer and the original byte count is gone.

### `beforeChange` (`src/hooks/beforeChange.ts`)

Short-circuits when any of these hold:

- `context.imageOptimizer_skip === true`
- No `req.file` / no `req.file.data` / `mimetype` not `image/*`
- **Native re-upload detection**: `originalDoc && !context.imageOptimizer_regenerating && req.file.name === originalDoc.filename`. This is how Payload's `shouldReupload()` re-stamps a file after a focal point / crop change — re-feeding the stored (already-optimized) file. The hook preserves the existing `imageOptimizer` group, sets `context.imageOptimizer_nativeReupload = true`, and returns. The regeneration task uses the same re-upload shape but sets `imageOptimizer_regenerating` so it doesn't short-circuit.

Otherwise:

1. If `resolvedConfig.generateFilename` is set, compute `stem` from `{ altText, originalFilename, mimeType, collectionSlug, existingFilename }`, read the extension from `data.filename` (set by `generateFileData` with the converted extension) or `req.file.name`, and write both `req.file.name = stem + ext` and `data.filename = stem + ext`.
2. Read `originalSize` from `context.imageOptimizer_originalSize` (falls back to `req.file.data.length` when the snapshot is missing, in which case `originalSize === optimizedSize`).
3. `optimizedSize = req.file.data.length` (this is the post-sharp buffer Payload will persist).
4. `needsAsyncJob = formats.length > 1`.
5. Stamp `data.imageOptimizer = { originalSize, optimizedSize, status: needsAsyncJob ? 'pending' : 'complete', variants: needsAsyncJob ? undefined : [], error: null }`.
6. If `generateThumbHash && !needsAsyncJob`, run `generateThumbHash(req.file.data)` **inline** so it lands in the initial DB write (important on MongoDB transactions with cloud storage).
7. Set `context.imageOptimizer_hasUpload = true`. Set `context.imageOptimizer_statusResolved = true` when no async job is needed.

### `afterChange` (`src/hooks/afterChange.ts`)

Short-circuits when:

- `context.imageOptimizer_skip === true`
- `context.imageOptimizer_nativeReupload === true`
- `context.imageOptimizer_hasUpload !== true`
- `context.imageOptimizer_statusResolved === true` (single-format path — nothing left to do)
- Collection's resolved `formats.length <= 1` (defensive — should already be caught by the flag above)

Otherwise (multi-format path): queues `imageOptimizer_convertFormats` with `{ collectionSlug, docId }`, then calls `req.payload.jobs.run({ sequential: true })` and registers the promise with `waitUntil` so serverless environments keep the function alive.

**What is no longer in `afterChange` (vs v1):** disk writes, old-file cleanup, buffer re-encoding.

## Client-side Canvas optimization

When `clientOptimization: true` (default), the plugin injects `@inoo-ch/payload-image-optimizer/client#UploadOptimizer` as the collection's `admin.components.edit.Upload` **only if the user hasn't already set one**.

### `UploadOptimizer` (`src/components/UploadOptimizer.tsx`)

- Renders Payload's stock `<Upload>` plus a status hint.
- Subscribes to the `file` field via `useField<File | null>`.
- On each new `File` instance it hasn't processed yet:
  1. Calls `setUploadStatus?.('uploading')` from `useDocumentInfo()`. **This gates Payload's `SaveButton`** so Save is blocked while the Canvas resize runs. Without this gate, submit would snapshot the field before `setFileValue(resized)` lands, either sending the oversized original or (on Vercel) reaching `/api/media` with an empty body and getting `MissingFile` 400.
  2. Sets `optimizing = true` to render a spinner + the translated label `plugin-imageOptimizer:optimizing` (falls back to `"Optimizing image…"`).
  3. Awaits `resizeImage(file)`.
  4. If not cancelled, tracks the resized file in a `WeakSet` (so the same resized file doesn't loop through the effect again) and calls `setFileValue(resized)`.
  5. In `finally`, resets `optimizing = false` and `setUploadStatus?.('idle')`.
- Cleanup (`cancelled = true`) also re-enables Save to avoid leaving it blocked forever on unmount.

### `resizeImage` (`src/utilities/clientResize.ts`)

Defaults: `maxWidth = 2560`, `maxHeight = 2560`, `jpegQuality = 0.85`. Resizable types: `image/jpeg`, `image/png`, `image/webp`, `image/bmp`, `image/tiff`. Other MIME types (e.g. SVG, GIF) are returned unchanged.

**Every failure path falls back to the original `File`** — never a null/empty File:

- `createImageBitmap(file)` throws → return original (corrupt image, unsupported subtype, OOM).
- Image already within bounds (`width <= maxWidth && height <= maxHeight`) → `bitmap.close()` and return original.
- `canvas.getContext('2d')` returns `null` → `bitmap.close()` and return original.
- `canvas.toBlob` resolves `null` or a `blob.size === 0` → return original (iOS Safari memory pressure, security restrictions).

On success: output is `image/png` (preserves transparency) when input was PNG, otherwise `image/jpeg`. Output filename is `${baseName}.${ext}` and `lastModified = Date.now()`.

Server-side format conversion (WebP/AVIF), ThumbHash, and per-size variants still run on the server even with client optimization enabled — the client only replaces the **resize** step.

### Limitation

Client optimization only applies to single-file uploads in the admin panel. Bulk uploads and API/programmatic `payload.create({ file })` calls skip the component entirely.

## Admin UI

### `OptimizationStatus` (document sidebar)

Injected as a sidebar component on each targeted collection. Displays:

- Status badge (`pending` / `processing` / `complete` / `error`).
- Original vs optimized size + savings percentage.
- ThumbHash blur preview thumbnail.
- Variants list (format, dimensions, filesize, URL).
- Per-document "Regenerate this image" button.

### `RegenerationButton` (collection list)

Injected as `admin.components.beforeListTable` when `regenerateButton.enabled` (default true). Default action is `"Regenerate N Unoptimized"` (or `"All images optimized"` when nothing pending). Selecting rows scopes the action to those IDs. When rows are selected it sends `docIds` to the endpoint.

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
- Writes `{ startedAt: Date.now(), cancelledAt: undefined, queued }` to the `image-optimizer-state` global for this slug.
- Kicks `payload.jobs.run({ limit: queued, sequential: true })` through `waitUntil`.
- Response: `{ queued: number, collectionSlug: string }`.

### `GET /api/image-optimizer/regenerate?collection=<slug>`

- 401 if unauthenticated.
- 400 if `collection` query param missing.
- **200 `{ configured: false, ... }` for unconfigured collections** (v1.12.1 fix — read-only status shouldn't generate error-log noise for UI polling on collections the plugin doesn't manage).
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

- `uuidFilename` — UUID v4 stem.
- `seoFilename` — slugified alt text + short timestamp fallback.

Resolution (`src/defaults.ts`): `config.generateFilename` is passed through; `undefined` keeps the original stem.

### Per-size filename custom naming — not supported

Documented in `src/index.ts` as `TODO(generateImageName)`. Payload's `upload.imageSizes[i].generateImageName` callback does not receive document `data` (no altText, no richer MIME), so user strategies like `seoFilename` cannot produce meaningful per-size names. The plugin does not inject a `generateImageName` — Payload derives size filenames from the parent's `originalName` by default. Will revisit if Payload exposes `data` to the callback.

## ThumbHash / Blur Placeholder

Plugin-owned in v2 (Payload has no native ThumbHash).

- `generateThumbHash(buffer)` produces a base64 ThumbHash string from an optimized buffer.
- Stored at `doc.imageOptimizer.thumbHash`.
- Runs **inline in `beforeChange`** for single-format configs (lands in initial DB write; survives MongoDB transactions + cloud storage).
- Runs **inside the `convertFormats` job** for multi-format configs (deferred, decoupled from the upload response).
- Client utilities convert it to a `blurDataURL` via `decodeThumbHashToDataURL(thumbHash)`.

Server-side helpers exported from `@inoo-ch/payload-image-optimizer`:

- `encodeImageToThumbHash(buffer, width, height)` — encode raw RGBA pixel data.
- `decodeThumbHashToDataURL(thumbHash)` — decode to an `<img src>`-compatible data URL.

## Injected Document Schema

The plugin adds an `imageOptimizer` group field to every targeted collection (even when `disabled: true` — for schema consistency):

```ts
imageOptimizer: {
  status: 'pending' | 'processing' | 'complete' | 'error',
  error: string | null,
  thumbHash: string | null,
  originalSize: number,          // bytes (pre-pipeline)
  optimizedSize: number,         // bytes (post-pipeline, parent file)
  variants: [
    {
      format: 'webp' | 'avif',
      filename: string,
      filesize: number,
      width: number,
      height: number,
      mimeType: string,
      url: string,
    },
  ],
}
```

**Empty `variants` array** when only one format is configured. The primary format is already the parent file (or lives beside it when `replaceOriginal: false`), so it is never pushed into `variants`. This is a breaking change from v1.

Override the field set with `fieldsOverride: ({ defaultFields }) => Field[]` — exported helper `defaultImageOptimizerFields` is available as a starting point.

## Context Flags

All set on `req.context`:

| Flag | Written by | Consumed by | Effect |
|------|-----------|-------------|--------|
| `imageOptimizer_skip` | User code | All three hooks | Skip all plugin processing for this op. Use for programmatic updates that shouldn't re-trigger optimization. |
| `imageOptimizer_originalSize` | `beforeOperation` | `beforeChange` | Captures pre-pipeline byte count. |
| `imageOptimizer_hasUpload` | `beforeChange` | `afterChange` | Marks that the hook actually processed an upload (vs. an update that changed only metadata). |
| `imageOptimizer_statusResolved` | `beforeChange` | `afterChange` | Single-format path — skip queuing any job. |
| `imageOptimizer_nativeReupload` | `beforeChange` | `afterChange` | Focal point / crop re-upload detected — skip queuing. |
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

Two Payload job tasks are registered (`retries: 2` each):

| Slug | Input | Output | Trigger | Purpose |
|------|-------|--------|---------|---------|
| `imageOptimizer_convertFormats` | `{ collectionSlug, docId }` | `{ variantsGenerated: number }` | `afterChange` (multi-format only) | Produce `formats[1..N]` as additive variants, generate deferred ThumbHash, append to `imageOptimizer.variants`, set `status: 'complete'`. |
| `imageOptimizer_regenerateDocument` | `{ collectionSlug, docId }` | `{ status: string, reason: string }` | Regenerate endpoint | Fully re-optimize one doc by re-triggering the native pipeline via `payload.update({ file })` with `context.imageOptimizer_regenerating = true`. Generates a new UUID when a filename strategy is active. |

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

1. Find smallest variant with `width >= requestedWidth`.
2. If none found, use the largest variant when it covers `>= 80%` of `requestedWidth`.
3. Otherwise fall back to `/_next/image`.

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

Large admin uploads still hit Vercel's serverless body-size limit. Enable `clientUploads` on `@payloadcms/storage-vercel-blob` so the browser uploads directly to Blob (up to 5TB):

```ts
vercelBlobStorage({
  collections: { media: true },
  token: process.env.BLOB_READ_WRITE_TOKEN,
  clientUploads: true,
})
```

### "This blob already exists"

With `replaceOriginal: true` (default), the parent filename changes (`photo.jpg` → `photo.webp`). If a blob under the new name exists, Vercel Blob throws. `@payloadcms/storage-vercel-blob` doesn't pass `allowOverwrite`.

**Fix:** use a filename strategy so names are unique per upload:

```ts
imageOptimizer({
  collections: { media: true },
  generateFilename: uuidFilename,  // or seoFilename
})
```

This fixes both initial uploads and the regeneration task (which also generates a new UUID when re-uploading to cloud storage).

**Alternative:** `addRandomSuffix: true` on the storage adapter — fixes initial uploads only, not regeneration.

## Migration

### From v2.0.x → v2.1.0

One breaking change: the already-`@deprecated` `uniqueFileNames` option is removed.

**If you have `uniqueFileNames: true` in your config:**

```ts
// Before (v2.0.x)
imageOptimizer({
  collections: { media: true },
  uniqueFileNames: true,
})

// After (v2.1.0)
import { imageOptimizer, uuidFilename } from '@inoo-ch/payload-image-optimizer'

imageOptimizer({
  collections: { media: true },
  generateFilename: uuidFilename,
})
```

**If you were not setting `uniqueFileNames`:** no action needed. Bump the dependency.

**Detection:** TypeScript emits `Object literal may only specify known properties` on `uniqueFileNames`. Runtime-wise, a stray `uniqueFileNames: true` is silently ignored — images will keep their original filenames and you may see Vercel Blob "already exists" errors on regeneration. Grep your repo for `uniqueFileNames` before bumping.

No other behavior changes. Document schema, admin UI, REST endpoints, and background tasks are identical to 2.0.x.

### From v1.x → v2.x

The user-facing `ImageOptimizerConfig` shape is unchanged. Existing configs work. What to verify:

1. **Per-size file extensions changed.** `media-300x225.jpg` is now `media-300x225.webp` (assuming a WebP primary). If your application persists size filenames outside Payload, regenerate them.
2. **`imageOptimizer.variants` is empty for single-format collections.** v1 pushed the primary format in; v2 does not. If any consumer code reads `variants[0]` expecting the primary, read `doc.url` / `doc.filename` instead, or check `variants.length` before indexing.
3. **Non-override rule.** If your collection already sets `upload.formatOptions`, `upload.resizeOptions`, `upload.withMetadata`, or per-size `formatOptions`, the plugin leaves them alone. Remove them to let the plugin manage them, or keep them to override.
4. **`adminThumbnail`** now defaults to `'auto'`. If you previously relied on Payload falling back to `file` (the parent URL) for admin thumbnails with a custom extension, this is a non-change; if you had no `adminThumbnail` and depended on a specific behavior, review the generated function.
5. **Regeneration.** v2's regeneration task re-triggers the native Payload pipeline via `payload.update({ file })` with `context.imageOptimizer_regenerating`, rather than running its own sharp pass. Behaves the same from the admin UI's perspective.
6. **No disk-level overwrite in `afterChange`.** Cloud storage adapters that relied on re-reading the final file from disk after the plugin's old `afterChange` will not see a second write event — the single write happens during `uploadFiles()`.

Bump the dependency; in most setups no code changes are required.

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
          formats: [{ format: 'webp', quality: 90 }],
        },
      },
      formats: [
        { format: 'webp', quality: 80 },
        { format: 'avif', quality: 65 },
      ],
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
