# Migration Guide — v2.x → v3.0.0

v3 is a deliberate simplification: the plugin now only does what Payload can't do natively. Everything Payload handles well (resize, format, EXIF, per-size variants, focal-point crops) is still configured through the plugin, but via one-to-one pass-throughs to `upload.formatOptions` / `upload.resizeOptions` / `upload.withMetadata`. Everything that was *additional* plumbing — the multi-format async job, the buffer-passing context flags, the async status states — is gone.

The breaking changes are small and mechanical. Most projects will only touch a few config lines and nothing else.

## Why v3 exists

Payload 3.x already exposes every sharp knob needed for image optimization. The plugin's previous multi-format feature (generating both WebP and AVIF siblings on the same size) worked **only on local filesystem storage**. On cloud storage (S3, Vercel Blob, R2 — where virtually all production Payload deployments live) it early-returned with `variants: []`. That's ~150 lines of async job plumbing, a retry-capable queue, a global lock, and new failure windows (DB commit vs storage atomicity) — all for a feature most users couldn't benefit from.

v3 removes that feature entirely, plus the complexity that existed to support it (afterChange hook, convertFormats task, pending/processing status states, `variants` field on every doc). The plugin's actually-unique value — client-side pre-resize, filename strategies, ThumbHash, regeneration UI, status field, responsive helper — is unchanged.

---

## Config changes

### `formats: FormatQuality[]` → `format: FormatQuality | null`

