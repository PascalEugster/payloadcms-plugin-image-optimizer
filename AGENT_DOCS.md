# @inoo-ch/payload-image-optimizer

Payload CMS plugin for automatic image optimization — WebP/AVIF conversion, resize, EXIF strip, ThumbHash blur placeholders, and bulk regeneration.

## Installation

```bash
pnpm add @inoo-ch/payload-image-optimizer
```

**Peer dependency:** Payload 3.x must provide `sharp` in its config.

## Quick Start (Zero-Config)

```ts
// payload.config.ts
import { imageOptimizer } from '@inoo-ch/payload-image-optimizer'

export default buildConfig({
  // ...
  plugins: [
    imageOptimizer({
      collections: {
        media: true, // enable with all defaults
      },
    }),
  ],
  sharp, // required — Payload must be configured with sharp
})
```

With this minimal config every uploaded image in the `media` collection will automatically:

1. Be resized to fit within 2560x2560 (no upscaling)
2. Have EXIF/metadata stripped
3. Be converted to WebP (quality 80) — replacing the original file on disk
4. Get a ThumbHash blur placeholder generated

## Configuration Reference

### Plugin Options (`ImageOptimizerConfig`)

```ts
imageOptimizer({
  // Required — map of collection slugs to optimize.
  // Use `true` for defaults, or an object for per-collection overrides.
  collections: {
    media: true,
    avatars: {
      maxDimensions: { width: 256, height: 256 },
      formats: [{ format: 'webp', quality: 90 }],
      replaceOriginal: false,
    },
  },

  // Global defaults (all optional — values shown are the defaults):
  formats: [{ format: 'webp', quality: 80 }],     // output formats
  maxDimensions: { width: 2560, height: 2560 },    // max resize dimensions
  stripMetadata: true,                              // strip EXIF data
  generateThumbHash: true,                          // generate blur placeholders
  replaceOriginal: true,                            // convert main file to primary format
  clientOptimization: true,                         // pre-resize in browser before upload
  uniqueFileNames: false,                           // replace filenames with UUIDs
  disabled: false,                                  // keep fields but skip all processing
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `Record<slug, true \| CollectionConfig>` | — | **Required.** Collections to optimize. `true` = use global defaults. |
| `formats` | `{ format: 'webp' \| 'avif', quality: number }[]` | `[{ format: 'webp', quality: 80 }]` | Output formats to generate. |
| `maxDimensions` | `{ width: number, height: number }` | `{ width: 2560, height: 2560 }` | Maximum image dimensions (fit inside, no upscaling). |
| `stripMetadata` | `boolean` | `true` | Strip EXIF, ICC, XMP metadata. |
| `uniqueFileNames` | `boolean` | `false` | Replace filenames with UUIDs. Prevents Vercel Blob collisions and hides original filenames. |
| `generateThumbHash` | `boolean` | `true` | Generate ThumbHash blur placeholder. |
| `replaceOriginal` | `boolean` | `true` | Replace the original file with the primary format. |
| `clientOptimization` | `boolean` | `true` | Pre-resize images in browser via Canvas API before upload. Reduces upload size 90%+ for large images. |
| `disabled` | `boolean` | `false` | Keep schema fields but disable all processing. |

### Per-Collection Overrides (`CollectionOptimizerConfig`)

Each collection can override `formats`, `maxDimensions`, and `replaceOriginal`. All other settings are global-only.

```ts
collections: {
  media: true,                         // uses global defaults
  avatars: {                           // overrides specific settings
    formats: [{ format: 'webp', quality: 90 }],
    maxDimensions: { width: 256, height: 256 },
    replaceOriginal: false,
  },
}
```

## How It Works

### Upload Pipeline

When an image is uploaded to an optimized collection:

1. **`beforeChange` hook** (single-pass in-memory processing):
   - If `generateFilename` / `uniqueFileNames`: renames file (e.g., `photo.jpg` → `a1b2c3d4.jpg`)
   - Single sharp pipeline: resizes to `maxDimensions`, strips metadata, and optionally converts to primary format — all in one decode/encode cycle
   - Skips redundant `.rotate()` — Payload's `generateFileData()` already auto-rotated before hooks run
   - If no async job is needed: generates ThumbHash synchronously (included in initial DB write)
   - Sets `imageOptimizer.status` to `'pending'` (async job) or `'complete'` (no job needed)

2. **`afterChange` hook** (disk + async):
   - Writes processed buffer to disk (overwriting Payload's original)
   - Cleans up old file if filename changed
   - Queues `imageOptimizer_convertFormats` background job for remaining formats

3. **Background job** (`imageOptimizer_convertFormats`):
   - Generates variant files for any additional formats (e.g., AVIF)
   - Writes variants to disk with `-optimized` suffix
   - Generates ThumbHash (deferred from the sync save path to avoid blocking uploads)
   - Updates document: `imageOptimizer.status = 'complete'`, populates `variants` array and `thumbHash`

### File Naming

| File | Naming Pattern | Example |
|------|---------------|---------|
| Main file (replaceOriginal) | `{name}.{primaryFormat}` | `photo.webp` |
| Main file (uniqueFileNames) | `{uuid}.{primaryFormat}` | `a1b2c3d4-5e6f-7890.webp` |
| Variant files | `{name}-optimized.{format}` | `photo-optimized.avif` |

### Format Behavior

**When `replaceOriginal: true`** (default):
- The uploaded file is converted to the first format in the `formats` array and replaces the original on disk.
- Additional formats are generated as variant files.
- Example: `formats: [webp, avif]` → main file becomes `.webp`, variant is `.avif`

**When `replaceOriginal: false`**:
- The uploaded file stays in its original format.
- All configured formats are generated as separate variant files.

## Fields Added to Collections

The plugin adds an `imageOptimizer` group field (read-only, displayed in the admin sidebar) to every configured collection:

```ts
{
  imageOptimizer: {
    status: 'pending' | 'processing' | 'complete' | 'error',
    error: string | null,
    thumbHash: string | null,         // base64-encoded ThumbHash
    originalSize: number,             // bytes
    optimizedSize: number,            // bytes
    variants: [
      {
        format: string,               // 'webp' | 'avif'
        filename: string,             // e.g. 'photo-optimized.avif'
        filesize: number,             // bytes
        width: number,
        height: number,
        mimeType: string,             // e.g. 'image/avif'
        url: string,                  // e.g. '/media/photo-optimized.avif'
      }
    ]
  }
}
```

## Admin UI

### Optimization Status (Document Sidebar)

Every document in an optimized collection shows an `OptimizationStatus` component in the sidebar displaying:
- Color-coded status badge (pending/processing/complete/error)
- Original vs optimized file sizes with savings percentage
- ThumbHash preview thumbnail
- List of generated variants

### Regenerate Images (Collection List View)

A `RegenerationButton` component is injected above the list table in every optimized collection:
- **"Regenerate Images"** button — queues optimization jobs for all images
- **"Force re-process all"** checkbox — re-optimizes already-complete images
- Live progress bar with polling (every 2 seconds)
- Stall detection — warns if processing stops progressing
- Persistent stats showing overall optimization status (e.g., "All 32 images optimized")

## REST API Endpoints

### `POST /api/image-optimizer/regenerate`

Queue bulk regeneration jobs for a collection. Requires authentication.

**Request body:**
```json
{
  "collectionSlug": "media",
  "force": false
}
```

**Response:**
```json
{
  "queued": 12,
  "collectionSlug": "media"
}
```

### `GET /api/image-optimizer/regenerate?collection=media`

Get current optimization status for a collection. Requires authentication.

**Response:**
```json
{
  "collectionSlug": "media",
  "total": 32,
  "complete": 30,
  "errored": 1,
  "pending": 1
}
```

## Client-Side Utilities

Import frontend display helpers from `@inoo-ch/payload-image-optimizer/frontend` (zero `@payloadcms/ui` dependency — safe to import on public pages).

The `/client` entry point is reserved for Payload admin component resolution (`importMap`) and backward compatibility; importing display helpers from `/client` on public pages will drag admin UI into your frontend bundle under Turbopack.

### `ImageBox` Component (Recommended)

Drop-in Next.js `<Image>` wrapper — the easiest way to display images with best practices. Automatically handles ThumbHash blur placeholders, focal point positioning, smooth fade-in, responsive variant loading, and smart `sizes` defaults.

```tsx
import { ImageBox } from '@inoo-ch/payload-image-optimizer/frontend'

