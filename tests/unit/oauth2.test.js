// tests/unit/oauth2.test.js
import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { generatePKCE } from '../../src/lib/auth/oauth2.js'

describe('generatePKCE', () => {
  it('generates base64url verifier between 43 and 128 chars', () => {
    const { verifier } = generatePKCE()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('generates S256 challenge matching the verifier', () => {
    const { verifier, challenge } = generatePKCE()
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
  })

  it('generates unique verifier each call', () => {
    const a = generatePKCE()
    const b = generatePKCE()
    expect(a.verifier).not.toBe(b.verifier)
  })
})
