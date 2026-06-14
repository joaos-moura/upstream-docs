import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import yaml from 'js-yaml'
import { GENERATED_FILES, scaffoldInto } from '../lib/scaffold.js'
import { writeMcpSettings } from '../lib/settings.js'
import { readConfig } from '../lib/config.js'
import { PROVIDERS } from '../lib/providers/registry.js'
import { getProviderToken } from '../lib/tokens.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(__dirname, '../../templates')

const SKILL_FILES = GENERATED_FILES.filter(f => f.includes('/skills/'))
const TEMPLATE_FILES = GENERATED_FILES.filter(f => f.includes('/templates/'))
const HOOK_FILE = GENERATED_FILES.find(f => f.includes('/hooks/'))

function checkConfig(cwd) {
  const p = join(cwd, 'upstream.config.yaml')
  if (!existsSync(p)) return { ok: false, message: 'upstream.config.yaml — not found' }
  try {
    const parsed = yaml.load(readFileSync(p, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ok: false, message: 'upstream.config.yaml — invalid structure' }
    return { ok: true, message: 'upstream.config.yaml — valid' }
  } catch (e) {
    return { ok: false, message: `upstream.config.yaml — ${e.message}` }
  }
}

function checkHook(cwd) {
  const p = join(cwd, HOOK_FILE)
  if (!existsSync(p)) return { ok: false, message: `${HOOK_FILE} — not found` }
  if (!(statSync(p).mode & 0o111)) return { ok: false, message: `${HOOK_FILE} — not executable` }
  return { ok: true, message: `${HOOK_FILE} — executable` }
}

function checkMcp(cwd) {
  const p = join(cwd, '.claude', 'settings.json')
  if (!existsSync(p)) return { ok: false, message: '.claude/settings.json — not found' }
  let s
  try { s = JSON.parse(readFileSync(p, 'utf8')) } catch {
    return { ok: false, message: '.claude/settings.json — invalid JSON' }
  }
  const e = s?.mcpServers?.upstream
  if (!e || e.command !== 'npx' || JSON.stringify(e.args) !== JSON.stringify(['upstream', 'mcp']))
    return { ok: false, message: '.claude/settings.json — upstream server not registered' }
  return { ok: true, message: '.claude/settings.json — upstream server registered' }
}

function checkSkills(cwd) {
  const present = SKILL_FILES.filter(f => existsSync(join(cwd, f))).length
  const total = SKILL_FILES.length
  if (present < total) return { ok: false, message: `skills — ${present}/${total} present` }
  return { ok: true, message: `skills — ${total}/${total} present` }
}

function checkTemplates(cwd) {
  const present = TEMPLATE_FILES.filter(f => existsSync(join(cwd, f))).length
  const total = TEMPLATE_FILES.length
  if (present < total) return { ok: false, message: `templates — ${present}/${total} present` }
  return { ok: true, message: `templates — ${total}/${total} present` }
}

function checkAuth(cwd) {
  const config = readConfig(join(cwd, 'upstream.config.yaml'))
  if (!config.integrations || Object.keys(config.integrations).length === 0) return []
  return Object.entries(PROVIDERS)
    .filter(([, def]) => config.integrations[def.configKey])
    .map(([id]) => {
      const token = getProviderToken(id)
      return token
        ? { ok: true, warn: false, message: `auth: ${id} — authenticated` }
        : { ok: true, warn: true, message: `auth: ${id} — token not found (run: upstream auth ${id})` }
    })
}

function print(label, result) {
  const icon = result.warn ? chalk.yellow('⚠️ ') : result.ok ? chalk.green('✅') : chalk.red('❌')
  console.log(`  ${icon}  ${label.padEnd(12)} ${result.message}`)
}

export async function doctorCommand(opts = {}, cwd = process.cwd()) {
  console.log(chalk.bold('upstream doctor\n'))

  const structuralChecks = [
    { label: 'config', result: checkConfig(cwd) },
    { label: 'hook', result: checkHook(cwd) },
    { label: 'mcp', result: checkMcp(cwd) },
    { label: 'skills', result: checkSkills(cwd) },
    { label: 'templates', result: checkTemplates(cwd) },
  ]
  const authChecks = checkAuth(cwd).map(r => ({ label: 'auth', result: r }))
  const all = [...structuralChecks, ...authChecks]

  for (const { label, result } of all) print(label, result)

  const errors = structuralChecks.filter(({ result }) => !result.ok).length
  const warnings = authChecks.filter(({ result }) => result.warn).length

  if (errors === 0 && warnings === 0) {
    console.log(chalk.green('\nAll checks passed.'))
    return
  }

  console.log('')
  if (errors > 0) {
    if (opts.fix) {
      console.log(chalk.blue('Fixing...\n'))
      try {
        await scaffoldInto(cwd, TEMPLATES)
        writeMcpSettings(cwd)
      } catch (err) {
        console.error(chalk.red('upstream doctor --fix failed:'), err.message)
        process.exit(1)
      }
      console.log(chalk.blue('\nRe-checking...\n'))
      return doctorCommand({}, cwd)
    }
    console.log(chalk.red(`${errors} error(s) found. Run: upstream doctor --fix`))
    process.exit(1)
  }

  if (warnings > 0) console.log(chalk.yellow(`${warnings} warning(s) — manual action needed.`))
}