// Pass the full Payload media document — ImageBox handles everything
<ImageBox media={doc.heroImage} alt="Hero" fill priority />

// Card grid — explicit sizes hint for responsive loading
<ImageBox media={doc.image} alt="Card" fill sizes="(max-width: 768px) 100vw, 33vw" />

// Fixed dimensions (non-fill)
<ImageBox media={doc.avatar} alt="Avatar" width={64} height={64} fade={false} />

// Plain URL string fallback
<ImageBox media="/images/fallback.jpg" alt="Fallback" width={800} height={600} />
```

**Props:** Extends all Next.js `ImageProps` (except `src`), plus:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `media` | `MediaResource \| string` | — | Payload media document or URL string |
| `alt` | `string` | — | Alt text (overrides `media.alt`) |
| `fade` | `boolean` | `true` | Enable smooth blur-to-sharp fade transition on load |
| `fadeDuration` | `number` | `500` | Duration of the fade animation in milliseconds |

**What ImageBox does automatically:**

- **ThumbHash blur placeholder** — per-image blur preview from `imageOptimizer.thumbHash`
- **Responsive variant loader** — when `media.sizes` has Payload size variants (from `imageSizes` collection config), serves pre-generated variants directly instead of going through `/_next/image` re-optimization. Falls back to `/_next/image` when no close match exists.
- **Smart `sizes` default** — for `fill` mode without explicit `sizes`, uses `(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw` instead of the browser's `100vw` assumption
- **Focal point positioning** — applies `objectPosition` from `focalX`/`focalY`
- **Fade transition** — smooth blur-to-sharp animation on load
- **Cache busting** — appends `updatedAt` as query parameter

**Important:** For the variant loader to work, your collection must have `imageSizes` configured in the Payload collection config. This is how Payload generates the width variants. Without `imageSizes`, images still work but go through `/_next/image` as usual.

### `getOptimizedImageProps()` — For Existing Components (e.g., Payload Website Template)

Single-function integration for existing `<NextImage>` components. Returns ThumbHash, focal point, AND variant loader in one spread-friendly object. **This is the recommended way to integrate with the Payload website template's `ImageMedia` component.**

```tsx
import { getOptimizedImageProps } from '@inoo-ch/payload-image-optimizer/frontend'

// In your existing ImageMedia component — 3 lines to add:
const optimizedProps = getOptimizedImageProps(resource)

<NextImage
  {...optimizedProps}   // spreads: placeholder, blurDataURL, style, loader
  src={src}
  alt={alt}
  fill={fill}
  sizes={sizes}
  quality={80}
  priority={priority}
  loading={loading}
/>
```

**Returns:**
```ts
{
  placeholder: 'blur' | 'empty',
  blurDataURL?: string,              // data URL from ThumbHash
  style: { objectPosition: string }, // from focalX/focalY
  loader?: ImageLoader,              // variant-aware loader (only when media.sizes has variants)
}
```

**Payload Website Template integration example:**

If you're using the [Payload website template](https://github.com/payloadcms/payload/tree/main/templates/website), modify `src/components/Media/ImageMedia/index.tsx`:

```diff
+ import { getOptimizedImageProps } from '@inoo-ch/payload-image-optimizer/frontend'

  export const ImageMedia: React.FC<MediaProps> = (props) => {
    // ... existing code ...

+   const optimizedProps = typeof resource === 'object' ? getOptimizedImageProps(resource) : {}

    return (
      <picture className={cn(pictureClassName)}>
        <NextImage
+         {...optimizedProps}
          alt={alt || ''}
          className={cn(imgClassName)}
          fill={fill}
          height={!fill ? height : undefined}
-         placeholder="blur"
-         blurDataURL={placeholderBlur}
          priority={priority}
-         quality={100}
+         quality={80}
          loading={loading}
          sizes={sizes}
          src={src}
          width={!fill ? width : undefined}
        />
      </picture>
    )
  }
```

This replaces the template's hardcoded blur placeholder with per-image ThumbHash, adds focal point support, and enables variant-aware responsive loading — all in a few lines.

### `getImageOptimizerProps()` — Low-Level Utility

Returns only ThumbHash placeholder and focal point props (no variant loader). Use when you need granular control or don't want the variant loader.

```tsx
import { getImageOptimizerProps } from '@inoo-ch/payload-image-optimizer/frontend'

const optimizerProps = getImageOptimizerProps(media)

<NextImage
  src={media.url}
  alt={media.alt}
  {...optimizerProps}
/>
```

**Returns:**
```ts
{
  placeholder: 'blur' | 'empty',
  blurDataURL?: string,
  style: { objectPosition: string },
}
```

### `createVariantLoader()` — Custom Loader Factory

Creates a Next.js Image `loader` that maps requested widths to pre-generated Payload size variants. Use when building fully custom image components.

```tsx
import { createVariantLoader } from '@inoo-ch/payload-image-optimizer/frontend'

const loader = createVariantLoader(media) // returns undefined when no variants

<NextImage loader={loader} src={media.url} sizes="100vw" ... />
```

**How the hybrid loader works:**
1. Finds the smallest Payload size variant with width >= requested width
2. If found → serves the pre-generated variant URL directly (bypasses `/_next/image`)
3. If no variant is large enough → uses the largest variant if it covers >= 80% of requested width
4. If no close match at all → falls back to `/_next/image` re-optimization

### `getDefaultSizes()` — Smart Sizes Helper

Returns a sensible default `sizes` attribute for fill-mode images:

```tsx
import { getDefaultSizes } from '@inoo-ch/payload-image-optimizer/frontend'

const sizes = getDefaultSizes(true) // '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw'
const sizes = getDefaultSizes(false) // undefined (let next/image use 1x/2x descriptors)
```

### `FadeImage` Component

Standalone Next.js `<Image>` wrapper with fade-in transition for use with `getImageOptimizerProps()`. Use this when you have a custom image component and want the fade effect without `ImageBox`.

```tsx
import { FadeImage, getImageOptimizerProps } from '@inoo-ch/payload-image-optimizer/frontend'

const optimizerProps = getImageOptimizerProps(resource)

<FadeImage
  src={resource.url}
  alt=""
  width={800}
  height={600}
  optimizerProps={optimizerProps}
/>
```

**Props:** Extends all Next.js `ImageProps` (except `placeholder`, `blurDataURL`, `onLoad`), plus:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `optimizerProps` | `ImageOptimizerProps` | — | Props returned by `getImageOptimizerProps()` |
| `fadeDuration` | `number` | `500` | Duration of the fade animation in milliseconds |

### Client Utility Decision Guide

| Scenario | Use | Why |
|----------|-----|-----|
| **New project, fresh components** | `ImageBox` | Zero-config, handles everything |
| **Existing project with Payload website template** | `getOptimizedImageProps()` | 3-line change to existing `ImageMedia` |
| **Custom component, want blur + focal + variants** | `getOptimizedImageProps()` | Single spread, all features |
| **Custom component, only want blur + focal** | `getImageOptimizerProps()` | Lighter, no loader |
| **Fully custom loader logic** | `createVariantLoader()` | Granular control |
| **Custom component with fade animation** | `FadeImage` + `getImageOptimizerProps()` | Fade without ImageBox |

## Server-Side Utilities

Import from `@inoo-ch/payload-image-optimizer`:

### `encodeImageToThumbHash(buffer, width, height)`

Encode raw RGBA pixel data to a base64 ThumbHash string.

### `decodeThumbHashToDataURL(thumbHash)`

Decode a base64 ThumbHash string to a data URL for use as an `<img src>`.

## Background Jobs

The plugin registers two Payload job tasks (retries: 2 each):

| Task Slug | Trigger | Purpose |
|-----------|---------|---------|
| `imageOptimizer_convertFormats` | After upload (`afterChange` hook) | Generate format variants for a single document |
| `imageOptimizer_regenerateDocument` | Bulk regeneration endpoint | Fully re-optimize a single document (resize + thumbhash + all variants) |

## Vercel / Serverless Deployment

Image processing can exceed the default serverless function timeout. Re-export the plugin's `maxDuration` from the Payload API route:

```ts
// src/app/(payload)/api/[...slug]/route.ts
export { maxDuration } from '@inoo-ch/payload-image-optimizer'
```

This sets a 60-second timeout. Without this, uploads with heavy configs (AVIF + ThumbHash + metadata stripping) may time out on Vercel.

### Large file uploads with Vercel Blob

Even with `maxDuration` and `bodySizeLimit`, large uploads hit Vercel's 4.5MB request body limit on serverless functions. If using `@payloadcms/storage-vercel-blob`, enable `clientUploads: true` so files upload directly from the browser to Vercel Blob (up to 5TB), bypassing the server body size limit entirely:

```ts
vercelBlobStorage({
  collections: { media: true },
  token: process.env.BLOB_READ_WRITE_TOKEN,
  clientUploads: true,
})
```

### "This blob already exists" error

When `replaceOriginal: true` (default), the plugin changes filenames (e.g., `photo.jpg` → `photo.webp`). If a blob with that name already exists, Vercel Blob throws an error because `@payloadcms/storage-vercel-blob` does not pass `allowOverwrite` to the Vercel Blob SDK.

**Fix (recommended):** Enable `uniqueFileNames` in the plugin config — replaces filenames with UUIDs before the storage adapter sees them. This fixes both initial uploads AND regeneration (the regeneration task also generates a new UUID for cloud storage re-uploads):

```ts
imageOptimizer({
  collections: { media: true },
  uniqueFileNames: true, // photo.jpg → a1b2c3d4-5e6f-7890-abcd-ef1234567890.webp
})
```

**Alternative:** Set `addRandomSuffix: true` on the storage adapter (only fixes initial uploads, not regeneration):

```ts
vercelBlobStorage({
  collections: { media: true },
  token: process.env.BLOB_READ_WRITE_TOKEN,
  clientUploads: true,
  addRandomSuffix: true,
})
```

## Full Example

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { imageOptimizer } from '@inoo-ch/payload-image-optimizer'
import sharp from 'sharp'

export default buildConfig({
  collections: [
    {
      slug: 'media',
      fields: [],
      upload: { staticDir: './media' },
    },
    {
      slug: 'avatars',
      fields: [],
      upload: { staticDir: './avatars' },
    },
  ],
  plugins: [
    imageOptimizer({
      collections: {
        media: true, // all defaults: webp@80, 2560x2560, strip, thumbhash
        avatars: {
          maxDimensions: { width: 256, height: 256 },
          formats: [{ format: 'webp', quality: 90 }],
        },
      },
      formats: [
        { format: 'webp', quality: 80 },
        { format: 'avif', quality: 65 },
      ],
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

## TypeScript

Exported types:

```ts
import type {
  ImageOptimizerConfig,
  CollectionOptimizerConfig,
  FormatQuality,
  ImageFormat,            // 'webp' | 'avif'
  MediaResource,          // type for media documents passed to client utilities
  MediaSizeVariant,       // type for individual size variants in media.sizes
} from '@inoo-ch/payload-image-optimizer'

import type {
  ImageBoxProps,
  FadeImageProps,
  ImageOptimizerProps,    // return type of getImageOptimizerProps
  OptimizedImageProps,    // return type of getOptimizedImageProps
} from '@inoo-ch/payload-image-optimizer/frontend'
```

### `MediaResource` Type

The `MediaResource` type represents a Payload media document as consumed by client utilities. It accepts the full Payload media response including the `sizes` field (generated by Payload when `imageSizes` is configured on the collection).

```ts
type MediaResource = {
  url?: string | null
  alt?: string | null
  width?: number | null
  height?: number | null
  filename?: string | null
  focalX?: number | null
  focalY?: number | null
  imageOptimizer?: { thumbHash?: string | null } | null
  updatedAt?: string
  sizes?: Record<string, {
    url?: string | null
    width?: number | null
    height?: number | null
    mimeType?: string | null
    filesize?: number | null
    filename?: string | null
  } | undefined>
}
```

The type is intentionally loose — it structurally matches any Payload media document whether or not the plugin is installed. You can pass your generated Payload types directly without casting.

## Context Flags

The plugin uses `req.context` flags to control processing:

| Flag | Purpose |
|------|---------|
| `imageOptimizer_skip: true` | Set this on `req.context` to skip all optimization for a specific operation (useful for programmatic updates that shouldn't re-trigger processing). |

```ts
// Example: update a media doc without re-processing
await payload.update({
  collection: 'media',
  id: docId,
  data: { alt: 'Updated alt text' },
  context: { imageOptimizer_skip: true },
})
```
