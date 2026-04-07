# @inoo-ch/payload-image-optimizer

[![npm version](https://img.shields.io/npm/v/@inoo-ch/payload-image-optimizer)](https://www.npmjs.com/package/@inoo-ch/payload-image-optimizer)
[![npm downloads](https://img.shields.io/npm/dm/@inoo-ch/payload-image-optimizer)](https://www.npmjs.com/package/@inoo-ch/payload-image-optimizer)
[![GitHub](https://img.shields.io/github/license/PascalEugster/payloadcms-plugin-image-optimizer)](https://github.com/PascalEugster/payloadcms-plugin-image-optimizer)

A [Payload CMS](https://payloadcms.com) plugin for automatic image optimization. Converts uploads to WebP/AVIF, resizes to configurable limits, strips EXIF metadata, generates [ThumbHash](https://evanw.github.io/thumbhash/) blur placeholders, and provides bulk regeneration from the admin panel.

Built and maintained by [inoo.ch](https://inoo.ch) — a Swiss digital agency crafting modern web experiences.

## Features

- **Format conversion** — Automatically generates WebP and AVIF variants with configurable quality
- **Smart resizing** — Constrains images to max dimensions while preserving aspect ratio
- **EXIF stripping** — Removes metadata for smaller files and better privacy
- **ThumbHash placeholders** — Generates tiny blur hashes for instant image previews
- **Bulk regeneration** — Re-process existing images from the admin UI with progress tracking
- **Per-collection config** — Override formats, quality, and dimensions per collection
- **Admin UI** — Status badges, file size savings, and blur previews in the sidebar
- **ImageBox component** — Drop-in Next.js `<Image>` wrapper with ThumbHash blur, fade-in, responsive variant loading, and smart `sizes` defaults
- **Responsive variant loader** — Serves pre-generated Payload size variants directly, bypassing `/_next/image` re-optimization
- **Template-friendly** — `getOptimizedImageProps()` integrates with the Payload website template in 3 lines
- **FadeImage component** — Standalone fade-in image for custom setups using `getImageOptimizerProps()`

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
})
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `collections` | `Record<string, true \| CollectionConfig>` | *required* | Collections to optimize. Use `true` for defaults or an object for overrides. |
| `formats` | `FormatQuality[]` | `[{ format: 'webp', quality: 80 }]` | Output formats and quality (1-100). |
| `maxDimensions` | `{ width: number, height: number }` | `{ width: 2560, height: 2560 }` | Maximum image dimensions. Images are resized to fit within these bounds. |
| `generateThumbHash` | `boolean` | `true` | Generate ThumbHash blur placeholders for instant image previews. |
| `stripMetadata` | `boolean` | `true` | Remove EXIF and other metadata from images. |
| `uniqueFileNames` | `boolean` | `false` | Replace filenames with UUIDs (e.g., `photo.jpg` → `a1b2c3d4.webp`). Prevents Vercel Blob "already exists" errors on uploads and regeneration. |
| `clientOptimization` | `boolean` | `true` | Pre-resize images in the browser before upload using Canvas API. Reduces upload size by up to 90% for large images. |
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

**Limitations:** Only applies to single-file uploads in the admin panel. Bulk uploads and API/programmatic uploads are processed server-side as usual.

## How It Works

1. **Upload** — An image is uploaded to a configured collection
2. **Pre-process** — A single-pass sharp pipeline strips metadata, resizes, and optionally converts format — all in one operation
3. **Save** — Payload writes the optimized image to disk
4. **Convert** — A background job converts the image to additional format variants (e.g. AVIF) and generates the ThumbHash asynchronously
5. **Done** — The document is updated with variant URLs, file sizes, ThumbHash, and optimization status

Format conversion and ThumbHash generation run as async background jobs, so uploads return immediately.

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

**Fix:** Enable `uniqueFileNames` in the plugin config — replaces original filenames with UUIDs before the storage adapter sees them:

```ts
imageOptimizer({
  collections: { media: true },
  uniqueFileNames: true, // photo.jpg → a1b2c3d4-5e6f-7890-abcd-ef1234567890.webp
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

Payload CMS ships with [sharp](https://sharp.pixelplumbing.com/) built-in and can resize images and generate sizes on upload. This plugin optimizes the uploaded image in a `beforeChange` hook and writes the result back to `req.file.data`. Payload's `generateFileData` runs before hooks and handles `imageSizes` generation using `Promise.all`, so the plugin focuses on what Payload doesn't do natively: format conversion (WebP/AVIF), metadata stripping, and ThumbHash generation. Using `clientOptimization: true` (the default) is the most effective way to speed up uploads with many `imageSizes`, since it reduces the source image before Payload processes it.

### Comparison

| Capability | Payload Default | With This Plugin |
|---|---|---|
| Resize to max dimensions | Manual via `imageSizes` config | Automatic — configure once globally or per-collection |
| WebP/AVIF conversion | Requires custom hooks | Built-in, zero-config |
| EXIF metadata stripping | Not built-in | Automatic (configurable) |
| Blur hash placeholders | Requires custom hooks | ThumbHash generated automatically |
| Optimization status & savings | Not available | Admin sidebar panel per image |
| Bulk re-process existing images | Not available | One-click regeneration with progress tracking |
| Next.js `<Image>` with blur placeholder | Manual wiring | Drop-in `<ImageBox>` / `<FadeImage>` components |
| Per-collection format/quality overrides | N/A | Supported |

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

A **Regenerate Images** button appears in collection list views, allowing you to bulk re-process existing images with a real-time progress bar.

## Displaying Images

### Option 1: `ImageBox` (New Projects)

Drop-in Next.js `<Image>` wrapper — the easiest way to display images with best practices:

```tsx
import { ImageBox } from '@inoo-ch/payload-image-optimizer/client'

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
import { getOptimizedImageProps } from '@inoo-ch/payload-image-optimizer/client'

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
