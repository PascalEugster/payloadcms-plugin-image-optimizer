# @inoo-ch/payload-image-optimizer

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
- **ImageBox component** — Drop-in Next.js `<Image>` wrapper with automatic ThumbHash blur

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
    { format: 'avif', quality: 65 },
  ],
  maxDimensions: { width: 2560, height: 2560 },
  generateThumbHash: true,
  stripMetadata: true,
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

## How It Works

1. **Upload** — An image is uploaded to a configured collection
2. **Pre-process** — The `beforeChange` hook strips metadata, resizes the image, and generates a ThumbHash
3. **Save** — Payload writes the optimized image to disk
4. **Convert** — A background job converts the image to WebP/AVIF variants asynchronously
5. **Done** — The document is updated with variant URLs, file sizes, and optimization status

All format conversion runs as async background jobs, so uploads return immediately.

## How It Differs from Payload's Default Image Handling

Payload CMS ships with [sharp](https://sharp.pixelplumbing.com/) built-in and can resize images and generate sizes on upload. This plugin **does not double-process your images** — it intercepts the raw upload in a `beforeChange` hook *before* Payload's own sharp pipeline runs, and writes the optimized buffer back to `req.file.data`. When Payload's built-in `uploadFiles` step kicks in to generate your configured sizes, it works from the already-optimized file, not the raw original.

### Comparison

| Capability | Payload Default | With This Plugin |
|---|---|---|
| Resize to max dimensions | Manual via `imageSizes` config | Automatic — configure once globally or per-collection |
| WebP/AVIF conversion | Requires custom hooks | Built-in, zero-config |
| EXIF metadata stripping | Not built-in | Automatic (configurable) |
| Blur hash placeholders | Requires custom hooks | ThumbHash generated automatically |
| Optimization status & savings | Not available | Admin sidebar panel per image |
| Bulk re-process existing images | Not available | One-click regeneration with progress tracking |
| Next.js `<Image>` with blur placeholder | Manual wiring | Drop-in `<ImageBox>` component |
| Per-collection format/quality overrides | N/A | Supported |

### CPU & Resource Impact

- **Single-format mode** (e.g. WebP only with `replaceOriginal: true`) adds virtually zero overhead compared to Payload's default sharp processing — the plugin replaces the sharp pass rather than adding a second one.
- **Additional format variants** (e.g. both WebP and AVIF) run as background jobs after upload — this is the one area where you'll see extra CPU usage vs vanilla Payload.
- **ThumbHash generation** processes a 100×100px thumbnail — negligible impact.
- **Bulk regeneration** processes images sequentially, not all at once, so it won't spike your server.

If you're on a resource-constrained server, use single-format mode and you'll be at roughly the same CPU cost as stock Payload.

## Admin UI

The plugin adds an **Optimization Status** panel to the document sidebar showing:

- Status badge (pending / processing / complete / error)
- Original vs. optimized file size with savings percentage
- ThumbHash blur preview thumbnail
- List of generated format variants with dimensions and file sizes

A **Regenerate Images** button appears in collection list views, allowing you to bulk re-process existing images with a real-time progress bar.

## ImageBox Component

The plugin exports an `ImageBox` component — a Next.js `<Image>` wrapper that automatically applies ThumbHash blur placeholders:

```tsx
import { ImageBox } from '@inoo-ch/payload-image-optimizer/client'

// Pass a Payload media document directly
<ImageBox media={doc.heroImage} alt="Hero" />

// Or use a plain URL string
<ImageBox media="/images/photo.jpg" alt="Photo" width={800} height={600} />
```

**Features:**
- Automatic ThumbHash `blurDataURL` from the media document
- Respects Payload focal point (`focalX` / `focalY`) for `objectPosition`
- Lazy loading by default, with `priority` prop for above-the-fold images
- Cache busting via `updatedAt` timestamp

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
> 3. Where to add `<ImageBox>` or `getImageOptimizerProps()` in the frontend for ThumbHash blur placeholders and focal point support
> 4. Whether any existing image rendering code should use the optimized variants
>
> Use the zero-config default (`collections: { <slug>: true }`) unless the project has specific requirements that call for custom settings.

## Contributing

This plugin is open source and we welcome community involvement:

- **Issues** — Found a bug or have a feature request? [Open an issue](https://github.com/payloadcms-plugins/image-optimizer/issues).
- **Pull Requests** — PRs are welcome! Please open an issue first to discuss larger changes.

All changes are reviewed and merged by the package maintainer at [inoo.ch](https://inoo.ch).

## License

MIT - [inoo.ch](https://inoo.ch)
