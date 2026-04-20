import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { resizeImage } from '../src/utilities/clientResize.js'

// vitest's default `node` environment doesn't expose DOM APIs — we stub the
// exact surface resizeImage touches. This keeps the helper testable without
// wiring up jsdom just for one file.

type CreateImageBitmap = (input: Blob) => Promise<ImageBitmap>

type CanvasToBlob = (cb: (b: Blob | null) => void, type?: string, quality?: number) => void

type CanvasContext2D = { drawImage: (...args: unknown[]) => void }

type StubCanvas = {
  width: number
  height: number
  getContext: (kind: string) => CanvasContext2D | null
  toBlob: CanvasToBlob
}

const originalCreateImageBitmap = (globalThis as any).createImageBitmap
const originalDocument = (globalThis as any).document

type Stubs = {
  bitmapWidth: number
  bitmapHeight: number
  bitmapThrows?: boolean
  blob?: Blob | null
  noContext?: boolean
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

  const canvas: StubCanvas = {
    width: 0,
    height: 0,
    getContext: () => (stubs.noContext ? null : { drawImage: () => {} }),
    toBlob: (cb) => cb(stubs.blob ?? null),
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

  test('keeps PNG extension for PNG inputs (transparency preserved)', async () => {
    const fakeBlob = new Blob(['resized-bytes'], { type: 'image/png' })
    installStubs({ bitmapWidth: 4000, bitmapHeight: 3000, blob: fakeBlob })
    const file = new File(['oversized'], 'logo.PNG', { type: 'image/png' })
    const result = await resizeImage(file)
    expect(result.name).toBe('logo.png')
    expect(result.type).toBe('image/png')
  })
})
