# upstream doctor + upstream status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upstream doctor` (installation health check with `--fix`) and `upstream status` (PRD/ADR state for current branch) as two independent read-only CLI commands.

**Architecture:** Two new command files (`src/commands/doctor.js`, `src/commands/status.js`), each tested via integration tests that call the CLI as a subprocess (matching the existing `tests/integration/upgrade.test.js` pattern). Both registered in `bin/upstream.js`. No shared library — the two commands have no overlapping logic.

**Tech Stack:** Node.js 18+ ESM, chalk, commander, js-yaml, vitest, existing lib: `readConfig`, `GENERATED_FILES`, `scaffoldInto`, `writeMcpSettings`, `PROVIDERS`, `getProviderToken`

---

## File Map

| Action | File |
| --- | --- |
| Create | `src/commands/doctor.js` |
| Create | `src/commands/status.js` |
| Create | `tests/integration/doctor.test.js` |
| Create | `tests/integration/status.test.js` |
| Modify | `bin/upstream.js` — register doctor + status, fix hardcoded version |

---

## Task 1: `upstream doctor`

**Files:**
- Create: `src/commands/doctor.js`
- Create: `tests/integration/doctor.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/doctor.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-doctor-test'
const CLI = join(__dirname, '../../bin/upstream.js')

beforeEach(() => {
  mkdirSync(TARGET, { recursive: true })
  execSync('git init -q', { cwd: TARGET })
  execSync(`node ${CLI} init --yes`, { cwd: TARGET })
})
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream doctor', () => {
  it('exits 0 when all checks pass', () => {
    expect(() => execSync(`node ${CLI} doctor`, { cwd: TARGET })).not.toThrow()
  })

  it('shows all checks as passing in output', () => {
    const out = execSync(`node ${CLI} doctor`, { cwd: TARGET }).toString()
    expect(out).toContain('config')
    expect(out).toContain('hook')
    expect(out).toContain('mcp')
    expect(out).toContain('skills')
    expect(out).toContain('templates')
  })

  it('exits 1 when hook is missing', () => {
    unlinkSync(join(TARGET, '.claude/hooks/upstream-check.sh'))
    expect(() => execSync(`node ${CLI} doctor`, { cwd: TARGET, stdio: 'pipe' })).toThrow()
  })

  it('reports missing hook in output', () => {
    unlinkSync(join(TARGET, '.claude/hooks/upstream-check.sh'))
    let output = ''
    try {
      execSync(`node ${CLI} doctor`, { cwd: TARGET, stdio: 'pipe' })
    } catch (err) {
      output = err.stdout?.toString() ?? ''
    }
    expect(output).toMatch(/hook/)
  })

  it('exits 1 when MCP not registered', () => {
    const settingsPath = join(TARGET, '.claude/settings.json')
    writeFileSync(settingsPath, JSON.stringify({ mcpServers: {} }))
    expect(() => execSync(`node ${CLI} doctor`, { cwd: TARGET, stdio: 'pipe' })).toThrow()
  })

  it('exits 1 when a skill file is missing', () => {
    unlinkSync(join(TARGET, '.claude/plugins/upstream/skills/upstream-guard.md'))
    expect(() => execSync(`node ${CLI} doctor`, { cwd: TARGET, stdio: 'pipe' })).toThrow()
  })

  it('--fix repairs missing hook and exits 0', () => {
    unlinkSync(join(TARGET, '.claude/hooks/upstream-check.sh'))
    expect(() => execSync(`node ${CLI} doctor --fix`, { cwd: TARGET, stdio: 'pipe' })).not.toThrow()
  })

  it('--fix repairs missing MCP entry and exits 0', () => {
    const settingsPath = join(TARGET, '.claude/settings.json')
    writeFileSync(settingsPath, JSON.stringify({ mcpServers: {} }))
    expect(() => execSync(`node ${CLI} doctor --fix`, { cwd: TARGET, stdio: 'pipe' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/integration/doctor.test.js 2>&1 | tail -20
```

Expected: tests fail with "Unknown command: doctor" or similar

- [ ] **Step 3: Implement `src/commands/doctor.js`**

```js
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
        ? { ok: true, warn: false, label: 'auth', message: `auth: ${id} — authenticated` }
        : { ok: true, warn: true, label: 'auth', message: `auth: ${id} — token not found (run: upstream auth ${id})` }
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
      await scaffoldInto(cwd, TEMPLATES)
      writeMcpSettings(cwd)
      console.log(chalk.blue('\nRe-checking...\n'))
      return doctorCommand({}, cwd)
    }
    console.log(chalk.red(`${errors} error(s) found. Run: upstream doctor --fix`))
    process.exit(1)
  }

  if (warnings > 0) console.log(chalk.yellow(`${warnings} warning(s) — manual action needed.`))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/integration/doctor.test.js 2>&1 | tail -15
```

Expected:
```
Tests  8 passed (8)
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/doctor.js tests/integration/doctor.test.js
git commit -m "feat: add upstream doctor command with --fix"
```

---

## Task 2: `upstream status`

