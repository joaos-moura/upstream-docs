import chalk from 'chalk'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, mkdirSync } from 'fs'
import { confirm } from '@inquirer/prompts'
import { scaffoldInto } from '../lib/scaffold.js'
import { writeMcpSettings } from '../lib/settings.js'
import { runWizard, WIZARD_DEFAULTS } from '../lib/wizard.js'
import { runOAuthFlow } from '../lib/auth/oauth2.js'
import { PROVIDERS } from '../lib/providers/registry.js'
import { deleteProviderToken } from '../lib/tokens.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(__dirname, '../../templates')

function loadFromFile(filePath) {
  let raw
  try { raw = readFileSync(filePath, 'utf8') } catch {
    throw new Error(`--from: cannot read file "${filePath}"`)
  }
  try { return JSON.parse(raw) } catch {
    throw new Error(`--from: "${filePath}" is not valid JSON`)
  }
}

function ensureClientSecretEnv(target, envKey, label) {
  const COMMENT = `\n# upstream: ${label} OAuth secret (required for upstream auth)\n${envKey}=\n`
  const EXAMPLE_COMMENT = `\n# upstream: ${label} OAuth secret (required for upstream auth)\n${envKey}=your-${label.toLowerCase()}-client-secret\n`

  // Always update .env.example (committed — shows required vars without real values)
  const examplePath = join(target, '.env.example')
  const exampleContent = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : ''
  if (!exampleContent.includes(envKey)) {
    appendFileSync(examplePath, EXAMPLE_COMMENT)
    console.log(chalk.green(`✓ ${envKey} added to .env.example`))
  } else {
    console.log(chalk.green(`✓ ${envKey} already in .env.example`))
  }

  const existing = readdirSync(target).filter(f =>
    f.startsWith('.env') && !f.includes('example') && !f.includes('sample')
  )

  if (existing.length === 0) {
    for (const filename of ['.env', '.env.local', '.env.test']) {
      writeFileSync(join(target, filename), `# upstream: ${label} OAuth secret (required for upstream auth)\n${envKey}=\n`)
      console.log(chalk.green(`✓ ${filename} created with ${envKey}`))
    }
    console.log(chalk.yellow(`  Fill in the value in each file: ${envKey}=<your-secret>`))
    return
  }

  let added = false
  for (const filename of existing) {
    const envPath = join(target, filename)
    const content = readFileSync(envPath, 'utf8')
    if (content.includes(envKey)) {
      console.log(chalk.green(`✓ ${envKey} already in ${filename}`))
    } else {
      appendFileSync(envPath, COMMENT)
      console.log(chalk.green(`✓ ${envKey} added to ${filename}`))
      added = true
    }
  }
  if (added) console.log(chalk.yellow(`  Fill in the value: ${envKey}=<your-secret>`))
}

function ensureGitignore(target) {
  const GITIGNORE = join(target, '.gitignore')
  const ENTRIES = ['.env', '.env.local', '.env.test']
  const existing = existsSync(GITIGNORE) ? readFileSync(GITIGNORE, 'utf8') : ''
  const missing = ENTRIES.filter(e => !existing.split('\n').some(l => l.trim() === e))
  if (missing.length === 0) return
  const block = `\n# upstream: local secrets — never commit\n${missing.join('\n')}\n`
  appendFileSync(GITIGNORE, block)
  console.log(chalk.green(`✓ .gitignore updated (${missing.join(', ')})`))
}

function validateAnswers(answers) {
  if (!['local', 'link'].includes(answers.docs_storage)) {
    throw new Error(`docs_storage must be "local" or "link", got "${answers.docs_storage}"`)
  }
  if (answers.docs_storage === 'link') {
    for (const p of answers.providers ?? []) {
      if (!p.id || !p.client_id || !p.allowed_domain) {
        throw new Error(`Provider "${p.id ?? '?'}" must have id, client_id, and allowed_domain`)
      }
    }
  }
}

