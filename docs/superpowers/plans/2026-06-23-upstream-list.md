# upstream list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upstream list` — a command that shows all active feature branches with their PRD/ADR coverage and any orphaned docs in `docs_path`.

**Architecture:** Extract shared doc-scanning logic from `src/commands/status.js` into `src/lib/docs.js`, then build `src/commands/list.js` on top of those helpers. `status.js` is updated to import from `docs.js` so behaviour is unchanged. `bin/upstream.js` gets the new `list` sub-command.

**Tech Stack:** Node.js ESM, commander, chalk, vitest, git CLI via `execFileSync`.

---

## File map

| Action | Path | Responsibility |
|--------|------|----------------|
| New | `src/lib/docs.js` | `getSlug`, `scanDocs`, `classifyFile`, `adrRequired` |
| Modify | `src/commands/status.js` | Remove local helpers, import from `docs.js` |
| New | `src/commands/list.js` | `listCommand` — branches × docs + orphans |
| Modify | `bin/upstream.js` | Register `list` sub-command |
| New | `tests/unit/docs.test.js` | Unit tests for all four helpers |
| New | `tests/integration/list.test.js` | Integration tests for `upstream list` |

---

## Task 1: Extract shared helpers into `src/lib/docs.js`

**Files:**
- Create: `src/lib/docs.js`
- Modify: `src/commands/status.js`

- [ ] **Step 1: Create `src/lib/docs.js` with the four helpers**

```js
// src/lib/docs.js
import { readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'

export function getSlug(branch) {
  const idx = branch.indexOf('/')
  return idx === -1 ? branch : branch.slice(idx + 1)
}

export function scanDocs(docsPath, branch, slug) {
  const files = readdirSync(docsPath).filter(f => f.endsWith('.md'))
  return files.filter(f => {
    if (basename(f).toLowerCase().includes(slug.toLowerCase())) return true
    try { return readFileSync(join(docsPath, f), 'utf8').includes(branch) } catch { return false }
  })
}

export function classifyFile(filePath) {
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

/**
 * Returns true if any adrTrigger keyword appears in the PRD file content.
 * adrTriggers is an array of strings from upstream.config.yaml.
 */
export function adrRequired(prdFilePath, adrTriggers) {
  try {
    const content = readFileSync(prdFilePath, 'utf8').toLowerCase()
    return adrTriggers.some(t => content.includes(t.toLowerCase().replace(/_/g, ' ')) ||
                                  content.includes(t.toLowerCase()))
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Update `src/commands/status.js` to import from `docs.js`**

Replace the three local function definitions (`getSlug`, `scanDocs`, `classifyFile`) with a single import. The rest of `statusCommand` is unchanged.

```js
// src/commands/status.js  — top of file, replace local definitions with:
import { getSlug, scanDocs, classifyFile } from '../lib/docs.js'
```

Remove lines 11–34 of the current file (the three local function definitions). Everything else stays identical.

- [ ] **Step 3: Run existing status tests to confirm nothing broke**

```bash
npm test -- tests/integration/status.test.js
```

Expected: all 9 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/docs.js src/commands/status.js
git commit -m "refactor(docs): extract shared doc helpers into src/lib/docs.js"
```

---

## Task 2: Unit-test `src/lib/docs.js`

**Files:**
- Create: `tests/unit/docs.test.js`

- [ ] **Step 1: Write the unit tests**

