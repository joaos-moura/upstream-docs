// src/lib/mcp/tools/validate-link.js
import { PROVIDERS } from '../../providers/registry.js'
import { getProviderToken } from '../../tokens.js'
import { readConfig } from '../../config.js'
import { join } from 'path'

export async function validateLink(url) {
  const entry = Object.entries(PROVIDERS).find(([, def]) => def.urlPattern.test(url))
  if (!entry) return { valid: true, provider: 'unknown', title: null, last_edited: null, error: null }

  const [providerId, def] = entry
  const tokenData = getProviderToken(providerId)
  if (!tokenData) return { valid: true, provider: providerId, title: null, last_edited: null, error: 'not authenticated' }

  try {
    const config = readConfig(join(process.cwd(), 'upstream.config.yaml'))
    const appConfig = config.integrations?.[def.configKey] ?? {}

    const freshToken = def.supportsRefresh && def.refreshTokenIfNeeded
      ? await def.refreshTokenIfNeeded(tokenData, appConfig)
      : tokenData

    const idResult = def.extractId(url)
    if (!idResult) return { valid: false, provider: providerId, title: null, last_edited: null, error: 'Invalid URL format' }

    const metadata = await def.getMetadata(idResult, freshToken.access_token)
    return { valid: true, provider: providerId, title: metadata.title, last_edited: metadata.last_edited, error: null }
  } catch (err) {
    return { valid: false, provider: providerId, title: null, last_edited: null, error: err.message }
  }
}