**Files:**
- Create: `src/commands/status.js`
- Create: `tests/integration/status.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/status.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-status-test'
const CLI = join(__dirname, '../../bin/upstream.js')

function git(cmd) {
  execSync(cmd, { cwd: TARGET, stdio: 'pipe' })
}

beforeEach(() => {
  mkdirSync(TARGET, { recursive: true })
  git('git init -q')
  git('git config user.email "test@test.com"')
  git('git config user.name "Test"')
  git('git commit --allow-empty -m "init"')
  execSync(`node ${CLI} init --yes`, { cwd: TARGET })
})
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream status', () => {
  it('reports bypass for fix/ branch', () => {
    git('git checkout -b fix/some-bug')
    const out = execSync(`node ${CLI} status`, { cwd: TARGET }).toString()
    expect(out).toContain('bypass')
    expect(out).toContain('fix/')
  })

  it('exits 0 for bypass branch', () => {
    git('git checkout -b fix/some-bug')
    expect(() => execSync(`node ${CLI} status`, { cwd: TARGET })).not.toThrow()
  })

  it('exits 1 for feature branch with no PRD', () => {
    git('git checkout -b feat/new-feature')
    expect(() => execSync(`node ${CLI} status`, { cwd: TARGET, stdio: 'pipe' })).toThrow()
  })

  it('shows PRD missing for feature branch with no docs', () => {
    git('git checkout -b feat/new-feature')
    let output = ''
    try {
      execSync(`node ${CLI} status`, { cwd: TARGET, stdio: 'pipe' })
    } catch (err) {
      output = err.stdout?.toString() ?? ''
    }
    expect(output).toContain('PRD')
    expect(output).toContain('not found')
  })

  it('exits 0 when PRD found by filename', () => {
    git('git checkout -b feat/new-feature')
    writeFileSync(join(TARGET, 'docs/upstream/PRD-new-feature.md'), '# PRD: New Feature\n')
    expect(() => execSync(`node ${CLI} status`, { cwd: TARGET })).not.toThrow()
  })

  it('shows PRD as found when matched by filename', () => {
    git('git checkout -b feat/new-feature')
    const prdPath = join(TARGET, 'docs/upstream/PRD-new-feature.md')
    writeFileSync(prdPath, '# PRD: New Feature\n')
    const out = execSync(`node ${CLI} status`, { cwd: TARGET }).toString()
    expect(out).toContain('PRD')
    expect(out).toContain('PRD-new-feature.md')
  })

  it('finds PRD by content scan when filename does not match', () => {
    git('git checkout -b feat/new-feature')
    writeFileSync(
      join(TARGET, 'docs/upstream/PRD-some-unrelated-name.md'),
      '# PRD: Something\n\nBranch: feat/new-feature\n'
    )
    const out = execSync(`node ${CLI} status`, { cwd: TARGET }).toString()
    expect(out).toContain('PRD')
    expect(out).not.toContain('not found')
  })

  it('shows ADR when both PRD and ADR are present', () => {
    git('git checkout -b feat/new-feature')
    writeFileSync(join(TARGET, 'docs/upstream/PRD-new-feature.md'), '# PRD: New Feature\n')
    writeFileSync(join(TARGET, 'docs/upstream/ADR-new-feature.md'), '# ADR-001: New Feature\n')
    const out = execSync(`node ${CLI} status`, { cwd: TARGET }).toString()
    expect(out).toContain('ADR')
    expect(out).toContain('ADR-new-feature.md')
  })

  it('exits 1 when not in a git repo', () => {
    const notGit = '/tmp/upstream-not-git'
    mkdirSync(notGit, { recursive: true })
    writeFileSync(join(notGit, 'upstream.config.yaml'), 'version: 1\n')
    try {
      expect(() => execSync(`node ${CLI} status`, { cwd: notGit, stdio: 'pipe' })).toThrow()
    } finally {
      rmSync(notGit, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/integration/status.test.js 2>&1 | tail -20
```

Expected: tests fail with "Unknown command: status" or similar

- [ ] **Step 3: Implement `src/commands/status.js`**

