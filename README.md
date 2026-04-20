# @inoo-ch/payload-image-optimizer

[![npm version](https://img.shields.io/npm/v/@inoo-ch/payload-image-optimizer)](https://www.npmjs.com/package/@inoo-ch/payload-image-optimizer)
[![npm downloads](https://img.shields.io/npm/dm/@inoo-ch/payload-image-optimizer)](https://www.npmjs.com/package/@inoo-ch/payload-image-optimizer)
[![GitHub](https://img.shields.io/github/license/PascalEugster/payloadcms-plugin-image-optimizer)](https://github.com/PascalEugster/payloadcms-plugin-image-optimizer)

A [Payload CMS](https://payloadcms.com) plugin that layers a turnkey image-optimization workflow on top of Payload's native sharp pipeline — zero-config multi-format output, ThumbHash blur placeholders, bulk regeneration UI, client-side pre-resize, and Next.js display components.

Built and maintained by [inoo.ch](https://inoo.ch) — a Swiss digital agency crafting modern web experiences.

## What This Plugin Adds

Payload already ships with sharp and exposes `formatOptions`, `resizeOptions`, `imageSizes`, and `withMetadata` — so format conversion, resizing, and EXIF stripping are achievable natively with per-collection wiring. This plugin's value is the layer *around* that pipeline: sensible coordinated defaults, admin UX, frontend integration, and workflows Payload does not provide.

### Things Payload can do natively (this plugin makes them turnkey)

- **Coordinated multi-format output** — WebP + AVIF + original as additive variants via a single config block, instead of hand-rolling `formatOptions` across `imageSizes`.
- **Global + per-collection defaults** — Configure once, override per collection, without repeating `formatOptions`/`resizeOptions`/`withMetadata` on every upload config.
- **Opinionated defaults** — WebP at quality 80, max 2560×2560, EXIF stripped, sensible quality ladder — wired up on install.

### Things Payload does not do out of the box

- **ThumbHash blur placeholders** — Tiny base64 hashes generated per image for instant blur-up previews.
- **Bulk regeneration UI** — One-click reprocess-all or reprocess-unoptimized from the admin, with progress tracking and a REST API.
- **Optimization status panel** — Admin sidebar showing status, original vs. optimized size, savings %, variant list, and blur preview.
- **Client-side pre-resize** — Canvas-based resize in the browser before upload, cutting 12MB DSLR photos to ~100–500KB pre-upload (huge win with `clientUploads: true`).
- **Filename strategies** — UUID filenames to avoid Vercel Blob "already exists" collisions during regeneration.
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

That's it. Every image uploaded to the `media` collection will be automatically optimized with sensible defaults.

## Configuration

### Full Example

```ts
imageOptimizer({
  collections: {
    media: {
      formats: [
        { format: 'webp', quality: 90 },
        { format: 'avif', quality: 75 },
      ],
      maxDimensions: { width: 4096, height: 4096 },
    },
    avatars: true, // uses global defaults
  },

  // Global defaults (overridden by per-collection config)
  formats: [
    { format: 'webp', quality: 80 },
    // { format: 'avif', quality: 65 }, // opt-in — AVIF is ~5-10x slower to encode than WebP
  ],
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
| `formats` | `FormatQuality[]` | `[{ format: 'webp', quality: 80 }]` | Output formats and quality (1-100). |
| `maxDimensions` | `{ width: number, height: number }` | `{ width: 2560, height: 2560 }` | Maximum image dimensions. Images are resized to fit within these bounds. |
| `generateThumbHash` | `boolean` | `true` | Generate ThumbHash blur placeholders for instant image previews. |
| `stripMetadata` | `boolean` | `true` | Sets `upload.withMetadata: false` AND guarantees sharp runs on every upload (Payload skips sharp entirely when no transform is configured, which preserves EXIF). Use `metadataPolicy` for richer control. |
| `generateFilename` | `(args) => string` | — | Custom filename **stem** generator. Built-ins: `uuidFilename` (UUID — prevents Vercel Blob "already exists" errors), `seoFilename` (human-readable from alt text). |
| `clientOptimization` | `boolean` | `true` | Pre-resize images in the browser before upload using Canvas API. Reduces upload size by up to 90% for large images. |
| `regenerateButton` | `boolean \| { enabled?: boolean, allowForceAll?: boolean }` | `true` | Controls the regeneration UI. `false` hides it entirely. Pass an object to opt in to the `Force re-process all` checkbox (`allowForceAll: true`) — off by default so the primary action is always "Regenerate N Unoptimized". |
| `adminThumbnail` | `'auto' \| string \| function` | `'auto'` | Injects an `upload.adminThumbnail` on each targeted collection. `'auto'` emits a function that returns a URL from `doc.filename` so admin thumbnails survive the v2 parent-extension change (`.jpg` → `.webp`). String mode is treated as a size-name reference; function mode is passed through. Respects user-set values. |
| `responseHeaders` | `false \| 'immutable' \| function` | `false` | Opt-in `upload.modifyResponseHeaders` injection. `'immutable'` sets `Cache-Control: public, max-age=31536000, immutable` — only safe with content-stable filenames (`generateFilename`); otherwise the plugin warns at init. Function mode is passed through. Respects user-set values. |
| `metadataPolicy` | `({ metadata, req }) => boolean \| Promise<boolean>` | — | Richer alternative to `stripMetadata`. When set, passed through as `withMetadata` (return `true` to keep, `false` to strip). Takes precedence over `stripMetadata`. Respects user-set values. |
| `disabled` | `boolean` | `false` | Disable optimization while keeping schema fields intact. |

### Per-Collection Overrides

Each collection can override `formats` and `maxDimensions`:

```ts
collections: {
  // Hero images: higher quality, larger dimensions
  heroes: {
    formats: [{ format: 'webp', quality: 95 }],
    maxDimensions: { width: 3840, height: 2160 },
  },
  // Thumbnails: smaller, more aggressive compression
  thumbnails: {
    formats: [
      { format: 'webp', quality: 60 },
      { format: 'avif', quality: 45 },
    ],
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

**What stays server-side:** Format conversion (WebP/AVIF), ThumbHash generation, and variant creation still happen on the server with sharp for quality consistency. The client only handles resize — the highest-impact optimization with zero quality trade-off.

**Save-button behavior:** While the client-side resize is running, the Save button is disabled and an "Optimizing image…" spinner appears below the uploader. The plugin sets `useDocumentInfo().setUploadStatus('uploading')` for the duration of the resize so Payload's `SaveButton` short-circuits — submit never runs with a stale field snapshot. Status is reset to `'idle'` on completion, error, and unmount. The hint is localized via the `plugin-imageOptimizer:optimizing` i18n key (en / de / fr included).

**Limitations:** Only applies to single-file uploads in the admin panel. Bulk uploads and API/programmatic uploads are processed server-side as usual.

## How It Works (v2)

1. **Plugin init** — The plugin resolves your options and injects them as native upload-config (`upload.formatOptions`, `upload.resizeOptions`, `upload.withMetadata`, and per-`imageSize` `formatOptions`) on each targeted collection.
2. **Upload** — Payload's own `generateFileData()` runs your image through sharp once: resize to `maxDimensions`, convert to the primary format (e.g. WebP), strip metadata, generate every `imageSize` variant — all in the format you configured.
3. **Hooks** — A small `beforeChange` hook stamps the `imageOptimizer` group (originalSize / optimizedSize / status / ThumbHash) and applies your optional filename strategy.
4. **Additive variants** — When you configure more than one format (e.g. WebP primary + AVIF), a background job produces the additive formats and updates the doc.
5. **Done** — The document carries variant URLs, file sizes, ThumbHash, and status.

This delegates the heavy lifting to Payload's native pipeline — single-format mode adds essentially zero overhead vs stock Payload.

### Vercel / Serverless Deployment

Image processing (especially AVIF encoding and metadata stripping) can exceed the default serverless function timeout. The plugin exports a recommended `maxDuration` that you can re-export from your Payload API route:

```ts
// src/app/(payload)/api/[...slug]/route.ts
export { maxDuration } from '@inoo-ch/payload-image-optimizer'
```

This sets a 60-second timeout, which is sufficient for most configurations. Without this, heavy processing configs may cause upload timeouts on Vercel.

#### Large file uploads with Vercel Blob

Even with `maxDuration` and `bodySizeLimit` configured, large file uploads through the Payload admin still go through the Next.js API route, which hits Vercel's request body size limit (4.5MB on serverless functions). If you're using `@payloadcms/storage-vercel-blob`, enable `clientUploads` to bypass this entirely:

```ts
vercelBlobStorage({
  collections: { media: true },
  token: process.env.BLOB_READ_WRITE_TOKEN,
  clientUploads: true, // uploads go directly from browser to Vercel Blob
})
```

With `clientUploads: true`, files upload directly from the browser to Vercel Blob (up to 5TB) and the server only handles the small JSON metadata payload. This eliminates body size limit errors regardless of file size.

#### "This blob already exists" error

When `replaceOriginal: true` (default), the plugin changes filenames during upload (e.g., `photo.jpg` → `photo.webp`). If a blob with that name already exists, Vercel Blob throws an error because `@payloadcms/storage-vercel-blob` does not pass [`allowOverwrite`](https://vercel.com/docs/vercel-blob#overwriting-blobs) to the Vercel Blob SDK.

**Fix:** Set `generateFilename: uuidFilename` — replaces original filenames with UUIDs before the storage adapter sees them:

```ts
import { imageOptimizer, uuidFilename } from '@inoo-ch/payload-image-optimizer'

imageOptimizer({
  collections: { media: true },
  generateFilename: uuidFilename, // photo.jpg → a1b2c3d4-5e6f-7890-abcd-ef1234567890.webp
})
```

This prevents collisions on both initial uploads and bulk regeneration (the regeneration task also generates a new UUID for cloud storage re-uploads). Payload stores the full URL in the database, so UUID filenames are transparent to your application.

**Alternative:** If you prefer to keep original filenames, set `addRandomSuffix: true` on the storage adapter instead:

```ts
vercelBlobStorage({
  collections: { media: true },
  token: process.env.BLOB_READ_WRITE_TOKEN,
  clientUploads: true,
  addRandomSuffix: true,
})
```

## How It Differs from Payload's Default Image Handling

Payload CMS ships with [sharp](https://sharp.pixelplumbing.com/) built-in and exposes `upload.formatOptions`, `upload.resizeOptions`, `upload.withMetadata`, and per-`imageSize` `formatOptions` — so format conversion, resizing, and EXIF stripping are all achievable natively. v2 of this plugin **resolves your options and injects them onto Payload's upload config at init time**, then leans on `generateFileData()` to do the actual encoding. The plugin's value is the layer *around* that pipeline: coordinated defaults, per-collection overrides, ThumbHash placeholders, optimization status, filename strategies, additive multi-format variants, the regenerate UI, and the client-side pre-resize.

### Comparison

| Capability | Payload Default | With This Plugin |
|---|---|---|
| Resize to max dimensions | `upload.resizeOptions` (per collection) | Same, plus global default + per-collection override from one config block |
| WebP/AVIF conversion | `upload.formatOptions` / per-size `formatOptions` — one format per size | Single config covers parent file + all sizes; **additive** multi-format (WebP + AVIF on the same size) |
| EXIF metadata stripping | Sharp strips by default (`withMetadata: false`) **only when sharp runs** | Guaranteed — plugin always triggers sharp even for unchanged files |
| Blur hash placeholders | Not supported | ThumbHash generated per image |
| Optimization status & savings | Not supported | Admin sidebar panel per image |
| Bulk re-process existing images | Not supported | One-click regeneration with progress tracking |
| Next.js `<Image>` with blur + focal point | Manual wiring | Drop-in `<ImageBox>` / `getOptimizedImageProps()` |
| Per-collection format/quality overrides | Repeat config per collection | Single plugin block with per-collection overrides |

### Native edge cases this plugin handles for you

- **`withoutEnlargement` silent drop** — Payload's native default (`undefined`) silently omits any `imageSize` where both dimensions are smaller than the target (the size appears as `{ filename: null }` in the doc). The plugin sets `withoutEnlargement: true` so small uploads keep a usable variant.
- **Per-size `formatOptions` does not inherit** — Native `imageSize.formatOptions` does not inherit from `upload.formatOptions`; each size would need repeating. The plugin injects the primary format onto every size automatically.
- **Sharp-skip EXIF leak** — If no `formatOptions`/`resizeOptions`/`trimOptions` is set and the image is not animated, native Payload skips sharp entirely and writes the original bytes (EXIF intact). The plugin's injected `resizeOptions` + `formatOptions` guarantee sharp always runs, closing this gap.

### CPU & Resource Impact

- **Single-pass pipeline** — Metadata stripping, resizing, and format conversion run in a single sharp pipeline (one decode/encode cycle), minimizing processing overhead.
- **Deferred ThumbHash** — ThumbHash generation runs in the background (via the format conversion job or `waitUntil`) rather than blocking the upload response.
- **Single-format mode** (e.g. WebP only with `replaceOriginal: true`) adds virtually zero overhead compared to Payload's default sharp processing — the plugin replaces the sharp pass rather than adding a second one.
- **Additional format variants** (e.g. both WebP and AVIF) run as background jobs after upload — this is the one area where you'll see extra CPU usage vs vanilla Payload. Note that AVIF encoding is ~5-10x slower than WebP.
- **Bulk regeneration** processes images sequentially, not all at once, so it won't spike your server.

If you're on a resource-constrained server, use single-format mode and you'll be at roughly the same CPU cost as stock Payload.

## Admin UI

The plugin adds an **Optimization Status** panel to the document sidebar showing:

- Status badge (pending / processing / complete / error)
- Original vs. optimized file size with savings percentage
- ThumbHash blur preview thumbnail
- List of generated format variants with dimensions and file sizes
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
    status: 'pending' | 'processing' | 'complete' | 'error',
    originalSize: number,    // bytes
    optimizedSize: number,   // bytes
    thumbHash: string,       // base64-encoded ThumbHash
    error: string,           // error message (if failed)
    variants: [
      {
        format: string,      // 'webp' | 'avif'
        filename: string,    // e.g. 'photo-optimized.webp'
        filesize: number,
        width: number,
        height: number,
        mimeType: string,
        url: string,
      },
    ],
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
- `force: true` — re-processes all images from scratch

**Response:** `{ "queued": 42, "collectionSlug": "media" }`

### Check Regeneration Progress

```
GET /api/image-optimizer/regenerate?collection=media
```

**Response:** `{ "collectionSlug": "media", "total": 42, "complete": 30, "errored": 1, "pending": 11 }`

Both endpoints require an authenticated user.

## AI Agent Integration

Full technical documentation for AI coding agents is available in [`AGENT_DOCS.md`](./AGENT_DOCS.md). It covers all configuration options, field schemas, endpoints, client utilities, background jobs, and context flags in a single reference file.

### Prompt for AI Agents

Copy-paste this instruction to your AI coding agent to have it autonomously integrate the plugin:

> Install `@inoo-ch/payload-image-optimizer` and integrate it into this Payload CMS project. Read `node_modules/@inoo-ch/payload-image-optimizer/AGENT_DOCS.md` for the full API reference. Based on the project's existing upload collections and frontend, decide on your own:
>
> 1. Which upload collections should be optimized and with what settings
> 2. Whether to use `replaceOriginal` or keep originals alongside variants
> 3. For **new components**: use `<ImageBox>` — it handles ThumbHash blur, fade-in, focal point, responsive variant loading, and smart `sizes` defaults automatically
> 4. For **existing components** (especially the Payload website template's `ImageMedia`): use `getOptimizedImageProps(resource)` — a single spread that adds ThumbHash, focal point, and variant loader to any `<NextImage>`
> 5. If collections have `imageSizes` configured, the variant loader will automatically serve pre-generated size variants directly instead of going through `/_next/image` re-optimization
>
> Use the zero-config default (`collections: { <slug>: true }`) unless the project has specific requirements that call for custom settings.

## Contributing

This plugin is open source and we welcome community involvement:

- **Issues** — Found a bug or have a feature request? [Open an issue](https://github.com/PascalEugster/payloadcms-plugin-image-optimizer/issues).
- **Pull Requests** — PRs are welcome! Please open an issue first to discuss larger changes.

All changes are reviewed and merged by the package maintainer at [inoo.ch](https://inoo.ch).

## License

MIT - [inoo.ch](https://inoo.ch)
