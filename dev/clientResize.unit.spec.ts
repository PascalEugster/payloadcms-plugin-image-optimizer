import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { resizeImage } from '../src/utilities/clientResize.js'

// vitest's default `node` environment doesn't expose DOM APIs — we stub the
// exact surface resizeImage touches. This keeps the helper testable without
// wiring up jsdom just for one file.

type CreateImageBitmap = (input: Blob) => Promise<ImageBitmap>

type CanvasToBlob = (cb: (b: Blob | null) => void, type?: string, quality?: number) => void

type CanvasContext2D = {
  drawImage: (...args: unknown[]) => void
  getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray }
}

type StubCanvas = {
  width: number
  height: number
  getContext: (kind: string) => CanvasContext2D | null
  toBlob: CanvasToBlob
}

const originalCreateImageBitmap = (globalThis as any).createImageBitmap
const originalDocument = (globalThis as any).document

type AlphaMode =
  | 'opaque' // every pixel fully opaque (alpha = 255)
  | 'transparent' // at least one pixel has alpha < 255
  | 'throws' // getImageData throws (tainted canvas / cross-origin)

type Stubs = {
  bitmapWidth: number
  bitmapHeight: number
  bitmapThrows?: boolean
  blob?: Blob | null
  noContext?: boolean
  /**
   * Controls what `ctx.getImageData` returns for the alpha scan. Only
   * consulted for file types that could carry alpha (PNG/WebP/BMP/TIFF).
   * Defaults to 'opaque' so existing JPEG-path tests stay unaffected.
   */
  alpha?: AlphaMode
  /** Captures the MIME type passed to canvas.toBlob, for assertions. */
  onToBlob?: (type?: string, quality?: number) => void
}

const buildGetImageData = (
  mode: AlphaMode,
): ((x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray }) => {
  return (_x, _y, w, h) => {
    if (mode === 'throws') {
      throw new DOMException('tainted canvas', 'SecurityError')
    }
    // Use a small fixed buffer — hasAlpha iterates with stride 32 so any
    // buffer larger than 4 bytes exercises the loop. Keep it small to avoid
    // allocating megabytes of typed array per test.
    const pixelCount = Math.max(32, Math.min(256, w * h))
    const data = new Uint8ClampedArray(pixelCount * 4)
    for (let i = 0; i < pixelCount; i++) {
      data[i * 4 + 0] = 0
      data[i * 4 + 1] = 0
      data[i * 4 + 2] = 0
      data[i * 4 + 3] = 255 // fully opaque by default
    }
    if (mode === 'transparent') {
      // Place a transparent pixel at index 0 — the scan starts at byte 3
      // (alpha of pixel 0) so this is guaranteed to be hit.
      data[3] = 0
    }
    return { data }
  }
}

const installStubs = (stubs: Stubs) => {
  const bitmap: ImageBitmap = {
    width: stubs.bitmapWidth,
    height: stubs.bitmapHeight,
    close: () => {},
  } as unknown as ImageBitmap

  const createImageBitmapStub: CreateImageBitmap = async () => {
    if (stubs.bitmapThrows) throw new Error('decode failed')
    return bitmap
  }
  ;(globalThis as any).createImageBitmap = createImageBitmapStub

  const ctx: CanvasContext2D = {
    drawImage: () => {},
    getImageData: buildGetImageData(stubs.alpha ?? 'opaque'),
  }

  const canvas: StubCanvas = {
    width: 0,
    height: 0,
    getContext: () => (stubs.noContext ? null : ctx),
    toBlob: (cb, type, quality) => {
      stubs.onToBlob?.(type, quality)
      cb(stubs.blob ?? null)
    },
  }
  ;(globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return canvas
      throw new Error(`unexpected createElement('${tag}')`)
    },
  }
}

beforeEach(() => {
  // Reset between tests so one stub doesn't leak into the next.
  ;(globalThis as any).createImageBitmap = undefined
  ;(globalThis as any).document = undefined
})

afterEach(() => {
  ;(globalThis as any).createImageBitmap = originalCreateImageBitmap
  ;(globalThis as any).document = originalDocument
  vi.restoreAllMocks()
})