```js
// tests/unit/docs.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getSlug, scanDocs, classifyFile, adrRequired } from '../../src/lib/docs.js'

describe('getSlug', () => {
  it('strips prefix from feat/my-feature', () => {
    expect(getSlug('feat/my-feature')).toBe('my-feature')
  })

  it('strips prefix from fix/short', () => {
    expect(getSlug('fix/short')).toBe('short')
  })

  it('returns the whole string when no slash', () => {
    expect(getSlug('main')).toBe('main')
  })

  it('strips only the first prefix segment', () => {
    expect(getSlug('feat/payments/v2')).toBe('payments/v2')
  })
})

describe('classifyFile', () => {
  let dir

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'upstream-docs-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('returns prd for filename containing PRD', () => {
    const f = join(dir, 'PRD-auth.md')
    writeFileSync(f, '# some content')
    expect(classifyFile(f)).toBe('prd')
  })

  it('returns adr for filename containing ADR', () => {
    const f = join(dir, 'ADR-001-db.md')
    writeFileSync(f, '# some content')
    expect(classifyFile(f)).toBe('adr')
  })

  it('falls back to heading when filename is generic', () => {
    const f = join(dir, 'document.md')
    writeFileSync(f, '# PRD: New Feature\n\nsome content')
    expect(classifyFile(f)).toBe('prd')
  })

  it('returns null when neither filename nor heading matches', () => {
    const f = join(dir, 'notes.md')
    writeFileSync(f, '# Meeting notes\n\nsome content')
    expect(classifyFile(f)).toBe(null)
  })
})

describe('scanDocs', () => {
  let dir

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'upstream-docs-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('matches file by slug in filename', () => {
    writeFileSync(join(dir, 'PRD-payments.md'), '# PRD')
    const result = scanDocs(dir, 'feat/payments', 'payments')
    expect(result).toContain('PRD-payments.md')
  })

  it('matches file by branch name in content', () => {
    writeFileSync(join(dir, 'PRD-something.md'), 'Branch: feat/payments\n# PRD')
    const result = scanDocs(dir, 'feat/payments', 'payments')
    expect(result).toContain('PRD-something.md')
  })

  it('does not match unrelated files', () => {
    writeFileSync(join(dir, 'PRD-auth.md'), '# PRD for auth')
    const result = scanDocs(dir, 'feat/payments', 'payments')
    expect(result).not.toContain('PRD-auth.md')
  })

  it('ignores non-md files', () => {
    writeFileSync(join(dir, 'payments.txt'), 'payments')
    const result = scanDocs(dir, 'feat/payments', 'payments')
    expect(result).toHaveLength(0)
  })
})

describe('adrRequired', () => {
  let dir

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'upstream-docs-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const TRIGGERS = ['new_external_dependency', 'database_schema_change', 'api_breaking_change']

  it('returns true when trigger keyword appears in PRD content', () => {
    const f = join(dir, 'PRD-payments.md')
    writeFileSync(f, '# PRD\n\nThis adds a new_external_dependency for Stripe.')
    expect(adrRequired(f, TRIGGERS)).toBe(true)
  })

  it('returns true when trigger appears with spaces instead of underscores', () => {
    const f = join(dir, 'PRD-payments.md')
    writeFileSync(f, '# PRD\n\nThis introduces a database schema change.')
    expect(adrRequired(f, TRIGGERS)).toBe(true)
  })

  it('returns false when no trigger keyword appears', () => {
    const f = join(dir, 'PRD-ui.md')
    writeFileSync(f, '# PRD\n\nThis changes button colours.')
    expect(adrRequired(f, TRIGGERS)).toBe(false)
  })

  it('returns false when file does not exist', () => {
    expect(adrRequired(join(dir, 'missing.md'), TRIGGERS)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
npm test -- tests/unit/docs.test.js
```

Expected: 14 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/docs.test.js
git commit -m "test(docs): add unit tests for shared doc helpers"
```

---

## Task 3: Implement `src/commands/list.js`

**Files:**
- Create: `src/commands/list.js`

- [ ] **Step 1: Write the integration test first (TDD)**

```js
// tests/integration/list.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo

beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream list', () => {
  it('exits 0 with no feature branches', () => {
    // default branch (main/master) is a bypass or non-feature branch
    const { exitCode } = runCLI('list', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('shows feature branch with missing PRD', () => {
    repo.git('checkout', '-b', 'feat/search')
    repo.git('checkout', '-')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toContain('feat/search')
    expect(stdout).toMatch(/missing|✗/)
  })

  it('shows ✅ PRD when doc matched by filename', () => {
    repo.git('checkout', '-b', 'feat/search')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-search.md'), '# PRD: Search\n\nsome content')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toContain('PRD-search.md')
  })

  it('shows ADR as required+missing when trigger in PRD', () => {
    repo.git('checkout', '-b', 'feat/payments')
    repo.git('checkout', '-')
    writeFileSync(
      join(repo.dir, 'docs/upstream/PRD-payments.md'),
      '# PRD: Payments\n\nThis adds a new_external_dependency for Stripe.'
    )
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toMatch(/required.*missing|⚠/)
  })

  it('shows ADR as — when PRD has no triggers', () => {
    repo.git('checkout', '-b', 'feat/ui-refresh')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-ui-refresh.md'), '# PRD: UI Refresh\n\nChanges button colours.')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toContain('—')
  })

  it('shows ✅ ADR when both PRD and ADR present', () => {
    repo.git('checkout', '-b', 'feat/auth')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-auth.md'), '# PRD: Auth\n\nauth_change involved.')
    writeFileSync(join(repo.dir, 'docs/upstream/ADR-auth.md'), '# ADR-001: Auth')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toContain('ADR-auth.md')
  })

  it('shows orphaned doc in Unlinked section', () => {
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-old-feature.md'), '# PRD: Old Feature\n')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toMatch(/[Uu]nlinked|orphan/i)
    expect(stdout).toContain('PRD-old-feature.md')
  })

  it('--format json returns valid JSON with expected shape', () => {
    const { stdout, exitCode } = runCLI('list --format json', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('branches')
    expect(parsed).toHaveProperty('unlinked')
    expect(Array.isArray(parsed.branches)).toBe(true)
    expect(Array.isArray(parsed.unlinked)).toBe(true)
  })

  it('--format json branch entry has correct keys', () => {
    repo.git('checkout', '-b', 'feat/search')
    repo.git('checkout', '-')
    const { stdout } = runCLI('list --format json', { cwd: repo.dir })
    const { branches } = JSON.parse(stdout)
    const entry = branches.find(b => b.branch === 'feat/search')
    expect(entry).toBeDefined()
    expect(entry).toHaveProperty('prd')
    expect(entry).toHaveProperty('adr')
    expect(entry).toHaveProperty('adrRequired')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (command not yet implemented)**

```bash
npm test -- tests/integration/list.test.js
```

Expected: all tests FAIL — `upstream list` is an unknown command.

- [ ] **Step 3: Implement `src/commands/list.js`**

```js
// src/commands/list.js
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getSlug, scanDocs, classifyFile, adrRequired } from '../lib/docs.js'

function getLocalBranches() {
  const out = execFileSync('git', ['branch', '--format=%(refname:short)'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  return out.trim().split('\n').filter(Boolean)
}

function getCurrentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim()
}

function buildBranchEntry(branch, docsPath, configDocsPath, adrTriggers) {
  const slug = getSlug(branch)
  let matched = []
  try { matched = scanDocs(docsPath, branch, slug) } catch { /* docs_path may not exist */ }

  let prdFile = null
  let adrFile = null
  for (const f of matched) {
    const type = classifyFile(join(docsPath, f))
    if (type === 'prd' && !prdFile) prdFile = f
    if (type === 'adr' && !adrFile) adrFile = f
  }

  const prdPath = prdFile ? join(configDocsPath, prdFile) : null
  const adrPath = adrFile ? join(configDocsPath, adrFile) : null
  const required = prdFile ? adrRequired(join(docsPath, prdFile), adrTriggers) : false

  return { branch, prd: prdPath, adr: adrPath, adrRequired: required, _matched: matched }
}

function renderTable(entries, unlinked) {
  const COL = { branch: 24, prd: 30, adr: 30 }

  console.log(chalk.bold('\nActive branches'))

  if (entries.length === 0) {
    console.log('  (no feature branches found)')
  } else {
    const hdr = `  ${'branch'.padEnd(COL.branch)} ${'PRD'.padEnd(COL.prd)} ${'ADR'.padEnd(COL.adr)}`
    console.log(chalk.dim(hdr))

    for (const e of entries) {
      const prdCol = e.prd
        ? chalk.green('✅ ') + e.prd
        : chalk.red('✗  missing')

      let adrCol
      if (e.adr) {
        adrCol = chalk.green('✅ ') + e.adr
      } else if (e.adrRequired) {
        adrCol = chalk.yellow('⚠  required, missing')
      } else {
        adrCol = chalk.dim('—')
      }

      console.log(`  ${e.branch.padEnd(COL.branch)} ${prdCol.padEnd(COL.prd + 10)} ${adrCol}`)
    }
  }

  if (unlinked.length > 0) {
    console.log(chalk.bold('\nUnlinked documents'))
    for (const f of unlinked) {
      console.log(`  ${f}  ${chalk.dim('(no active branch match)')}`)
    }
  }

  console.log('')
}

export function listCommand(opts = {}, cwd = process.cwd()) {
  const configPath = join(cwd, 'upstream.config.yaml')
  if (!existsSync(configPath)) {
    console.error(chalk.red('upstream list: no upstream.config.yaml found'))
    process.exit(1)
  }

  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  let branches
  try {
    branches = getLocalBranches()
  } catch {
    console.error(chalk.red('upstream list: not a git repository'))
    process.exit(1)
  }

  // Exclude bypass branches and detached HEAD
  const featureBranches = branches.filter(b =>
    b !== 'HEAD' && !config.bypass_for.some(prefix => b.startsWith(prefix))
  )

  const entries = featureBranches.map(b =>
    buildBranchEntry(b, docsPath, config.docs_path, config.adr_triggers)
  )

  // Collect all matched filenames to find orphans
  const allMatched = new Set(entries.flatMap(e => e._matched))

  let allDocs = []
  if (existsSync(docsPath)) {
    allDocs = readdirSync(docsPath).filter(f => f.endsWith('.md'))
  }
  const unlinked = allDocs
    .filter(f => !allMatched.has(f))
    .map(f => join(config.docs_path, f))

  // Strip internal _matched before output
  const cleanEntries = entries.map(({ _matched, ...rest }) => rest)

  if (opts.format === 'json') {
    console.log(JSON.stringify({ branches: cleanEntries, unlinked }, null, 2))
    return
  }

  renderTable(cleanEntries, unlinked)
}
```

- [ ] **Step 4: Register `list` in `bin/upstream.js`**

Add the import after the `statusCommand` import line:

```js
import { listCommand } from '../src/commands/list.js'
```

Add the command registration before `program.parse()`:

```js
program
  .command('list')
  .description('Show PRD/ADR coverage for all feature branches')
  .option('--format <fmt>', 'output format: table or json', 'table')
  .action((opts) => listCommand(opts))
```

- [ ] **Step 5: Run the integration tests**

```bash
npm test -- tests/integration/list.test.js
```

Expected: all 8 tests pass.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: all tests pass (previous count + 14 unit + 8 integration = 22 new tests).

- [ ] **Step 7: Commit**

```bash
git add src/commands/list.js bin/upstream.js tests/integration/list.test.js
git commit -m "feat(list): add upstream list command with branch × doc coverage view"
```

---

## Task 4: Smoke test manually

- [ ] **Step 1: Run `upstream list` in a real repo with upstream configured**

```bash
cd /path/to/a-repo-with-upstream
node /path/to/upstream/bin/upstream.js list
```

Expected: table showing active branches and their PRD/ADR status.

- [ ] **Step 2: Run with `--format json`**

```bash
node /path/to/upstream/bin/upstream.js list --format json | jq .
```

Expected: valid JSON with `branches` array and `unlinked` array.

- [ ] **Step 3: Run `upstream list` in the upstream repo itself**

```bash
cd /Users/joaosmoura/dev/upstream
node bin/upstream.js list
```

Expected: exits cleanly (no `upstream.config.yaml` error — the upstream repo has no config, so it prints an error and exits 1, which is correct).

---

## Self-review checklist

- [x] **Spec coverage:** `upstream list` table output ✓, ADR required/missing signal ✓, unlinked docs ✓, `--format json` ✓, error handling ✓, edge cases (no feature branches, empty docs_path) ✓
- [x] **No placeholders:** all steps have complete code
- [x] **Type consistency:** `getSlug`, `scanDocs`, `classifyFile`, `adrRequired` defined in Task 1 and used by name consistently in Task 3
- [x] **`_matched` internal field** stripped before JSON output and before passing to `renderTable`
- [x] **`execFileSync` with arg array** used for git calls (no shell interpolation)
- [x] **Existing tests unaffected:** Task 1 Step 3 verifies `status.test.js` still passes after extraction
