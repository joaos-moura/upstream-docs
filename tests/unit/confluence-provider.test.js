// tests/unit/confluence-provider.test.js
import { describe, it, expect } from 'vitest'
import { extractId, validateDomain, enrichToken } from '../../src/lib/providers/confluence.js'

describe('extractId', () => {
  it('extracts page ID from standard /pages/ URL', () => {
    const result = extractId('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/My-Page')
    expect(result).toEqual({ id: '12345', baseUrl: 'https://acme.atlassian.net' })
  })

  it('extracts page ID from ?pageId= query param', () => {
    const result = extractId('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=67890')
    expect(result).toEqual({ id: '67890', baseUrl: 'https://acme.atlassian.net' })
  })

  it('returns null for URL without a numeric page ID', () => {
    expect(extractId('https://acme.atlassian.net/wiki/spaces/ENG/overview')).toBeNull()
  })

  it('returns null for non-Confluence URL', () => {
    expect(extractId('https://notion.so/My-Page-abc123')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(extractId(null)).toBeNull()
  })
})

describe('validateDomain', () => {
  it('returns true when a site URL includes allowed_domain', () => {
    const identity = { sites: [{ url: 'https://acme.atlassian.net', name: 'Acme', id: 's1' }] }
    expect(validateDomain(identity, { allowed_domain: 'acme.atlassian.net' })).toBe(true)
  })

  it('returns false when no site matches', () => {
    const identity = { sites: [{ url: 'https://other.atlassian.net', name: 'Other', id: 's2' }] }
    expect(validateDomain(identity, { allowed_domain: 'acme.atlassian.net' })).toBe(false)
  })

  it('returns false when allowed_domain is not configured', () => {
    const identity = { sites: [{ url: 'https://acme.atlassian.net', name: 'Acme', id: 's1' }] }
    expect(validateDomain(identity, {})).toBe(false)
  })

  it('returns false when identity is null', () => {
    expect(validateDomain(null, { allowed_domain: 'acme.atlassian.net' })).toBe(false)
  })
})

describe('enrichToken', () => {
  it('adds base_url of the matching site to token data', () => {
    const identity = { sites: [{ url: 'https://acme.atlassian.net', name: 'Acme', id: 's1' }] }
    const tokenData = { access_token: 'tok', refresh_token: 'rtok', expiry: 9999 }
    const result = enrichToken(tokenData, identity, { allowed_domain: 'acme.atlassian.net' })
    expect(result).toEqual({ ...tokenData, base_url: 'https://acme.atlassian.net' })
  })

  it('sets base_url to null when no site matches', () => {
    const identity = { sites: [] }
    const tokenData = { access_token: 'tok', refresh_token: 'rtok', expiry: 9999 }
    const result = enrichToken(tokenData, identity, { allowed_domain: 'acme.atlassian.net' })
    expect(result.base_url).toBeNull()
  })
})
