import { PROVIDERS } from '../providers/registry.js'
import { getProviderToken } from '../tokens.js'

const STUB_URL_RE = /\*\*Document URL:\*\*\s*(\S+)/

export function extractStubUrl(content) {
  const match = content.match(STUB_URL_RE)
  return match ? match[1] : null
}

export async function fetchDocContent(stubContent, appConfig = {}) {
  const url = extractStubUrl(stubContent)
  if (!url) return { content: stubContent, fetched: false, warning: null }

  const entry = Object.entries(PROVIDERS).find(([, def]) => def.urlPattern.test(url))
  if (!entry) return { content: stubContent, fetched: false, warning: `no provider matched URL: ${url}` }

  const [providerId, def] = entry
  const tokenData = getProviderToken(providerId)
  if (!tokenData) {
    return {
      content: stubContent,
      fetched: false,
      warning: `not authenticated with ${providerId} — using stub content`,
    }
  }

  try {
    const providerAppConfig = appConfig[def.configKey] ?? {}
    const freshToken = def.supportsRefresh && def.refreshTokenIfNeeded
      ? await def.refreshTokenIfNeeded(tokenData, providerAppConfig)
      : tokenData

    const idResult = def.extractId(url)
    if (!idResult) {
      return { content: stubContent, fetched: false, warning: `could not extract document ID from URL: ${url}` }
    }

    const text = await def.getContent(idResult, freshToken.access_token)
    return { content: text, fetched: true, warning: null }
  } catch (err) {
    return {
      content: stubContent,
      fetched: false,
      warning: `failed to fetch document from ${providerId}: ${err.message} — using stub content`,
    }
  }
}
