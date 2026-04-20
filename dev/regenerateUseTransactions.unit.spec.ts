import { describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'

describe('regenerateUseTransactions', () => {
  test('defaults to false (transactions disabled) when omitted', () => {
    const resolved = resolveConfig({ collections: { media: true } })
    expect(resolved.regenerateUseTransactions).toBe(false)
  })

  test('honors explicit true', () => {
    const resolved = resolveConfig({
      collections: { media: true },
      regenerateUseTransactions: true,
    })
    expect(resolved.regenerateUseTransactions).toBe(true)
  })

  test('honors explicit false', () => {
    const resolved = resolveConfig({
      collections: { media: true },
      regenerateUseTransactions: false,
    })
    expect(resolved.regenerateUseTransactions).toBe(false)
  })
})
