// src/lib/mcp/tools/create-document.js
import { PROVIDERS } from '../../providers/registry.js'
import { getProviderToken } from '../../tokens.js'
import { readConfig } from '../../config.js'
import { join } from 'path'

export async function createDocument({ provider, title, content, destination }) {
  const def = PROVIDERS[provider]
  if (!def) throw new Error(`Unknown provider: ${provider}. Known: ${Object.keys(PROVIDERS).join(', ')}`)

  const tokenData = getProviderToken(provider)
  if (!tokenData) throw new Error(`Not authenticated with ${provider}. Run: upstream auth ${provider}`)

  const config = readConfig(join(process.cwd(), 'upstream.config.yaml'))
  const appConfig = config.integrations?.[def.configKey] ?? {}

  try {
    const freshToken = def.supportsRefresh && def.refreshTokenIfNeeded
      ? await def.refreshTokenIfNeeded(tokenData, appConfig)
      : tokenData

    return await def.createDocument(title, content, destination, freshToken)
  } catch (err) {
    throw new Error(`create_document failed (${provider}): ${err.message}`)
  }
}