```js
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'

function getCurrentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim()
}

function getSlug(branch) {
  const idx = branch.indexOf('/')
  return idx === -1 ? branch : branch.slice(idx + 1)
}

function scanDocs(docsPath, branch, slug) {
  const files = readdirSync(docsPath).filter(f => f.endsWith('.md'))
  return files.filter(f => {
    if (basename(f).toLowerCase().includes(slug.toLowerCase())) return true
    try { return readFileSync(join(docsPath, f), 'utf8').includes(branch) } catch { return false }
  })
}

function classifyFile(filePath) {
  const name = basename(filePath).toUpperCase()
  if (name.includes('PRD')) return 'prd'
  if (name.includes('ADR')) return 'adr'
  try {
    const first = readFileSync(filePath, 'utf8').split('\n').find(l => l.startsWith('#')) ?? ''
    if (first.toUpperCase().includes('PRD')) return 'prd'
    if (first.toUpperCase().includes('ADR')) return 'adr'
  } catch {}
  return null
}

export function statusCommand(cwd = process.cwd()) {
  let branch
  try {
    branch = getCurrentBranch()
  } catch {
    console.error(chalk.red('upstream status: not a git repository'))
    process.exit(1)
  }

  const configPath = join(cwd, 'upstream.config.yaml')
  if (!existsSync(configPath)) {
    console.error(chalk.red(`upstream status: no upstream.config.yaml found in ${cwd}`))
    process.exit(1)
  }

  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  console.log(chalk.bold('upstream status\n'))
  console.log(`Branch:  ${branch}`)

  const bypassPrefix = config.bypass_for.find(p => branch.startsWith(p))
  if (bypassPrefix) {
    console.log(`Type:    bypass — upstream skipped for ${bypassPrefix} branches`)
    return
  }

  console.log('Type:    feature\n')

  if (!existsSync(docsPath)) {
    console.error(chalk.red(`upstream status: docs path not found: ${config.docs_path}`))
    process.exit(1)
  }

  const slug = getSlug(branch)
  const matched = scanDocs(docsPath, branch, slug)

  let prdFile = null
  let adrFile = null
  for (const f of matched) {
    const type = classifyFile(join(docsPath, f))
    if (type === 'prd' && !prdFile) prdFile = f
    if (type === 'adr' && !adrFile) adrFile = f
  }

  if (prdFile) {
    console.log(`PRD  ${chalk.green('✅')}  ${join(config.docs_path, prdFile)}`)
  } else {
    console.log(`PRD  ${chalk.red('❌')}  not found in ${config.docs_path}`)
  }

  if (!prdFile) {
    console.log('ADR  —   (check PRD first)')
    process.exit(1)
  } else if (adrFile) {
    console.log(`ADR  ${chalk.green('✅')}  ${join(config.docs_path, adrFile)}`)
  } else {
    console.log(`ADR  ${chalk.yellow('—')}   not found in ${config.docs_path}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they fail** (status command not yet registered in bin)

```bash
npm test -- tests/integration/status.test.js 2>&1 | tail -20
```

Expected: still fails — command not registered yet

- [ ] **Step 5: Commit the implementation file only**

```bash
git add src/commands/status.js tests/integration/status.test.js
git commit -m "feat: add upstream status command"
```

---

## Task 3: Register commands in bin + fix hardcoded version

**Files:**
- Modify: `bin/upstream.js`

- [ ] **Step 1: Update `bin/upstream.js`**

Replace the entire file content with:

```js
#!/usr/bin/env node
for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(f) } catch { /* file doesn't exist or can't be read */ }
}
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Command } from 'commander'
import { initCommand } from '../src/commands/init.js'
import { upgradeCommand } from '../src/commands/upgrade.js'
import { authCommand, authLogoutCommand } from '../src/commands/auth.js'
import { doctorCommand } from '../src/commands/doctor.js'
import { statusCommand } from '../src/commands/status.js'
import { startMcpServer } from '../src/lib/mcp/server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

const program = new Command()

program
  .name('upstream')
  .description('Claude Code plugin: enforce PRD/ADR before feature development')
  .version(version)

program
  .command('init')
  .description('Scaffold upstream into the current repo')
  .option('--from <file>', 'load answers from JSON file (non-interactive)')
  .option('--docs-storage <value>', 'docs_storage: local or link')
  .option('--provider <id>', 'provider ID: google-docs or confluence (single provider)')
  .option('--client-id <id>', 'OAuth client_id for the provider')
  .option('--allowed-domain <domain>', 'allowed domain for the provider')
  .option('--guardian <handle>', 'GitHub handle or email for CODEOWNERS')
  .option('--yes', 'skip Phase 2 (use org defaults)')
  .action(initCommand)

program
  .command('upgrade')
  .description('Regenerate skills and hook, preserve config and docs')
  .action(upgradeCommand)

program
  .command('auth <provider>')
  .description('Authenticate with a documentation provider (google-docs) or check status (status)')
  .action(authCommand)

program
  .command('logout <provider>')
  .description('Remove stored token for a provider (or "all")')
  .action(authLogoutCommand)

program
  .command('doctor')
  .description('Check upstream installation health in the current repo')
  .option('--fix', 'repair missing or misconfigured files automatically')
  .action((opts) => doctorCommand(opts))

program
  .command('status')
  .description('Show PRD/ADR state for the current git branch')
  .action(() => statusCommand())

program
  .command('mcp')
  .description('Start the upstream MCP server (called automatically by Claude Code)')
  .action(startMcpServer)

program.parse()
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected:
```
Test Files  16 passed (16)
     Tests  XX passed (XX)
```

- [ ] **Step 3: Smoke-test both commands manually**

```bash
# From the upstream repo itself (has upstream.config.yaml)
node bin/upstream.js doctor
node bin/upstream.js status
node bin/upstream.js --version
```

Expected:
- `doctor` shows all ✅ (or ⚠️ for auth if no tokens)
- `status` shows current branch and PRD/ADR state
- `--version` shows `0.3.0`

- [ ] **Step 4: Commit**

```bash
git add bin/upstream.js
git commit -m "feat: register doctor + status in CLI, read version from package.json"
```
