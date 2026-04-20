# Changelog

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
