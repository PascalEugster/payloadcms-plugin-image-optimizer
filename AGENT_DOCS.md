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
  disabled: false,                                  // keep fields but skip all processing
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `Record<slug, true \| CollectionConfig>` | — | **Required.** Collections to optimize. `true` = use global defaults. |
| `formats` | `{ format: 'webp' \| 'avif', quality: number }[]` | `[{ format: 'webp', quality: 80 }]` | Output formats to generate. |
| `maxDimensions` | `{ width: number, height: number }` | `{ width: 2560, height: 2560 }` | Maximum image dimensions (fit inside, no upscaling). |
| `stripMetadata` | `boolean` | `true` | Strip EXIF, ICC, XMP metadata. |
| `generateThumbHash` | `boolean` | `true` | Generate ThumbHash blur placeholder. |
| `replaceOriginal` | `boolean` | `true` | Replace the original file with the primary format. |
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

1. **`beforeChange` hook** (in-memory processing):
   - Auto-rotates based on EXIF orientation
   - Resizes to fit within `maxDimensions`
   - Strips metadata (if enabled)
   - If `replaceOriginal: true`: converts to primary format (first in `formats` array), updates filename/mimeType
   - Generates ThumbHash (if enabled)
   - Sets `imageOptimizer.status = 'pending'`

2. **`afterChange` hook** (disk + async):
   - Writes processed buffer to disk (overwriting Payload's original)
   - Cleans up old file if filename changed
   - Queues `imageOptimizer_convertFormats` background job for remaining formats

3. **Background job** (`imageOptimizer_convertFormats`):
   - Generates variant files for any additional formats (e.g., AVIF)
   - Writes variants to disk with `-optimized` suffix
   - Updates document: `imageOptimizer.status = 'complete'`, populates `variants` array

### File Naming

| File | Naming Pattern | Example |
|------|---------------|---------|
| Main file (replaceOriginal) | `{name}.{primaryFormat}` | `photo.webp` |
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

Import from `@inoo-ch/payload-image-optimizer/client`:

### `ImageBox` Component

Drop-in Next.js `<Image>` wrapper with automatic ThumbHash blur placeholders and focal point support.

```tsx
import { ImageBox } from '@inoo-ch/payload-image-optimizer/client'

// With a Payload media resource object
<ImageBox media={doc.image} alt="Hero" fill sizes="100vw" />

// With a plain URL string
<ImageBox media="/images/fallback.jpg" alt="Fallback" width={800} height={600} />
```

**Props:** Extends all Next.js `ImageProps` (except `src`), plus:

| Prop | Type | Description |
|------|------|-------------|
| `media` | `MediaResource \| string` | Payload media document or URL string |
| `alt` | `string` | Alt text (overrides `media.alt`) |

Automatically applies:
- ThumbHash blur placeholder (if available on the media resource)
- Focal point positioning via `objectPosition` (using `focalX`/`focalY`)
- Cache-busting via `updatedAt` query parameter
- `objectFit: 'cover'` by default (overridable via `style`)

### `getImageOptimizerProps()` Utility

For integrating with existing image components (e.g., the Payload website template's `ImageMedia`):

```tsx
import { getImageOptimizerProps } from '@inoo-ch/payload-image-optimizer/client'
import NextImage from 'next/image'

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
  blurDataURL?: string,           // data URL from ThumbHash (only when placeholder is 'blur')
  style: {
    objectPosition: string,       // e.g. '50% 30%' from focalX/focalY, or 'center'
  },
}
```

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
import { ImageBox } from '@inoo-ch/payload-image-optimizer/client'

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
} from '@inoo-ch/payload-image-optimizer'

import type {
  ImageBoxProps,
  ImageOptimizerProps,    // return type of getImageOptimizerProps
} from '@inoo-ch/payload-image-optimizer/client'
```

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
