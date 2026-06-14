// tests/unit/google-docs-provider.test.js
import { describe, it, expect } from 'vitest'
import { extractId, validateDomain } from '../../src/lib/providers/google-docs.js'
import { exchangeCode } from '../../src/lib/providers/google-docs.js'

describe('extractId', () => {
  it('extracts ID from standard Google Docs URL', () => {
    const url = 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit'
    expect(extractId(url)).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms')
  })

  it('extracts ID from URL without trailing path', () => {
    const url = 'https://docs.google.com/document/d/abc123def456'
    expect(extractId(url)).toBe('abc123def456')
  })

  it('extracts ID with underscores and hyphens', () => {
    const url = 'https://docs.google.com/document/d/1a-b_C2/edit?usp=sharing'
    expect(extractId(url)).toBe('1a-b_C2')
  })

  it('returns null for non-Google Docs URL', () => {
    expect(extractId('https://notion.so/some-page')).toBeNull()
  })

  it('returns null for malformed URL', () => {
    expect(extractId('not a url')).toBeNull()
  })

  it('returns null for Google Docs URL without document ID', () => {
    expect(extractId('https://docs.google.com/document/')).toBeNull()
  })
})

describe('validateDomain', () => {
  it('returns true when email matches allowed_domain', () => {
    expect(validateDomain({ email: 'dev@acme.com' }, { allowed_domain: 'acme.com' })).toBe(true)
  })

  it('returns false when email does not match allowed_domain', () => {
    expect(validateDomain({ email: 'dev@other.com' }, { allowed_domain: 'acme.com' })).toBe(false)
  })

  it('returns false when allowed_domain is not configured', () => {
    expect(validateDomain({ email: 'dev@acme.com' }, {})).toBe(false)
  })

  it('returns false when email is missing', () => {
    expect(validateDomain({}, { allowed_domain: 'acme.com' })).toBe(false)
  })
})

describe('exchangeCode', () => {
  it('is a function accepting 4 params (client_secret via env var)', () => {
    expect(typeof exchangeCode).toBe('function')
    expect(exchangeCode.length).toBe(4)
  })
})