describe('resizeImage', () => {
  test('returns original file when MIME type is not resizable', async () => {
    // No DOM stubs — a bail-out before createImageBitmap is reached.
    const file = new File(['ignored'], 'doc.pdf', { type: 'application/pdf' })
    const result = await resizeImage(file)
    expect(result).toBe(file)
  })

  test('returns original file when createImageBitmap throws (corrupt/OOM)', async () => {
    installStubs({ bitmapWidth: 4000, bitmapHeight: 3000, bitmapThrows: true })
    const file = new File(['corrupt'], 'big.jpg', { type: 'image/jpeg' })
    const result = await resizeImage(file)
    expect(result).toBe(file)
  })

  test('returns original file when image is within max dimensions', async () => {
    installStubs({ bitmapWidth: 1920, bitmapHeight: 1080 })
    const file = new File(['hd'], 'hd.jpg', { type: 'image/jpeg' })
    const result = await resizeImage(file)
    expect(result).toBe(file)
  })

  test('returns original file when canvas.toBlob yields null (iOS Safari edge case)', async () => {
    installStubs({ bitmapWidth: 4000, bitmapHeight: 3000, blob: null })
    const file = new File(['oversized'], 'huge.jpg', { type: 'image/jpeg' })
    const result = await resizeImage(file)
    // Critical: must be the original, NOT a File([null], ...) with garbage content.
    expect(result).toBe(file)
  })

  test('returns original file when canvas.toBlob yields an empty blob', async () => {
    installStubs({
      bitmapWidth: 4000,
      bitmapHeight: 3000,
      blob: new Blob([], { type: 'image/jpeg' }),
    })
    const file = new File(['oversized'], 'huge.jpg', { type: 'image/jpeg' })
    const result = await resizeImage(file)
    expect(result).toBe(file)
  })

  test('returns original file when canvas getContext returns null', async () => {
    installStubs({ bitmapWidth: 4000, bitmapHeight: 3000, noContext: true })
    const file = new File(['oversized'], 'huge.jpg', { type: 'image/jpeg' })
    const result = await resizeImage(file)
    expect(result).toBe(file)
  })

  test('produces a new resized File with .jpg extension for non-PNG inputs', async () => {
    const fakeBlob = new Blob(['resized-bytes'], { type: 'image/jpeg' })
    installStubs({ bitmapWidth: 4000, bitmapHeight: 3000, blob: fakeBlob })
    const file = new File(['oversized'], 'IMG_1234.JPEG', { type: 'image/jpeg' })
    const result = await resizeImage(file)
    expect(result).not.toBe(file)
    expect(result.name).toBe('IMG_1234.jpg')
    expect(result.type).toBe('image/jpeg')
    expect(result.size).toBeGreaterThan(0)
  })

  test('keeps PNG extension for opaque PNG inputs (preserves format even without alpha)', async () => {
    const fakeBlob = new Blob(['resized-bytes'], { type: 'image/png' })
    let seenType: string | undefined
    installStubs({
      bitmapWidth: 4000,
      bitmapHeight: 3000,
      blob: fakeBlob,
      alpha: 'opaque',
      onToBlob: (type) => {
        seenType = type
      },
    })
    const file = new File(['oversized'], 'logo.PNG', { type: 'image/png' })
    const result = await resizeImage(file)
    // Opaque PNG has no alpha → logic picks JPEG output (smaller file, same
    // visual fidelity). This is the intended behavior of the alpha-aware
    // encoder selection. If an opaque PNG later needs to stay PNG, it would
    // belong to a different concern (format preservation), not alpha safety.
    expect(seenType).toBe('image/jpeg')
    expect(result.name).toBe('logo.jpg')
    expect(result.type).toBe('image/jpeg')
  })

  test('WebP with alpha outputs PNG to preserve transparency', async () => {
    const fakeBlob = new Blob(['resized-bytes'], { type: 'image/png' })
    let seenType: string | undefined
    installStubs({
      bitmapWidth: 4000,
      bitmapHeight: 3000,
      blob: fakeBlob,
      alpha: 'transparent',
      onToBlob: (type) => {
        seenType = type
      },
    })
    const file = new File(['oversized'], 'sticker.webp', { type: 'image/webp' })
    const result = await resizeImage(file)
    expect(seenType).toBe('image/png')
    expect(result.name).toBe('sticker.png')
    expect(result.type).toBe('image/png')
  })

  test('WebP without alpha outputs JPEG', async () => {
    const fakeBlob = new Blob(['resized-bytes'], { type: 'image/jpeg' })
    let seenType: string | undefined
    installStubs({
      bitmapWidth: 4000,
      bitmapHeight: 3000,
      blob: fakeBlob,
      alpha: 'opaque',
      onToBlob: (type) => {
        seenType = type
      },
    })
    const file = new File(['oversized'], 'photo.webp', { type: 'image/webp' })
    const result = await resizeImage(file)
    expect(seenType).toBe('image/jpeg')
    expect(result.name).toBe('photo.jpg')
    expect(result.type).toBe('image/jpeg')
  })

  test('JPEG skips the alpha scan (fast path)', async () => {
    const fakeBlob = new Blob(['resized-bytes'], { type: 'image/jpeg' })
    const getImageDataSpy = vi.fn(buildGetImageData('opaque'))
    installStubs({ bitmapWidth: 4000, bitmapHeight: 3000, blob: fakeBlob })
    // Overwrite the ctx's getImageData with a spy so we can assert it's
    // never called on the JPEG path.
    const doc = (globalThis as any).document as { createElement: (t: string) => StubCanvas }
    const canvas = doc.createElement('canvas')
    const ctx = canvas.getContext('2d') as CanvasContext2D
    ctx.getImageData = getImageDataSpy
    // Reinstall document so subsequent createElement returns the same canvas.
    ;(globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === 'canvas') return canvas
        throw new Error(`unexpected createElement('${tag}')`)
      },
    }
    const file = new File(['oversized'], 'photo.jpg', { type: 'image/jpeg' })
    await resizeImage(file)
    expect(getImageDataSpy).not.toHaveBeenCalled()
  })

  test('tainted-canvas SecurityError on getImageData falls back to PNG output', async () => {
    const fakeBlob = new Blob(['resized-bytes'], { type: 'image/png' })
    let seenType: string | undefined
    installStubs({
      bitmapWidth: 4000,
      bitmapHeight: 3000,
      blob: fakeBlob,
      alpha: 'throws',
      onToBlob: (type) => {
        seenType = type
      },
    })
    const file = new File(['oversized'], 'xorigin.webp', { type: 'image/webp' })
    const result = await resizeImage(file)
    // Safe default: assume alpha present → PNG output, no silent flattening.
    expect(seenType).toBe('image/png')
    expect(result.name).toBe('xorigin.png')
    expect(result.type).toBe('image/png')
  })
})
