# @inoo-ch/payload-image-optimizer

[![npm version](https://img.shields.io/npm/v/@inoo-ch/payload-image-optimizer)](https://www.npmjs.com/package/@inoo-ch/payload-image-optimizer)
[![npm downloads](https://img.shields.io/npm/dm/@inoo-ch/payload-image-optimizer)](https://www.npmjs.com/package/@inoo-ch/payload-image-optimizer)
[![GitHub](https://img.shields.io/github/license/PascalEugster/payloadcms-plugin-image-optimizer)](https://github.com/PascalEugster/payloadcms-plugin-image-optimizer)

A [Payload CMS](https://payloadcms.com) plugin that adds the pieces Payload doesn't ship: **client-side pre-resize, ThumbHash blur placeholders, filename strategies, bulk regeneration UI, and Next.js display components** — layered on top of Payload's own sharp pipeline.

Built and maintained by [inoo.ch](https://inoo.ch) — a Swiss digital agency crafting modern web experiences.

## What This Plugin Adds

Payload 3.x already ships with sharp and exposes `formatOptions`, `resizeOptions`, `imageSizes`, and `withMetadata` — so format conversion, resize, per-size variants, focal-point-aware cropping, and EXIF stripping are all achievable natively. **This plugin does not replace any of that.** It injects sensible defaults onto your collection's upload config and then adds the things Payload genuinely doesn't do.

### Things Payload can already do (the plugin just sets sensible defaults)

- Convert originals + per-size variants to WebP (or AVIF) — via `upload.formatOptions` and per-`imageSize.formatOptions`
- Resize to max dimensions — via `upload.resizeOptions`
- Strip EXIF — via `upload.withMetadata: false`
- Focal-point-aware cropping for `imageSizes`
- Admin crop / focal-point UI

Prefer to wire those yourself? You don't need this plugin for any of them.

### Things Payload does not do out of the box

- **Client-side pre-resize** — Canvas-based resize in the browser *before* the file hits the network. Cuts 12MB DSLR photos to ~100–500KB pre-upload. Particularly important with `clientUploads: true` (Vercel Blob), where the server-side sharp pipeline is bypassed entirely.
- **ThumbHash blur placeholders** — Tiny base64 hashes generated per image for instant blur-up previews.
- **Filename strategies** — Top-level `generateFilename` callback (Payload only exposes per-`imageSize.generateImageName`, not a parent-level one). Built-ins: `uuidFilename` (avoids Vercel Blob "already exists"), `seoFilename` (alt-text → slug), `timestampFilename`.
- **Bulk regeneration UI** — One-click reprocess-all or reprocess-unoptimized from the admin, with progress tracking, stop button, and a REST API.
- **Optimization status panel** — Admin sidebar showing original vs. optimized size, savings %, and blur preview.
- **Next.js display components** — `<ImageBox>` and `<FadeImage>` wrappers with ThumbHash blur, fade-in, focal point, and a responsive variant loader that serves pre-generated `imageSizes` variants directly (bypassing `/_next/image` re-optimization).
- **Template integration helper** — `getOptimizedImageProps()` adds ThumbHash + focal point + variant loader to the Payload website template's `<NextImage>` in 3 lines.

## Requirements

- Payload CMS `^3.37.0`
- Next.js `^14.0.0` or `^15.0.0`
- React `^18.0.0` or `^19.0.0`
- Node.js `^18.20.2` or `>=20.9.0`

## Installation

```bash
pnpm add @inoo-ch/payload-image-optimizer
# or
npm install @inoo-ch/payload-image-optimizer
# or
yarn add @inoo-ch/payload-image-optimizer
```

> **Note:** This plugin uses [sharp](https://sharp.pixelplumbing.com/) for image processing. It is expected as a peer dependency from Payload CMS — no separate install needed.

## Quick Start

Add the plugin to your `payload.config.ts`:

```ts
import { buildConfig } from 'payload'
import { imageOptimizer } from '@inoo-ch/payload-image-optimizer'

export default buildConfig({
  // ...
  plugins: [
    imageOptimizer({
      collections: {
        media: true,
      },
    }),
  ],
})
```

That's it. Every image uploaded to the `media` collection is resized to 2560×2560, converted to WebP, stripped of EXIF, and gets a ThumbHash placeholder.

## Configuration

### Full Example

```ts
imageOptimizer({
  collections: {
    media: {
      format: { format: 'webp', quality: 90 },
      maxDimensions: { width: 4096, height: 4096 },
    },
    avatars: true, // uses global defaults
  },

  // Global defaults (per-collection config overrides these)
  format: { format: 'webp', quality: 80 },  // null disables format conversion entirely
  maxDimensions: { width: 2560, height: 2560 },
  generateThumbHash: true,
  stripMetadata: true,
  clientOptimization: true,
  disabled: false,

  // Optional config-injection helpers (all opt-in, all honor user-set upload values)
  adminThumbnail: 'auto',         // function form survives .jpg → .webp parent rename
  // responseHeaders: 'immutable', // long-lived Cache-Control; pair with `generateFilename`
  // metadataPolicy: ({ metadata }) => metadata.format === 'jpeg', // richer than stripMetadata
})
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `collections` | `Record<string, true \| CollectionConfig>` | *required* | Collections to optimize. Use `true` for defaults or an object for overrides. |
| `format` | `FormatQuality \| null` | `{ format: 'webp', quality: 80 }` | Target format and quality (1-100). Pass `null` to disable format conversion (keep original extension). |
| `maxDimensions` | `{ width: number, height: number }` | `{ width: 2560, height: 2560 }` | Maximum image dimensions. Images are resized to fit within these bounds. |
| `generateThumbHash` | `boolean` | `true` | Generate ThumbHash blur placeholders for instant image previews. |
| `stripMetadata` | `boolean` | `true` | Sets `upload.withMetadata: false` AND guarantees sharp runs on every upload (Payload skips sharp entirely when no transform is configured, which preserves EXIF). Use `metadataPolicy` for richer control. |
| `generateFilename` | `(args) => string` | — | Custom filename **stem** generator. Built-ins: `uuidFilename` (UUID — prevents Vercel Blob "already exists" errors), `seoFilename` (human-readable from alt text), `timestampFilename` (original filename stem + ISO timestamp with ms). **Note:** all filename strategies only work with server-side uploads (Payload default, `clientUploads: false`). With `clientUploads: true` the blob pathname is locked client-side before server hooks run, so `generateFilename` is effectively ignored — use `addRandomSuffix: true` on the storage adapter instead. See [Filename strategies and client uploads](#filename-strategies-and-client-uploads). |
| `clientOptimization` | `boolean` | `true` | Pre-resize images in the browser before upload using Canvas API. Reduces upload size by up to 90% for large images. |
| `regenerateButton` | `boolean \| { enabled?: boolean, allowForceAll?: boolean }` | `true` | Controls the regeneration UI. `false` hides it entirely. Pass an object to opt in to the `Force re-process all` checkbox (`allowForceAll: true`) — off by default so the primary action is always "Regenerate N Unoptimized". |
| `adminThumbnail` | `'auto' \| string \| function` | `'auto'` | Injects an `upload.adminThumbnail` on each targeted collection. `'auto'` picks the smallest pre-generated `doc.sizes` entry (avoids downloading the full parent into a 50-px list row) and falls back to `/api/{slug}/file/{filename}` — surviving the `.jpg` → `.webp` parent-extension change. String mode is treated as a size-name reference; function mode is passed through. Respects user-set values. |
| `responseHeaders` | `false \| 'immutable' \| function` | `false` | Opt-in `upload.modifyResponseHeaders` injection. `'immutable'` sets `Cache-Control: public, max-age=31536000, immutable` — only safe with content-stable filenames (`generateFilename`); otherwise the plugin warns at init. Function mode is passed through. Respects user-set values. |
| `metadataPolicy` | `({ metadata }) => boolean \| Promise<boolean>` | — | Richer alternative to `stripMetadata`. When set, passed through as `withMetadata` (return `true` to keep, `false` to strip). Takes precedence over `stripMetadata`. Respects user-set values. |
| `disabled` | `boolean` | `false` | Disable optimization while keeping schema fields intact. |

### Per-Collection Overrides

Each collection can override `format` and `maxDimensions`:

```ts
collections: {
  // Hero images: higher quality, larger dimensions
  heroes: {
    format: { format: 'webp', quality: 95 },
    maxDimensions: { width: 3840, height: 2160 },
  },
  // Thumbnails: more aggressive compression
  thumbnails: {
    format: { format: 'webp', quality: 60 },
    maxDimensions: { width: 800, height: 800 },
  },
}
```

### Client-Side Optimization

When `clientOptimization: true` is set, images are pre-resized in the browser before uploading. This uses the Canvas API (zero additional dependencies) to shrink large images to fit within `maxDimensions` before they enter the upload pipeline.

```ts
imageOptimizer({
  clientOptimization: true,
  collections: { media: true },
})
```

**How it helps:**
- A 12MB DSLR photo is resized to ~100-500KB *before* upload — 90%+ less data transferred
- Especially important with cloud storage + `clientUploads: true`, where files round-trip through blob storage
- Reduces serverless function processing time (smaller input = faster sharp conversion)
- EXIF metadata is stripped automatically (Canvas output has no metadata)

**What stays server-side:** Format conversion (WebP/AVIF), ThumbHash generation, and per-size variant creation still happen on the server with sharp for quality consistency. The client only handles resize — the highest-impact optimization with zero quality trade-off.

**Save-button behavior:** While the client-side resize is running, the Save button is disabled and an "Optimizing image…" spinner appears below the uploader. Status is reset on completion, error, and unmount. The hint is localized via the `plugin-imageOptimizer:optimizing` i18n key (en / de / fr included).

**Limitations:** Only applies to single-file uploads in the admin panel. Bulk uploads and API/programmatic uploads are processed server-side as usual.

## How It Works

1. **Plugin init** — The plugin resolves your options and injects them as native upload-config (`upload.formatOptions`, `upload.resizeOptions`, `upload.withMetadata`, and per-`imageSize` `formatOptions`) on each targeted collection.
2. **Upload** — Payload's own `generateFileData()` runs your image through sharp once: resize to `maxDimensions`, convert to your target format (e.g. WebP), strip metadata, generate every `imageSize` variant.
3. **beforeOperation hook** — Captures the pre-pipeline file size so the savings metric is accurate.
4. **beforeChange hook** — Stamps the `imageOptimizer` group (originalSize / optimizedSize / status / ThumbHash) and applies your optional filename strategy. Always resolves synchronously — status is `'complete'` immediately.
5. **Done** — The document is saved exactly once. No async jobs, no post-save follow-ups.

This delegates the heavy lifting to Payload's native pipeline. The plugin adds one sharp decode for ThumbHash generation (100×100 raw) and nothing else.

### Vercel / Serverless Deployment

Image processing (especially AVIF encoding and metadata stripping) can exceed the default serverless function timeout. The plugin exports a recommended `maxDuration` that you can re-export from your Payload API route:

```ts
// src/app/(payload)/api/[...slug]/route.ts
export { maxDuration } from '@inoo-ch/payload-image-optimizer'
```

This sets a 60-second timeout, which is sufficient for most configurations.

#### Large file uploads with Vercel Blob

Even with `maxDuration` and `bodySizeLimit` configured, large file uploads through the Payload admin still go through the Next.js API route, which hits Vercel's request body size limit (4.5MB on serverless functions). The plugin's client-side pre-resize (`clientOptimization`, on by default) keeps most photos under that limit — but raw DSLR RAWs, videos, or other non-resizable media can still exceed it. For those, `@payloadcms/storage-vercel-blob` supports `clientUploads`:

```ts
vercelBlobStorage({
  collections: { media: true },
  token: process.env.BLOB_READ_WRITE_TOKEN,
  clientUploads: true, // uploads go directly from browser to Vercel Blob (up to 5TB)
})
```

**Read this before enabling `clientUploads: true` — it has real trade-offs:**

With `clientUploads: true`, the browser PUTs the file directly to Vercel Blob using a signed URL. The server never sees the bytes until the metadata POST, at which point the blob already exists under the filename the browser chose. That breaks every server-side transformation that would normally own the filename or the blob contents:

| What you lose with `clientUploads: true` | Why |
|---|---|
| `seoFilename` | Alt text isn't available at sign time; the pathname is locked before any server hook runs |
| Server-side format conversion (`upload.formatOptions`) | The optimized buffer is computed but never written — Vercel Blob keeps the browser's original bytes |
| Server-side resize (`upload.resizeOptions`) | Same reason — server processes the buffer in memory, discards the result |
| EXIF stripping on the original | Same reason (per-size variants are still stripped, since those run through `generateFileData`) |

This is a Payload + `storage-vercel-blob` architectural constraint, not a plugin limitation — the cloud-storage adapter explicitly skips `handleUpload` when `clientUploadContext` is set.

#### Filename strategies and client uploads

| Upload mode | Works with | Recommended |
|---|---|---|
| `clientUploads: false` (Payload default) | `uuidFilename`, `seoFilename`, custom `generateFilename` | `seoFilename` for SEO; `uuidFilename` for immutable caching |
| `clientUploads: true` | `uuidFilename` via `addRandomSuffix: true` on the storage adapter | `addRandomSuffix: true` — filenames become `photo-a1b2c3.jpg` |

With `clientUploads: true`, your `imageOptimizer({ generateFilename })` is still called (it runs in `beforeChange` like always), but any rename it produces will make `data.filename` diverge from the actual blob pathname — resulting in 404s. So **do not combine `clientUploads: true` with `generateFilename`**. Use the storage adapter's `addRandomSuffix` instead:

```ts
vercelBlobStorage({
  collections: { media: true },
  token: process.env.BLOB_READ_WRITE_TOKEN,
  clientUploads: true,
  addRandomSuffix: true, // photo.jpg → photo-a1b2c3.jpg (added at sign time, client is told the final name)
})
```

#### "This blob already exists" error (server-side uploads only)

This only applies when `clientUploads` is **off** (the default). When a `format` is configured (the default), the plugin changes filenames during upload (e.g., `photo.jpg` → `photo.webp`). If a blob with that name already exists, Vercel Blob throws an error because `@payloadcms/storage-vercel-blob` does not pass [`allowOverwrite`](https://vercel.com/docs/vercel-blob#overwriting-blobs) to the Vercel Blob SDK.

**Fix:** Set `generateFilename: uuidFilename` — replaces original filenames with UUIDs before the storage adapter sees them:

```ts
import { imageOptimizer, uuidFilename } from '@inoo-ch/payload-image-optimizer'

imageOptimizer({
  collections: { media: true },
  generateFilename: uuidFilename, // photo.jpg → a1b2c3d4-5e6f-7890-abcd-ef1234567890.webp
})
```

This prevents collisions on both initial uploads and bulk regeneration. Payload stores the full URL in the database, so UUID filenames are transparent to your application.

**Prefer human-readable names?** `generateFilename: seoFilename` slugifies the alt text (e.g., `Edelstahl Geländer` → `edelstahl-gelaender-1745123456.webp`). Only works with server-side uploads.

## How It Differs from Payload's Default Image Handling

Payload CMS ships with [sharp](https://sharp.pixelplumbing.com/) and exposes every sharp knob you need — `upload.formatOptions`, `upload.resizeOptions`, `upload.withMetadata`, per-`imageSize` `formatOptions`, focal-point-aware cropping — so the bulk of "image optimization" is native. This plugin **resolves your options and injects them onto Payload's upload config at init time**, then lets `generateFileData()` do the encoding. The plugin's value is the layer *around* that pipeline: client-side pre-resize, ThumbHash, filename strategies, the regeneration UI, and the Next.js display components.

### Comparison

| Capability | Payload Default | With This Plugin |
|---|---|---|
| Resize to max dimensions | `upload.resizeOptions` (per collection) | Same, via one config block with global default + per-collection override |
| WebP/AVIF conversion | `upload.formatOptions` / per-size `formatOptions` — repeat per collection | Single config covers parent file + all sizes |
| EXIF metadata stripping | Sharp strips by default (`withMetadata: false`) **only when sharp runs** | Guaranteed — plugin's injected `resizeOptions`/`formatOptions` always triggers sharp |
| Focal-point-aware crops | Native (`upload.focalPoint`) | Unchanged — native Payload handles this |
| Filename strategies | Per-size `generateImageName` only | Top-level `generateFilename` (seoFilename / uuidFilename / timestampFilename / custom) |
| Blur hash placeholders | Not supported | ThumbHash generated per image |
| Client-side pre-resize | Not supported | Canvas-based resize in browser before upload |
| Optimization status & savings | Not supported | Admin sidebar panel per image |
| Bulk re-process existing images | Not supported | One-click regeneration with progress + stop button |
| Next.js `<Image>` with blur + focal point | Manual wiring | Drop-in `<ImageBox>` / `getOptimizedImageProps()` |

### Native edge cases this plugin handles for you

- **`withoutEnlargement` silent drop** — Payload's native default (`undefined`) silently omits any `imageSize` where both dimensions are smaller than the target (the size appears as `{ filename: null }` in the doc). The plugin sets `withoutEnlargement: true` so small uploads keep a usable variant.
- **Per-size `formatOptions` does not inherit** — Native `imageSize.formatOptions` does not inherit from `upload.formatOptions`; each size would need repeating. The plugin injects the primary format onto every size automatically.
- **Sharp-skip EXIF leak** — If no `formatOptions`/`resizeOptions`/`trimOptions` is set and the image is not animated, native Payload skips sharp entirely and writes the original bytes (EXIF intact). The plugin's injected `resizeOptions` + `formatOptions` guarantee sharp always runs, closing this gap.

### CPU & Resource Impact

- **Single-pass pipeline** — Metadata stripping, resize, and format conversion run in Payload's single sharp pipeline — one decode/encode cycle.
- **ThumbHash** — One additional sharp pass (100×100 raw buffer) per upload. Negligible.
- **No background jobs on upload** — As of v3, every upload resolves synchronously. The only async workload is bulk regeneration (which only runs when you click it).
- **Bulk regeneration** processes images sequentially, not all at once, so it won't spike your server.

## Admin UI

The plugin adds an **Optimization Status** panel to the document sidebar showing:

- Status badge (complete / error)
- Original vs. optimized file size with savings percentage
- ThumbHash blur preview thumbnail
- **Regenerate this image** button to re-run optimization on the current document only

A **Regenerate** button also appears in collection list views. By default it targets only unoptimized images (label reads `Regenerate N Unoptimized`, or `All images optimized` when nothing is pending). Selecting rows scopes it to just those. The full-collection "Force re-process all" opt-in is hidden unless you enable it via `regenerateButton: { allowForceAll: true }`.

## Displaying Images

> **Import from `/frontend`, not `/client`.** The frontend entry point (`@inoo-ch/payload-image-optimizer/frontend`) exports only display helpers (`ImageBox`, `FadeImage`, `getOptimizedImageProps`, `getImageOptimizerProps`, `createVariantLoader`) and has zero dependency on `@payloadcms/ui`. Importing from `/client` on a public page works but drags the admin UI into your frontend bundle under Turbopack. The `/client` barrel is kept for Payload's `importMap` and backward compatibility.

### Option 1: `ImageBox` (New Projects)

Drop-in Next.js `<Image>` wrapper — the easiest way to display images with best practices:

```tsx
import { ImageBox } from '@inoo-ch/payload-image-optimizer/frontend'

// Hero image — fill mode with priority
<ImageBox media={doc.heroImage} alt="Hero" fill priority />

// Card grid — explicit sizes hint
<ImageBox media={doc.image} alt="Card" fill sizes="(max-width: 768px) 100vw, 33vw" />

// Fixed dimensions
<ImageBox media={doc.avatar} alt="Avatar" width={64} height={64} fade={false} />
```

**What it does automatically:**
- Per-image ThumbHash blur placeholder
- Smooth blur-to-sharp fade transition
- Focal point positioning from `focalX`/`focalY`
- Responsive variant loader — serves pre-generated Payload size variants directly instead of `/_next/image` re-optimization (when `imageSizes` is configured on the collection)
- Smart `sizes` default for fill mode — `(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw` instead of the browser's `100vw` assumption
- Cache busting via `updatedAt`

### Option 2: `getOptimizedImageProps()` (Existing Projects / Payload Website Template)

If you're using the [Payload website template](https://github.com/payloadcms/payload/tree/main/templates/website) or have an existing `<NextImage>` component, add 3 lines:

```tsx
import { getOptimizedImageProps } from '@inoo-ch/payload-image-optimizer/frontend'

const optimizedProps = getOptimizedImageProps(resource)

<NextImage
  {...optimizedProps}   // ThumbHash blur, focal point, variant loader
  src={src}
  alt={alt}
  fill={fill}
  sizes={sizes}
  quality={80}
/>
```

This replaces the template's hardcoded blur placeholder with per-image ThumbHash, adds focal point support, and enables responsive variant loading.

### Responsive Variant Loading

When your collection has `imageSizes` configured (e.g., `thumbnail: 300`, `medium: 900`, `large: 1400`), both `ImageBox` and `getOptimizedImageProps()` automatically create a hybrid `next/image` loader that:

1. Picks the smallest pre-generated variant >= the requested width
2. Serves it directly from your storage (bypasses `/_next/image` — no double optimization)
3. Falls back to `/_next/image` when no close variant match exists

This means images uploaded to collections with `imageSizes` get responsive loading for free — no extra config needed.

## Document Schema

The plugin adds an `imageOptimizer` field group to each configured collection:

```ts
{
  imageOptimizer: {
    status: 'complete' | 'error',
    originalSize: number,    // bytes
    optimizedSize: number,   // bytes
    thumbHash: string,       // base64-encoded ThumbHash
    error: string,           // error message (if failed)
  },
}
```

## REST API Endpoints

### Start Bulk Regeneration

```
POST /api/image-optimizer/regenerate
Content-Type: application/json

{ "collectionSlug": "media", "force": false }
```

- `force: false` — only regenerates images that are not yet complete
- `force: true` — re-processes all images from scratch (only honored when `regenerateButton.allowForceAll: true`)

**Response:** `{ "queued": 42, "collectionSlug": "media" }`

### Check Regeneration Progress

```
GET /api/image-optimizer/regenerate?collection=media
```

**Response:** `{ "collectionSlug": "media", "total": 42, "complete": 30, "errored": 1, "pending": 11, "cancelled": false }`

### Cancel In-Flight Regeneration

```
DELETE /api/image-optimizer/regenerate
Content-Type: application/json

{ "collectionSlug": "media" }
```

All endpoints require an authenticated user.

## Upgrading from v2.x

v3 is a breaking release. See [`MIGRATION.md`](./MIGRATION.md) for a full migration guide. In short:

- `formats: FormatQuality[]` → `format: FormatQuality | null` (singular). Only one format per collection.
- `replaceOriginal` removed. When `format` is set, the original is always replaced (via Payload's native `upload.formatOptions`).
- `imageOptimizer.variants` field removed. Additive multi-format variants (e.g. WebP+AVIF siblings) are no longer a feature — they only worked on local disk, never on cloud storage.
- `imageOptimizer.status` enum is now `'complete' | 'error'` (no more `'pending'` / `'processing'`).

## AI Agent Integration

Full technical documentation for AI coding agents is available in [`AGENT_DOCS.md`](./AGENT_DOCS.md). It covers all configuration options, field schemas, endpoints, client utilities, background jobs, and context flags in a single reference file.

### Prompt for AI Agents

Copy-paste this instruction to your AI coding agent to have it autonomously integrate the plugin:

> Install `@inoo-ch/payload-image-optimizer` and integrate it into this Payload CMS project. Read `node_modules/@inoo-ch/payload-image-optimizer/AGENT_DOCS.md` for the full API reference. Based on the project's existing upload collections and frontend, decide on your own:
>
> 1. Which upload collections should be optimized and with what settings (`format`, `maxDimensions`)
> 2. For **new components**: use `<ImageBox>` — it handles ThumbHash blur, fade-in, focal point, responsive variant loading, and smart `sizes` defaults automatically
> 3. For **existing components** (especially the Payload website template's `ImageMedia`): use `getOptimizedImageProps(resource)` — a single spread that adds ThumbHash, focal point, and variant loader to any `<NextImage>`
> 4. If collections have `imageSizes` configured, the variant loader will automatically serve pre-generated size variants directly instead of going through `/_next/image` re-optimization
>
> Use the zero-config default (`collections: { <slug>: true }`) unless the project has specific requirements that call for custom settings.

## Contributing

This plugin is open source and we welcome community involvement:

- **Issues** — Found a bug or have a feature request? [Open an issue](https://github.com/PascalEugster/payloadcms-plugin-image-optimizer/issues).
- **Pull Requests** — PRs are welcome! Please open an issue first to discuss larger changes.

All changes are reviewed and merged by the package maintainer at [inoo.ch](https://inoo.ch).

## License

MIT - [inoo.ch](https://inoo.ch)