The plugin now produces a single format per upload (same as Payload's native `upload.formatOptions`).

**Before (v2):**
```ts
imageOptimizer({
  collections: { media: true },
  formats: [
    { format: 'webp', quality: 80 },
    { format: 'avif', quality: 65 }, // produced as a sibling file via async job
  ],
})
```

**After (v3):**
```ts
imageOptimizer({
  collections: { media: true },
  format: { format: 'webp', quality: 80 }, // singular
})
```

**If you relied on multi-format (WebP + AVIF siblings):** this only worked on local disk in v2. On any cloud storage adapter, the additive formats were silently skipped. If you have a genuine use case for it, set `upload.formatOptions` in an `imageSize` with a different format — Payload's native per-size `formatOptions` is the supported mechanism for different formats.

**To disable format conversion entirely:** pass `null`:
```ts
imageOptimizer({
  collections: { media: true },
  format: null, // original extension preserved
})
```

### `replaceOriginal` removed

In v2, `replaceOriginal: false` kept the original file AND generated additive variants. With additive variants gone, `replaceOriginal: false` had no meaningful behavior. When you set `format`, the original is always replaced via Payload's `upload.formatOptions`.

**Before (v2):**
```ts
imageOptimizer({
  collections: { media: true },
  replaceOriginal: false, // kept original + generated variant siblings
})
```

**After (v3):**
```ts
imageOptimizer({
  collections: { media: true },
  format: null, // if you want the original untouched, disable format conversion
})
```

### `CollectionOptimizerConfig` follows the same changes

**Before (v2):**
```ts
collections: {
  avatars: {
    formats: [{ format: 'webp', quality: 90 }],
    maxDimensions: { width: 256, height: 256 },
    replaceOriginal: true,
  },
}
```

**After (v3):**
```ts
collections: {
  avatars: {
    format: { format: 'webp', quality: 90 },
    maxDimensions: { width: 256, height: 256 },
  },
}
```

---

## Field schema changes

The `imageOptimizer` group field loses `variants` and narrows the `status` enum:

**Before (v2):**
```ts
imageOptimizer: {
  status: 'pending' | 'processing' | 'complete' | 'error',
  originalSize: number,
  optimizedSize: number,
  thumbHash: string,
  error: string,
  variants: Array<{
    format: string
    filename: string
    filesize: number
    width: number
    height: number
    mimeType: string
    url: string
  }>,
}
```

**After (v3):**
```ts
imageOptimizer: {
  status: 'complete' | 'error',
  originalSize: number,
  optimizedSize: number,
  thumbHash: string,
  error: string,
}
```

### Existing data

Payload tolerates extra data on reads — documents with leftover `imageOptimizer.variants` arrays or `status: 'pending'` values will still load. You do **not** need to run a migration to read existing docs.

If you want to clean up the stored data:

**MongoDB:**
```js
db.media.updateMany(
  {},
  {
    $unset: { 'imageOptimizer.variants': '' },
    $set: { 'imageOptimizer.status': 'complete' }, // or leave the raw value; non-matching strings are ignored on read
  },
)
```

**Postgres:** drop the `imageOptimizer_variants` related table(s) via a migration. Generate a fresh migration after updating to v3 so Payload's migration generator picks up the schema change.

If you had a frontend consuming `imageOptimizer.variants` (e.g. rendering `<source type="image/avif">` tags), use Payload's native `doc.sizes` instead — each size has its own `url`, `width`, `height`, `mimeType`, and `filesize`.

---

## `MetadataPolicy` signature (v2.2.0 change, re-stated for v3)

If you were on v2.1.x, the `req` field on the `MetadataPolicy` callback was removed in v2.2.0. The runtime value was always `undefined`, so the behavior is unchanged — but destructuring `req` now errors at the type level.

**Before:**
```ts
metadataPolicy: ({ metadata, req }) => metadata.format === 'jpeg'
```

**After:**
```ts
metadataPolicy: ({ metadata }) => metadata.format === 'jpeg'
```

---

## What didn't change

Everything you actually use day-to-day is unchanged:

- `clientOptimization` (client-side Canvas pre-resize) — unchanged
- `generateFilename` + `uuidFilename` / `seoFilename` / `timestampFilename` — unchanged
- `generateThumbHash` — unchanged (now runs inline in `beforeChange`; was already inline for single-format configs in v2, just deferred for multi-format)
- `adminThumbnail` — unchanged
- `responseHeaders` — unchanged
- `metadataPolicy` / `stripMetadata` — unchanged
- `regenerateButton` config + the bulk regeneration UI + stop button — unchanged
- `<ImageBox>` / `<FadeImage>` / `getOptimizedImageProps()` / `createVariantLoader()` — unchanged
- REST endpoints (`POST /api/image-optimizer/regenerate`, `GET`, `DELETE`) — unchanged
- Plugin exports — unchanged except `MetadataPolicy` (type-level only, see above)

---

## Performance notes

- **Upload is now faster.** No async job, no `waitUntil` follow-up, no second document write. Every upload is a single DB commit with the full `imageOptimizer` record in one transaction.
- **Cloud storage atomicity improved.** The old v2 flow sometimes committed a new filename to the DB before the follow-up blob upload completed — if the follow-up failed, the DB referenced a blob that didn't exist. That entire class of failure window is gone.
- **Regeneration is unchanged** — same task, same pipeline, same performance.

---

## Questions?

- **"I need WebP + AVIF siblings for `<picture>` tags"** — use Payload's per-`imageSize.formatOptions` with different formats, or use the Vercel Image Optimization / `next/image` pipeline which serves AVIF automatically on supported browsers.
- **"I relied on `status: 'pending'` to block a UI until processing was done"** — that state no longer exists; status is `'complete'` before the doc is returned from the upload API.
- **"I had custom code reading `doc.imageOptimizer.variants`"** — switch to `doc.sizes` (Payload's native) for per-size URLs.

Still stuck? Open an issue at https://github.com/PascalEugster/payloadcms-plugin-image-optimizer/issues.

---

# Migration Guide — v3.4.0 → v3.5.0

**No changes required unless you want to opt in.** 3.5.0 is purely additive — the new `storeBlurDataURL` flag defaults to `false`, so upgrading alone changes nothing about your schema, wire payload, or render path.

## When to opt in

3.5.0 adds an opt-in fast path for the blur placeholder data URL that `getImageOptimizerProps()` otherwise decodes from `imageOptimizer.thumbHash` on every render. The decode is a JS-native inverse-DCT + manual Deflate/CRC/base64 PNG build — observed empirically by plugin consumers to cost roughly 1–5 ms per image on mid-tier Android. On listing pages with 20+ media items it can add up to measurable TBT. Measure your own render path before flipping it on.

## Trade-off

When `storeBlurDataURL: true`, the base64 data URL (typically 1–3 KB per doc) is persisted on every media doc and therefore ships in every listing-endpoint response. On small catalogues this is fine; on very large listings (hundreds of docs per request) it's worth weighing against the client-side decode cost you'd save.

## Three-step opt-in

1. **Upgrade the dependency** to `3.5.0`.
2. **Set the flag** in your plugin config:
   ```ts
   imageOptimizer({
     collections: { media: true },
     storeBlurDataURL: true,
   })
   ```
3. **Regenerate types** so the new `imageOptimizer.blurDataURL` field appears on your generated media doc type:
   ```bash
   pnpm payload generate:types
   ```
4. **Backfill existing documents.** New uploads automatically get the field populated in `beforeChange`. Existing docs uploaded before the flag was set continue to render correctly — `getImageOptimizerProps()` falls back to the runtime decode when the field is absent — but to get the optimization on them too, click the plugin's **Regenerate All Documents** button in the admin collection list, or hit:
   ```
   POST /api/image-optimizer/regenerate
   ```
   The regeneration task already re-runs `beforeChange`, so it fills in `imageOptimizer.blurDataURL` on every processed doc. No new endpoint was added.

## Rolling back

Setting `storeBlurDataURL: false` (or removing the flag) immediately reverts the render path to the existing runtime decode. The stored field on already-processed docs becomes dead data but doesn't break anything — it is simply ignored when the flag is off. If you want to reclaim the storage, unset the field with a `$unset` on MongoDB (or equivalent) after rollback.