export async function initCommand(options) {
  const target = process.cwd()
  console.log(chalk.blue('upstream:'), 'initializing', target)

  let prefilled = {}
  try {
    if (options.from) {
      prefilled = loadFromFile(options.from)
    } else {
      if (options.docsStorage) prefilled.docs_storage = options.docsStorage
      if (options.guardian !== undefined) prefilled.guardian = options.guardian
      if (options.provider) {
        prefilled.providers = [{
          id: options.provider,
          client_id: options.clientId ?? '',
          allowed_domain: options.allowedDomain ?? '',
        }]
      }
      if (options.yes) {
        prefilled.docs_storage = prefilled.docs_storage ?? 'local'
        prefilled.docs_path = prefilled.docs_path ?? 'docs/upstream/'
        prefilled.providers = prefilled.providers ?? []
        prefilled.guardian = prefilled.guardian ?? ''
        prefilled.bypass_for = prefilled.bypass_for ?? WIZARD_DEFAULTS.bypass_for
        prefilled.prd_required_fields = prefilled.prd_required_fields ?? WIZARD_DEFAULTS.prd_required_fields
        prefilled.adr_triggers = prefilled.adr_triggers ?? WIZARD_DEFAULTS.adr_triggers
      }
    }

    if (options.from && prefilled.docs_storage) validateAnswers(prefilled)

    const answers = await runWizard(prefilled)
    validateAnswers(answers)

    await scaffoldInto(target, TEMPLATES, answers)
    writeMcpSettings(target)
    ensureGitignore(target)

    if (answers.providers?.some(p => p.id === 'google-docs')) {
      ensureClientSecretEnv(target, 'UPSTREAM_GOOGLE_CLIENT_SECRET', 'Google')
    }
    if (answers.providers?.some(p => p.id === 'confluence')) {
      ensureClientSecretEnv(target, 'UPSTREAM_CONFLUENCE_CLIENT_SECRET', 'Confluence')
    }

    let shouldValidate = false
    if (answers.providers?.length > 0 && process.stdin.isTTY) {
      shouldValidate = await confirm({
        message: 'Validate integration now? (opens browser to test OAuth — no credentials saved)',
        default: true,
      })
    }

    const SECRET_ENV = { 'google-docs': 'UPSTREAM_GOOGLE_CLIENT_SECRET', 'confluence': 'UPSTREAM_CONFLUENCE_CLIENT_SECRET' }

    if (shouldValidate && answers.providers?.length > 0) {
      for (const f of ['.env.local', '.env']) {
        try { process.loadEnvFile(join(target, f)) } catch { /* not found */ }
      }

      const provider = answers.providers[0]
      const providerDef = PROVIDERS[provider.id]
      const secretEnvKey = SECRET_ENV[provider.id]

      if (secretEnvKey && !process.env[secretEnvKey]) {
        console.log('')
        console.log(chalk.yellow(`⚠ Cannot validate: ${secretEnvKey} is not set in this shell.`))
        console.log(chalk.yellow(`  Fill in your .env file and run: upstream auth ${provider.id}`))
      } else {
        console.log('')
        console.log(chalk.blue('upstream:'), `validating ${provider.id} integration...`)
        try {
          await runOAuthFlow(provider.id, providerDef, { client_id: provider.client_id, allowed_domain: provider.allowed_domain })
          deleteProviderToken(provider.id)
          console.log(chalk.green(`✓ ${provider.id} integration validated`))
        } catch (err) {
          console.error(chalk.yellow(`⚠ validation failed: ${err.message}`))
          console.error(chalk.yellow(`  Fix your credentials and re-run: upstream auth ${provider.id}`))
        }
      }
    }

    console.log('')
    console.log(chalk.green('✓ upstream.config.yaml generated'))
    if (answers.guardian) console.log(chalk.green('✓ .github/CODEOWNERS updated'))
    console.log(chalk.green('✓ .claude/ scaffolded'))
    console.log(chalk.green('✓ MCP settings written'))
    console.log('')
    console.log('Next steps:')
    if (answers.guardian) {
      console.log('  1. Enable branch protection on main (required for CODEOWNERS to be enforced)')
      console.log('  2. git add . && git commit -m "feat: add upstream"')
      console.log('  3. git push')
    } else {
      console.log('  1. git add . && git commit -m "feat: add upstream"')
      console.log('  2. git push')
    }
  } catch (err) {
    console.error(chalk.red('upstream init failed:'), err.message)
    process.exit(1)
  }
}
