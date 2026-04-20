import { describe, expect, test, vi } from 'vitest'

import { imageOptimizer } from '../src/index.js'
import { uuidFilename } from '../src/utilities/filenameStrategies.js'

const baseConfig = (collectionUpload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({
    collections: [
      {
        slug: 'media',
        fields: [],
        upload: { staticDir: 'media', ...collectionUpload },
      },
    ],
    ...extra,
  }) as any

const runPlugin = (
  pluginOpts: Parameters<typeof imageOptimizer>[0],
  collectionUpload: Record<string, unknown> = {},
  configExtras: Record<string, unknown> = {},
) => {
  const result = imageOptimizer(pluginOpts)(baseConfig(collectionUpload, configExtras))
  const media = (result.collections ?? []).find((c) => c.slug === 'media')
  return media?.upload as Record<string, unknown>
}

describe('responseHeaders injection', () => {
  test('default (false): does not inject modifyResponseHeaders', () => {
    const upload = runPlugin({ collections: { media: true } })
    expect(upload.modifyResponseHeaders).toBeUndefined()
  })

  test("'immutable' shortcut sets the long-lived Cache-Control header", () => {
    const upload = runPlugin({
      collections: { media: true },
      generateFilename: uuidFilename, // suppress the warn
      responseHeaders: 'immutable',
    })

    expect(typeof upload.modifyResponseHeaders).toBe('function')
    const fn = upload.modifyResponseHeaders as (args: { headers: Headers }) => Headers
    const headers = new Headers()
    const out = fn({ headers })
    expect(out.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })

  test("'immutable' WITHOUT generateFilename emits a logger.warn at init", () => {
    const warn = vi.fn()
    const logger = { warn }

    runPlugin(
      { collections: { media: true }, responseHeaders: 'immutable' },
      {},
      { logger },
    )

    expect(warn).toHaveBeenCalledTimes(1)
    const msg = warn.mock.calls[0][0] as string
    expect(msg).toContain('image-optimizer')
    expect(msg).toContain('immutable')
    expect(msg).toContain('media')
    expect(msg).toContain('generateFilename')
  })

  test("'immutable' WITH generateFilename does NOT warn", () => {
    const warn = vi.fn()
    runPlugin(
      {
        collections: { media: true },
        generateFilename: uuidFilename,
        responseHeaders: 'immutable',
      },
      {},
      { logger: { warn } },
    )
    expect(warn).not.toHaveBeenCalled()
  })

  test('function mode is wired through Payload-shaped wrapper', () => {
    const userFn = vi.fn((headers: Headers) => {
      headers.set('X-User', 'set')
      return headers
    })

    const upload = runPlugin({
      collections: { media: true },
      responseHeaders: userFn,
    })

    expect(typeof upload.modifyResponseHeaders).toBe('function')
    const fn = upload.modifyResponseHeaders as (args: { headers: Headers }) => Headers
    const headers = new Headers()
    const out = fn({ headers })
    expect(userFn).toHaveBeenCalledTimes(1)
    expect(out.get('X-User')).toBe('set')
  })

  test('non-override: leaves user-provided upload.modifyResponseHeaders intact', () => {
    const userFn = ({ headers }: { headers: Headers }) => headers
    const upload = runPlugin(
      {
        collections: { media: true },
        generateFilename: uuidFilename,
        responseHeaders: 'immutable',
      },
      { modifyResponseHeaders: userFn },
    )
    expect(upload.modifyResponseHeaders).toBe(userFn)
  })
})
