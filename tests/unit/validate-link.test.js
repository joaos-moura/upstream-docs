// tests/unit/validate-link.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/tokens.js', () => ({
  getProviderToken: vi.fn(),
}))

vi.mock('../../src/lib/config.js', () => ({
  readConfig: vi.fn(() => ({
    integrations: {
      google_docs: { client_id: 'cid', client_secret: 'csec', allowed_domain: 'acme.com' },
      confluence: { client_id: 'ccid', client_secret: 'ccsec', allowed_domain: 'acme.atlassian.net' },
    },
  })),
}))

vi.mock('../../src/lib/providers/google-docs.js', () => ({
  extractId: vi.fn(),
  getMetadata: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
  exchangeCode: vi.fn(),
  getIdentity: vi.fn(),
  validateDomain: vi.fn(),
  createDocument: vi.fn(),
}))

vi.mock('../../src/lib/providers/confluence.js', () => ({
  extractId: vi.fn(),
  getMetadata: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
  exchangeCode: vi.fn(),
  getIdentity: vi.fn(),
  validateDomain: vi.fn(),
  enrichToken: vi.fn(),
  createDocument: vi.fn(),
}))

import { getProviderToken } from '../../src/lib/tokens.js'
import { extractId as googleExtractId, getMetadata as googleGetMetadata, refreshTokenIfNeeded as googleRefresh } from '../../src/lib/providers/google-docs.js'
import { extractId as confluenceExtractId, getMetadata as confluenceGetMetadata, refreshTokenIfNeeded as confluenceRefresh } from '../../src/lib/providers/confluence.js'
import { validateLink } from '../../src/lib/mcp/tools/validate-link.js'

beforeEach(() => vi.clearAllMocks())

describe('validateLink — unknown URL', () => {
  it('returns unknown provider for unrecognized URL', async () => {
    const result = await validateLink('https://example.com/doc')
    expect(result).toEqual({ valid: true, title: null, provider: 'unknown', last_edited: null, error: null })
  })
})

describe('validateLink — Google Docs', () => {
  it('returns not-authenticated when no token', async () => {
    getProviderToken.mockReturnValue(null)
    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result.provider).toBe('google-docs')
    expect(result.error).toBe('not authenticated')
    expect(result.valid).toBe(true)
  })

  it('returns title and last_edited when authenticated', async () => {
    const token = { access_token: 'tok', refresh_token: 'rtok', expiry: 9999999999999 }
    getProviderToken.mockReturnValue(token)
    googleRefresh.mockResolvedValue(token)
    googleExtractId.mockReturnValue('doc123')
    googleGetMetadata.mockResolvedValue({ title: 'My PRD', last_edited: '2026-06-11T10:00:00.000Z' })

    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result).toEqual({ valid: true, title: 'My PRD', provider: 'google-docs', last_edited: '2026-06-11T10:00:00.000Z', error: null })
  })

  it('returns valid=false on Drive API error', async () => {
    const token = { access_token: 'tok', refresh_token: 'rtok', expiry: 9999999999999 }
    getProviderToken.mockReturnValue(token)
    googleRefresh.mockResolvedValue(token)
    googleExtractId.mockReturnValue('doc123')
    googleGetMetadata.mockRejectedValue(new Error('File not found'))

    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('File not found')
  })
})

describe('validateLink — Confluence', () => {
  it('returns not-authenticated when no token', async () => {
    getProviderToken.mockReturnValue(null)
    const result = await validateLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Title')
    expect(result.provider).toBe('confluence')
    expect(result.error).toBe('not authenticated')
    expect(result.valid).toBe(true)
  })

  it('returns title and last_edited when authenticated', async () => {
    const token = { access_token: 'ctok', refresh_token: 'crtok', expiry: 9999999999999, base_url: 'https://acme.atlassian.net' }
    getProviderToken.mockReturnValue(token)
    confluenceRefresh.mockResolvedValue(token)
    confluenceExtractId.mockReturnValue({ id: '12345', baseUrl: 'https://acme.atlassian.net' })
    confluenceGetMetadata.mockResolvedValue({ title: 'ADR-0042', last_edited: '2026-06-09T14:00:00.000Z' })

    const result = await validateLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/ADR-0042')
    expect(result).toEqual({ valid: true, title: 'ADR-0042', provider: 'confluence', last_edited: '2026-06-09T14:00:00.000Z', error: null })
  })
})
