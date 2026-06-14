// src/commands/auth.js
import chalk from 'chalk'
import { join } from 'path'
import { readConfig } from '../lib/config.js'
import { PROVIDERS } from '../lib/providers/registry.js'
import { runOAuthFlow } from '../lib/auth/oauth2.js'
import { getProviderToken, deleteProviderToken } from '../lib/tokens.js'

export async function authLogoutCommand(provider) {
  if (provider === 'all') {
    for (const id of Object.keys(PROVIDERS)) deleteProviderToken(id)
    console.log(chalk.green('✓ All provider tokens removed.'))
    return
  }
  if (!PROVIDERS[provider]) {
    console.error(chalk.red(`Unknown provider: ${provider}`))
    console.error(`Known providers: ${Object.keys(PROVIDERS).join(', ')}, all`)
    process.exit(1)
  }
  deleteProviderToken(provider)
  console.log(chalk.green(`✓ ${provider} token removed.`))
}

export async function authCommand(provider) {
  if (provider === 'status') return statusCommand()

  const providerDef = PROVIDERS[provider]
  if (!providerDef) {
    console.error(chalk.red(`Unknown provider: ${provider}`))
    console.error(`Known providers: ${Object.keys(PROVIDERS).join(', ')}`)
    process.exit(1)
  }

  const config = readConfig(join(process.cwd(), 'upstream.config.yaml'))
  const appConfig = config.integrations?.[providerDef.configKey] ?? {}

  if (provider === 'google-docs' && !process.env.UPSTREAM_GOOGLE_CLIENT_SECRET) {
    console.error(chalk.red('upstream auth: UPSTREAM_GOOGLE_CLIENT_SECRET env var is not set.'))
    console.error('')
    console.error('Set it in your shell or project startup script:')
    console.error('  export UPSTREAM_GOOGLE_CLIENT_SECRET="your-secret"')
    process.exit(1)
  }

  if (provider === 'confluence' && !process.env.UPSTREAM_CONFLUENCE_CLIENT_SECRET) {
    console.error(chalk.red('upstream auth: UPSTREAM_CONFLUENCE_CLIENT_SECRET env var is not set.'))
    console.error('')
    console.error('Set it in your shell or project startup script:')
    console.error('  export UPSTREAM_CONFLUENCE_CLIENT_SECRET="your-secret"')
    process.exit(1)
  }

  if (!appConfig.client_id) {
    console.error(chalk.red(`upstream auth: ${provider} credentials not configured.`))
    console.error('')
    console.error('Add to upstream.config.yaml:')
    console.error('  integrations:')
    console.error(`    ${providerDef.configKey}:`)
    console.error('      client_id: "..."')
    console.error(`      ${providerDef.domainField}: "..."`)
    process.exit(1)
  }

  try {
    await runOAuthFlow(provider, providerDef, appConfig)
    console.log(chalk.green(`✓ ${provider} connected.`))
  } catch (err) {
    console.error(chalk.red('upstream auth failed:'), err.message)
    process.exit(1)
  }
}

async function statusCommand() {
  console.log('')
  for (const [providerId] of Object.entries(PROVIDERS)) {
    const token = getProviderToken(providerId)
    if (!token) {
      console.log(`  ${providerId.padEnd(14)} ${chalk.red('✗')} not authenticated`)
    } else if (token.expiry) {
      const expires = new Date(token.expiry).toISOString().slice(0, 10)
      console.log(`  ${providerId.padEnd(14)} ${chalk.green('✓')} authenticated (expires ${expires})`)
    } else {
      console.log(`  ${providerId.padEnd(14)} ${chalk.green('✓')} authenticated`)
    }
  }
  console.log('')
}
