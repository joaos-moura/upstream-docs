import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/tokens.js', () => ({
  getProviderToken: vi.fn(),
}))

vi.mock('../../src/lib/providers/registry.js', () => ({
  PROVIDERS: {
    'google-docs': {
      configKey: 'google_docs',
      urlPattern: /docs\.google\.com\/document\/d\//,
      supportsRefresh: false,
      extractId: (url) => url.match(/\/d\/([^/]+)/)?.[1] ?? null,
      getContent: vi.fn(),
      refreshTokenIfNeeded: null,
    },
  },
}))

import { getProviderToken } from '../../src/lib/tokens.js'
import { PROVIDERS } from '../../src/lib/providers/registry.js'
import { extractStubUrl, fetchDocContent } from '../../src/lib/align/fetch-doc.js'

const STUB = `# PRD: Auth\n\n**Document URL:** https://docs.google.com/document/d/abc123/edit\n\n> stub\n`
const PLAIN_PRD = '## Problem Statement\nAuth system\n## Success Metrics\nLogin works\n'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractStubUrl', () => {
  it('extracts URL from stub content', () => {
    expect(extractStubUrl(STUB)).toBe('https://docs.google.com/document/d/abc123/edit')
  })

  it('returns null for non-stub content', () => {
    expect(extractStubUrl(PLAIN_PRD)).toBeNull()
  })
})

describe('fetchDocContent', () => {
  it('returns stub content unchanged when not a stub', async () => {
    const result = await fetchDocContent(PLAIN_PRD)
    expect(result.content).toBe(PLAIN_PRD)
    expect(result.fetched).toBe(false)
    expect(result.warning).toBeNull()
  })

  it('returns stub content with warning when not authenticated', async () => {
    getProviderToken.mockReturnValue(null)
    const result = await fetchDocContent(STUB)
    expect(result.fetched).toBe(false)
    expect(result.warning).toMatch(/not authenticated/)
    expect(result.content).toBe(STUB)
  })

  it('fetches and returns real content when authenticated', async () => {
    getProviderToken.mockReturnValue({ access_token: 'tok' })
    PROVIDERS['google-docs'].getContent.mockResolvedValue('Full document text')
    const result = await fetchDocContent(STUB)
    expect(result.fetched).toBe(true)
    expect(result.content).toBe('Full document text')
    expect(result.warning).toBeNull()
  })

  it('falls back to stub with warning on provider error', async () => {
    getProviderToken.mockReturnValue({ access_token: 'tok' })
    PROVIDERS['google-docs'].getContent.mockRejectedValue(new Error('API 403'))
    const result = await fetchDocContent(STUB)
    expect(result.fetched).toBe(false)
    expect(result.warning).toMatch(/failed to fetch/)
    expect(result.content).toBe(STUB)
  })

  it('returns warning when no provider matches URL', async () => {
    const unknownStub = STUB.replace('docs.google.com', 'notion.so')
    const result = await fetchDocContent(unknownStub)
    expect(result.fetched).toBe(false)
    expect(result.warning).toMatch(/no provider matched/)
  })
})
