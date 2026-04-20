# Changelog

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
