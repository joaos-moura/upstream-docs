import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/tokens.js', () => ({
  getProviderToken: vi.fn(),
}))

vi.mock('../../src/lib/config.js', () => ({
  readConfig: vi.fn(() => ({
    integrations: {
      confluence: { client_id: 'ccid', client_secret: 'ccsec', allowed_domain: 'acme.atlassian.net' },
    },
  })),
}))

vi.mock('../../src/lib/providers/google-docs.js', () => ({
  extractId: vi.fn(), exchangeCode: vi.fn(), getIdentity: vi.fn(),
  getMetadata: vi.fn(), validateDomain: vi.fn(), refreshTokenIfNeeded: vi.fn(),
  createDocument: vi.fn(),
}))

vi.mock('../../src/lib/providers/confluence.js', () => ({
  extractId: vi.fn(), exchangeCode: vi.fn(), getIdentity: vi.fn(), validateDomain: vi.fn(),
  enrichToken: vi.fn(), getMetadata: vi.fn(), refreshTokenIfNeeded: vi.fn(), createDocument: vi.fn(),
}))

import { getProviderToken } from '../../src/lib/tokens.js'
import { createDocument as confluenceCreateDocument, refreshTokenIfNeeded as confluenceRefresh } from '../../src/lib/providers/confluence.js'
import { createDocument } from '../../src/lib/mcp/tools/create-document.js'

beforeEach(() => vi.clearAllMocks())

describe('createDocument', () => {
  it('throws for unknown provider', async () => {
    await expect(createDocument({ provider: 'foobar', title: 'T', content: '', destination: 'dest' }))
      .rejects.toThrow(/Unknown provider: foobar/)
  })

  it('throws when not authenticated', async () => {
    getProviderToken.mockReturnValue(null)
    await expect(createDocument({ provider: 'confluence', title: 'T', content: '', destination: 'dest' }))
      .rejects.toThrow(/Not authenticated with confluence/)
  })

  it('calls provider createDocument and returns url', async () => {
    const token = { access_token: 'tok', refresh_token: null, expiry: null }
    getProviderToken.mockReturnValue(token)
    confluenceRefresh.mockResolvedValue(token)
    confluenceCreateDocument.mockResolvedValue({ url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/123' })

    const result = await createDocument({ provider: 'confluence', title: 'My ADR', content: 'content', destination: 'ENG' })
    expect(result).toEqual({ url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/123' })
    expect(confluenceCreateDocument).toHaveBeenCalledWith('My ADR', 'content', 'ENG', token)
  })

  it('wraps provider errors with context', async () => {
    const token = { access_token: 'tok', refresh_token: null, expiry: null }
    getProviderToken.mockReturnValue(token)
    confluenceRefresh.mockResolvedValue(token)
    confluenceCreateDocument.mockRejectedValue(new Error('API rate limit exceeded'))

    await expect(createDocument({ provider: 'confluence', title: 'T', content: '', destination: 'dest' }))
      .rejects.toThrow(/create_document failed \(confluence\): API rate limit exceeded/)
  })
})
