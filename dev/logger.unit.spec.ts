import { describe, expect, test, vi } from 'vitest'

import { resolveLogging } from '../src/defaults.js'
import { createRegenLogger } from '../src/utilities/logger.js'

const makeReq = () => ({
  payload: {
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
  },
})

const doc = {
  alt: 'a cat',
  filename: 'pic.webp',
  filesize: 1234,
  mimeType: 'image/webp',
}

describe('resolveLogging', () => {
  test('undefined → silent preset (errors-only)', () => {
    expect(resolveLogging(undefined)).toEqual({
      errors: true,
      includeDocDetails: false,
      lifecycle: false,
      skips: { docDeleted: false, notImage: false, userCancelled: false },
    })
  })

  test("'silent' mode matches the undefined default", () => {
    expect(resolveLogging('silent')).toEqual(resolveLogging(undefined))
  })

  test("'normal' enables lifecycle + userCancelled skip", () => {
    expect(resolveLogging('normal')).toEqual({
      errors: true,
      includeDocDetails: false,
      lifecycle: true,
      skips: { docDeleted: false, notImage: false, userCancelled: true },
    })
  })

  test("'verbose' enables everything", () => {
    expect(resolveLogging('verbose')).toEqual({
      errors: true,
      includeDocDetails: true,
      lifecycle: true,
      skips: { docDeleted: true, notImage: true, userCancelled: true },
    })
  })

  test('empty object merges over silent (= silent)', () => {
    expect(resolveLogging({})).toEqual(resolveLogging('silent'))
  })

  test('object form: fields override silent baseline one-by-one', () => {
    expect(
      resolveLogging({ includeDocDetails: true, lifecycle: true }),
    ).toMatchObject({
      errors: true,
      includeDocDetails: true,
      lifecycle: true,
    })
  })

  test('errors: false explicitly disables error logs', () => {
    expect(resolveLogging({ errors: false }).errors).toBe(false)
  })

  test('skips: true shorthand enables all reasons', () => {
    expect(resolveLogging({ skips: true }).skips).toEqual({
      docDeleted: true,
      notImage: true,
      userCancelled: true,
    })
  })

  test('skips: false shorthand disables all reasons', () => {
    expect(resolveLogging({ skips: false }).skips).toEqual({
      docDeleted: false,
      notImage: false,
      userCancelled: false,
    })
  })

  test('skips: object does per-reason merge over silent baseline', () => {
    expect(resolveLogging({ skips: { docDeleted: true } }).skips).toEqual({
      docDeleted: true,
      notImage: false,
      userCancelled: false,
    })
  })
})

describe('createRegenLogger — gating matrix', () => {
  const baseCtx = { collectionSlug: 'media', docId: '123' }

  test("'silent': enter/exit/skipped stay quiet, error fires", () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging('silent'), req)

    logger.enter(baseCtx)
    logger.exit({ ...baseCtx, doc, startedAt: Date.now() })
    logger.skipped({ ...baseCtx, reason: 'user-cancelled' })
    logger.skipped({ ...baseCtx, reason: 'doc-deleted' })
    logger.skipped({ ...baseCtx, reason: 'not-image' })

    expect(req.payload.logger.info).not.toHaveBeenCalled()

    logger.error({ ...baseCtx, err: new Error('boom'), startedAt: Date.now() })
    expect(req.payload.logger.error).toHaveBeenCalledTimes(1)
  })

  test("'normal': lifecycle + userCancelled log; docDeleted / notImage stay quiet", () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging('normal'), req)

    logger.enter(baseCtx)
    logger.exit({ ...baseCtx, doc, startedAt: Date.now() })
    logger.skipped({ ...baseCtx, reason: 'user-cancelled' })
    logger.skipped({ ...baseCtx, reason: 'doc-deleted' })
    logger.skipped({ ...baseCtx, reason: 'not-image' })

    // enter + exit + user-cancelled = 3
    expect(req.payload.logger.info).toHaveBeenCalledTimes(3)
  })

  test("'verbose': all lifecycle and skip reasons log", () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging('verbose'), req)

    logger.enter(baseCtx)
    logger.exit({ ...baseCtx, doc, startedAt: Date.now() })
    logger.skipped({ ...baseCtx, reason: 'user-cancelled' })
    logger.skipped({ ...baseCtx, reason: 'doc-deleted' })
    logger.skipped({ ...baseCtx, reason: 'not-image' })

    // enter + exit + 3 skipped = 5
    expect(req.payload.logger.info).toHaveBeenCalledTimes(5)
  })

  test('errors: false suppresses the error log', () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging({ errors: false }), req)
    logger.error({ ...baseCtx, err: new Error('boom'), startedAt: Date.now() })
    expect(req.payload.logger.error).not.toHaveBeenCalled()
  })
})

describe('createRegenLogger — record shape', () => {
  const baseCtx = { collectionSlug: 'media', docId: '123' }

  test('enter emits event tag + context only', () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging('normal'), req)

    logger.enter(baseCtx)

    const [obj] = req.payload.logger.info.mock.calls[0]
    expect(obj).toMatchObject({
      collectionSlug: 'media',
      docId: '123',
      event: 'imageOpt.regen.enter',
    })
    // No doc details on enter — the doc isn't loaded yet
    expect(obj).not.toHaveProperty('filename')
  })

  test('exit includes durationMs; excludes doc details at normal mode', () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging('normal'), req)

    logger.exit({ ...baseCtx, doc, startedAt: Date.now() - 100 })

    const [obj] = req.payload.logger.info.mock.calls[0]
    expect(obj).toMatchObject({ event: 'imageOpt.regen.exit' })
    expect(typeof obj.durationMs).toBe('number')
    expect(obj.durationMs).toBeGreaterThanOrEqual(100)
    expect(obj).not.toHaveProperty('filename')
  })

  test('exit includes doc details in verbose mode', () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging('verbose'), req)

    logger.exit({ ...baseCtx, doc, startedAt: Date.now() })

    const [obj] = req.payload.logger.info.mock.calls[0]
    expect(obj).toMatchObject({
      alt: 'a cat',
      event: 'imageOpt.regen.exit',
      filename: 'pic.webp',
      filesize: 1234,
      mimeType: 'image/webp',
    })
  })

  test('error passes err through the std Pino field for the serializer', () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging('silent'), req)

    const boom = new Error('boom')
    logger.error({ ...baseCtx, err: boom, startedAt: Date.now() })

    const [obj] = req.payload.logger.error.mock.calls[0]
    expect(obj).toMatchObject({
      collectionSlug: 'media',
      docId: '123',
      event: 'imageOpt.regen.error',
    })
    expect(obj.err).toBe(boom)
    expect(typeof obj.durationMs).toBe('number')
  })

  test('skipped carries the reason field for filtering', () => {
    const req = makeReq()
    const logger = createRegenLogger(resolveLogging('verbose'), req)

    logger.skipped({ ...baseCtx, reason: 'doc-deleted' })

    const [obj] = req.payload.logger.info.mock.calls[0]
    expect(obj).toMatchObject({
      event: 'imageOpt.regen.skipped',
      reason: 'doc-deleted',
    })
  })
})
