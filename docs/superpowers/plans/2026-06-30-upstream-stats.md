# upstream stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upstream stats` command that shows aggregate PRD/ADR coverage metrics across all feature branches.

**Architecture:** Extract shared branch-walking helpers from `list.js` into a new `src/lib/branch-stats.js`, then build `stats.js` on top of those helpers. `list.js` is refactored to import from `branch-stats.js` with zero behaviour change.

**Tech Stack:** Node.js ESM, commander, chalk, vitest (integration via `makeTmpRepo`/`runCLI` from `tests/helpers.js`)

## Global Constraints

- ESM modules (`import`/`export`) — no `require()`
- No new npm dependencies
- `bypass_for` from config filters branches (defaults: `['fix/', 'hotfix/', 'chore/', 'docs/']`)
- `adr_triggers` from config drives `adrRequired()` (defaults defined in `src/lib/config.js`)
- `SKIPS.md` lives at `<docs_path>/SKIPS.md`; skip entry format: `## Skip: [PRD|ADR] — [branch] — [YYYY-MM-DD]\n\n**Reason:** [text]`
- `skipped` = total SKIPS.md entries (not unique branches); same branch PRD+ADR = 2
- "No docs" = no PRD file, no ADR file, and no SKIPS.md entry for that branch
- ADR sub-metric: `withPrd` + `skipped` + `noDocs` = `total`; `withAdr` is a sub-count of `withPrd`
- `adrCompliance.rate` = `null` when `required === 0`; omit that line in human output
- Percentages: `Math.round(n / total * 100)` — show `—` when `total === 0`
- Test runner: `npm test` (vitest run)

---

### Task 1: Extract `src/lib/branch-stats.js` and refactor `list.js`

**Files:**
- Create: `src/lib/branch-stats.js`
- Modify: `src/commands/list.js`
- Test: `tests/unit/branch-stats.test.js`

**Interfaces:**
- Produces:
  - `getFeatureBranches(cwd: string, config: object): string[]`
  - `buildBranchEntry(branch: string, docsPath: string, configDocsPath: string, adrTriggers: string[]): { branch, prd, adr, adrRequired, _matched }`
  - `parseSkips(content: string): Array<{ type: 'prd'|'adr', branch: string, date: string, reason: string }>`
  - `computeStats(entries: object[], skipEntries: object[], allDocs: string[], allMatched: Set<string>): { branches, adrCompliance, unlinkedDocs }`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/branch-stats.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { parseSkips, computeStats } from '../../src/lib/branch-stats.js'

describe('parseSkips', () => {
  it('empty string returns empty array', () => {
    expect(parseSkips('')).toEqual([])
  })

  it('single PRD entry', () => {
    const content = '## Skip: PRD — feat/foo — 2026-06-10\n\n**Reason:** hotfix, no PRD needed\n'
    expect(parseSkips(content)).toEqual([
      { type: 'prd', branch: 'feat/foo', date: '2026-06-10', reason: 'hotfix, no PRD needed' },
    ])
  })

  it('single ADR entry', () => {
    const content = '## Skip: ADR — feat/bar — 2026-06-15\n\n**Reason:** low risk\n'
    expect(parseSkips(content)).toEqual([
      { type: 'adr', branch: 'feat/bar', date: '2026-06-15', reason: 'low risk' },
    ])
  })

  it('same branch PRD and ADR entries → count 2', () => {
    const content = [
      '## Skip: PRD — feat/foo — 2026-06-10\n\n**Reason:** reason A',
      '## Skip: ADR — feat/foo — 2026-06-10\n\n**Reason:** reason B',
    ].join('\n\n')
    const result = parseSkips(content)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('prd')
    expect(result[1].type).toBe('adr')
  })

  it('malformed entry mixed with valid → valid parsed, malformed ignored', () => {
    const content = 'Some random text\n\n## Skip: PRD — feat/ok — 2026-01-01\n\n**Reason:** valid\n'
    const result = parseSkips(content)
    expect(result).toHaveLength(1)
    expect(result[0].branch).toBe('feat/ok')
  })
})

describe('computeStats', () => {
  it('zero branches → all zeros, rate null', () => {
    const result = computeStats([], [], [], new Set())
    expect(result.branches.total).toBe(0)
    expect(result.branches.withPrd).toBe(0)
    expect(result.branches.withAdr).toBe(0)
    expect(result.branches.skipped).toBe(0)
    expect(result.branches.noDocs).toBe(0)
    expect(result.adrCompliance.rate).toBeNull()
    expect(result.unlinkedDocs).toBe(0)
  })

  it('branch with PRD only → withPrd: 1, noDocs: 0', () => {
    const entries = [
      { branch: 'feat/a', prd: 'docs/upstream/PRD-a.md', adr: null, adrRequired: false, _matched: ['PRD-a.md'] },
    ]
    const result = computeStats(entries, [], ['PRD-a.md'], new Set(['PRD-a.md']))
    expect(result.branches.withPrd).toBe(1)
    expect(result.branches.withAdr).toBe(0)
    expect(result.branches.noDocs).toBe(0)
  })

  it('branch without docs and no skip → noDocs: 1', () => {
    const entries = [
      { branch: 'feat/b', prd: null, adr: null, adrRequired: false, _matched: [] },
    ]
    const result = computeStats(entries, [], [], new Set())
    expect(result.branches.noDocs).toBe(1)
    expect(result.branches.skipped).toBe(0)
  })

  it('branch with skip entry → skipped: 1, noDocs: 0', () => {
    const entries = [
      { branch: 'feat/c', prd: null, adr: null, adrRequired: false, _matched: [] },
    ]
    const skips = [{ type: 'prd', branch: 'feat/c', date: '2026-06-01', reason: 'ok' }]
    const result = computeStats(entries, skips, [], new Set())
    expect(result.branches.skipped).toBe(1)
    expect(result.branches.noDocs).toBe(0)
  })

  it('same branch PRD+ADR skip → skipped: 2', () => {
    const entries = [
      { branch: 'feat/d', prd: null, adr: null, adrRequired: false, _matched: [] },
    ]
    const skips = [
      { type: 'prd', branch: 'feat/d', date: '2026-06-01', reason: 'a' },
      { type: 'adr', branch: 'feat/d', date: '2026-06-01', reason: 'b' },
    ]
    const result = computeStats(entries, skips, [], new Set())
    expect(result.branches.skipped).toBe(2)
    expect(result.branches.noDocs).toBe(0)
  })

  it('adrCompliance.rate null when required = 0', () => {
    const entries = [
      { branch: 'feat/a', prd: 'PRD-a.md', adr: null, adrRequired: false, _matched: ['PRD-a.md'] },
    ]
    const result = computeStats(entries, [], [], new Set())
    expect(result.adrCompliance.required).toBe(0)
    expect(result.adrCompliance.rate).toBeNull()
  })

  it('adrCompliance.rate = present/required', () => {
    const entries = [
      { branch: 'feat/a', prd: 'PRD-a.md', adr: 'ADR-a.md', adrRequired: true, _matched: ['PRD-a.md', 'ADR-a.md'] },
      { branch: 'feat/b', prd: 'PRD-b.md', adr: null, adrRequired: true, _matched: ['PRD-b.md'] },
    ]
    const result = computeStats(entries, [], [], new Set())
    expect(result.adrCompliance.required).toBe(2)
    expect(result.adrCompliance.present).toBe(1)
    expect(result.adrCompliance.rate).toBeCloseTo(0.5)
  })

  it('unlinkedDocs counts docs not in allMatched', () => {
    const result = computeStats([], [], ['PRD-old.md', 'ADR-old.md'], new Set())
    expect(result.unlinkedDocs).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- --reporter=verbose tests/unit/branch-stats.test.js
```

Expected: FAIL — `branch-stats.js` does not exist yet.

- [ ] **Step 3: Create `src/lib/branch-stats.js`**

```js
// src/lib/branch-stats.js
import { join } from 'path'
import { execFileSync } from 'child_process'
import { getSlug, scanDocs, classifyFile, adrRequired } from './docs.js'

export function getFeatureBranches(cwd, config) {
  const out = execFileSync('git', ['branch', '--format=%(refname:short)'], {
    encoding: 'utf8',
    cwd,
    stdio: 'pipe',
  })
  const branches = out.trim().split('\n').filter(Boolean)
  return branches.filter(b =>
    b !== 'HEAD' && !config.bypass_for.some(prefix => b.startsWith(prefix))
  )
}

export function buildBranchEntry(branch, docsPath, configDocsPath, adrTriggers) {
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

export function parseSkips(content) {
  const entries = []
  const blocks = content.split(/^(?=## Skip:)/m).filter(Boolean)
  for (const block of blocks) {
    const headerMatch = block.match(/^## Skip:\s*(PRD|ADR)\s*—\s*(.+?)\s*—\s*(\d{4}-\d{2}-\d{2})/i)
    if (!headerMatch) continue
    const reasonMatch = block.match(/\*\*Reason:\*\*\s*(.+)/)
    entries.push({
      type: headerMatch[1].toLowerCase(),
      branch: headerMatch[2].trim(),
      date: headerMatch[3],
      reason: reasonMatch ? reasonMatch[1].trim() : '',
    })
  }
  return entries
}

export function computeStats(entries, skipEntries, allDocs, allMatched) {
  const total = entries.length
  const skippedBranches = new Set(skipEntries.map(s => s.branch))

  let withPrd = 0
  let withAdr = 0
  let adrRequiredCount = 0
  let adrPresentCount = 0

  for (const e of entries) {
    if (e.prd) withPrd++
    if (e.adr) withAdr++
    if (e.adrRequired) {
      adrRequiredCount++
      if (e.adr) adrPresentCount++
    }
  }

  const skipped = skipEntries.length
  const noDocs = entries.filter(e => !e.prd && !e.adr && !skippedBranches.has(e.branch)).length
  const unlinkedDocs = allDocs.filter(f => !allMatched.has(f)).length

  return {
    branches: { total, withPrd, withAdr, skipped, noDocs },
    adrCompliance: {
      required: adrRequiredCount,
      present: adrPresentCount,
      rate: adrRequiredCount > 0 ? adrPresentCount / adrRequiredCount : null,
    },
    unlinkedDocs,
  }
}
```

- [ ] **Step 4: Run unit tests — verify they pass**

```bash
npm test -- --reporter=verbose tests/unit/branch-stats.test.js
```

Expected: all PASS.

- [ ] **Step 5: Refactor `src/commands/list.js` to import from `branch-stats.js`**

Replace the full contents of `src/commands/list.js` with:

```js
// src/commands/list.js
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getFeatureBranches, buildBranchEntry } from '../lib/branch-stats.js'

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

  let featureBranches
  try {
    featureBranches = getFeatureBranches(cwd, config)
  } catch {
    console.error(chalk.red('upstream list: not a git repository'))
    process.exit(1)
  }

  const entries = featureBranches.map(b =>
    buildBranchEntry(b, docsPath, config.docs_path, config.adr_triggers)
  )

  const allMatched = new Set(entries.flatMap(e => e._matched))

  let allDocs = []
  if (existsSync(docsPath)) {
    allDocs = readdirSync(docsPath).filter(f => f.endsWith('.md'))
  }
  const unlinked = allDocs
    .filter(f => !allMatched.has(f))
    .map(f => join(config.docs_path, f))

  const cleanEntries = entries.map(({ _matched, ...rest }) => rest)

  if (opts.format === 'json') {
    console.log(JSON.stringify({ branches: cleanEntries, unlinked }, null, 2))
    return
  }

  renderTable(cleanEntries, unlinked)
}
```

- [ ] **Step 6: Run regression tests for `list`**

```bash
npm test -- --reporter=verbose tests/integration/list.test.js
```

Expected: all PASS (zero behaviour change).

- [ ] **Step 7: Commit**

```bash
git add src/lib/branch-stats.js src/commands/list.js tests/unit/branch-stats.test.js
git commit -m "refactor(list): extract branch-stats.js shared helper"
```

---

### Task 2: `upstream stats` command

**Files:**
- Create: `src/commands/stats.js`
- Modify: `bin/upstream.js`
- Test: `tests/integration/stats.test.js`

**Interfaces:**
- Consumes from Task 1:
  - `getFeatureBranches(cwd, config): string[]`
  - `buildBranchEntry(branch, docsPath, configDocsPath, adrTriggers): object`
  - `parseSkips(content): object[]`
  - `computeStats(entries, skipEntries, allDocs, allMatched): object`
- Produces: `statsCommand(opts?: { format?: string }, cwd?: string): void`

- [ ] **Step 1: Write failing integration tests**

Create `tests/integration/stats.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo

beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream stats', () => {
  it('exits 0 with no feature branches', () => {
    const { exitCode } = runCLI('stats', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('shows 0 branches tracked when no feature branches', () => {
    const { stdout } = runCLI('stats', { cwd: repo.dir })
    expect(stdout).toMatch(/Branches tracked.*0/)
  })

  it('counts branch with PRD in withPrd', () => {
    repo.git('checkout', '-b', 'feat/search')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-search.md'), '# PRD: Search\n\ncontent')
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.branches.withPrd).toBe(1)
    expect(data.branches.noDocs).toBe(0)
  })

  it('counts branch without docs in noDocs', () => {
    repo.git('checkout', '-b', 'feat/empty')
    repo.git('checkout', '-')
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.branches.noDocs).toBe(1)
    expect(data.branches.skipped).toBe(0)
  })

  it('counts SKIPS.md entries in skipped, not noDocs', () => {
    repo.git('checkout', '-b', 'feat/skipped')
    repo.git('checkout', '-')
    writeFileSync(
      join(repo.dir, 'docs/upstream/SKIPS.md'),
      '## Skip: PRD — feat/skipped — 2026-06-01\n\n**Reason:** hotfix\n'
    )
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.branches.skipped).toBe(1)
    expect(data.branches.noDocs).toBe(0)
  })

  it('counts PRD+ADR skip entries for same branch as skipped: 2', () => {
    repo.git('checkout', '-b', 'feat/both-skipped')
    repo.git('checkout', '-')
    const skipsContent = [
      '## Skip: PRD — feat/both-skipped — 2026-06-01\n\n**Reason:** reason A',
      '## Skip: ADR — feat/both-skipped — 2026-06-01\n\n**Reason:** reason B',
    ].join('\n\n')
    writeFileSync(join(repo.dir, 'docs/upstream/SKIPS.md'), skipsContent)
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.branches.skipped).toBe(2)
    expect(data.branches.noDocs).toBe(0)
  })

  it('--format json returns all expected keys', () => {
    const { stdout, exitCode } = runCLI('stats --format json', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    const data = JSON.parse(stdout)
    expect(data).toHaveProperty('branches')
    expect(data).toHaveProperty('adrCompliance')
    expect(data).toHaveProperty('unlinkedDocs')
    expect(data.branches).toHaveProperty('total')
    expect(data.branches).toHaveProperty('withPrd')
    expect(data.branches).toHaveProperty('withAdr')
    expect(data.branches).toHaveProperty('skipped')
    expect(data.branches).toHaveProperty('noDocs')
    expect(data.adrCompliance).toHaveProperty('required')
    expect(data.adrCompliance).toHaveProperty('present')
    expect(data.adrCompliance).toHaveProperty('rate')
  })

  it('adrCompliance.rate is null when no PRDs triggered ADR requirement', () => {
    repo.git('checkout', '-b', 'feat/ui')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-ui.md'), '# PRD: UI\n\nno triggers here')
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.adrCompliance.rate).toBeNull()
  })

  it('adrCompliance.rate is a number when PRD triggers ADR requirement', () => {
    repo.git('checkout', '-b', 'feat/auth')
    repo.git('checkout', '-')
    writeFileSync(
      join(repo.dir, 'docs/upstream/PRD-auth.md'),
      '# PRD: Auth\n\nThis involves an auth_change.'
    )
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(typeof data.adrCompliance.rate).toBe('number')
    expect(data.adrCompliance.required).toBe(1)
    expect(data.adrCompliance.present).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- --reporter=verbose tests/integration/stats.test.js
```

Expected: FAIL — `upstream stats` command not registered yet.

- [ ] **Step 3: Create `src/commands/stats.js`**

```js
// src/commands/stats.js
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getFeatureBranches, buildBranchEntry, parseSkips, computeStats } from '../lib/branch-stats.js'

function pct(n, total) {
  return total === 0 ? '—' : `${Math.round((n / total) * 100)}%`
}

function renderStats(stats) {
  const { branches, adrCompliance, unlinkedDocs } = stats
  const t = branches.total

  console.log(chalk.bold('\nupstream coverage report'))
  console.log('========================')
  console.log(`Branches tracked:  ${String(t).padStart(3)}`)
  console.log(`  With PRD:        ${String(branches.withPrd).padStart(3)}  (${pct(branches.withPrd, t)})`)
  console.log(`  With ADR:        ${String(branches.withAdr).padStart(3)}  (${pct(branches.withAdr, t)})`)
  console.log(`  Skipped:         ${String(branches.skipped).padStart(3)}  (${pct(branches.skipped, t)})`)
  console.log(`  No docs:         ${String(branches.noDocs).padStart(3)}  (${pct(branches.noDocs, t)})`)

  if (adrCompliance.rate !== null) {
    const rateStr = `${Math.round(adrCompliance.rate * 100)}%`
    console.log(`\nADR compliance:    ${rateStr.padStart(4)}  (${adrCompliance.present} of ${adrCompliance.required} PRDs that triggered ADR requirement)`)
  }

  console.log(`\nUnlinked docs:     ${String(unlinkedDocs).padStart(3)}`)
  console.log('')
}

export function statsCommand(opts = {}, cwd = process.cwd()) {
  const configPath = join(cwd, 'upstream.config.yaml')
  if (!existsSync(configPath)) {
    console.error(chalk.red('upstream stats: no upstream.config.yaml found'))
    process.exit(1)
  }

  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  let featureBranches
  try {
    featureBranches = getFeatureBranches(cwd, config)
  } catch {
    console.error(chalk.red('upstream stats: not a git repository'))
    process.exit(1)
  }

  const entries = featureBranches.map(b =>
    buildBranchEntry(b, docsPath, config.docs_path, config.adr_triggers ?? [])
  )

  let skipEntries = []
  const skipsPath = join(docsPath, 'SKIPS.md')
  if (existsSync(skipsPath)) {
    try { skipEntries = parseSkips(readFileSync(skipsPath, 'utf8')) } catch {}
  }

  let allDocs = []
  if (existsSync(docsPath)) {
    allDocs = readdirSync(docsPath).filter(f => f.endsWith('.md') && f !== 'SKIPS.md')
  }
  const allMatched = new Set(entries.flatMap(e => e._matched))

  const stats = computeStats(entries, skipEntries, allDocs, allMatched)

  if (opts.format === 'json') {
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  renderStats(stats)
}
```

- [ ] **Step 4: Register command in `bin/upstream.js`**

Add after the existing `import` block (line 10, after `import { validateCommand }`):

```js
import { statsCommand } from '../src/commands/stats.js'
```

Add before `program.parse()` at the bottom:

```js
program
  .command('stats')
  .description('Show PRD/ADR coverage summary across all feature branches')
  .option('--format <fmt>', 'output format: table or json', 'table')
  .action((opts) => statsCommand(opts))
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all PASS — unit (branch-stats), integration (stats, list regression), and all existing tests.

- [ ] **Step 6: Smoke-test human output**

```bash
node bin/upstream.js stats
```

Expected: prints `upstream coverage report` header with aligned columns.

- [ ] **Step 7: Commit**

```bash
git add src/commands/stats.js bin/upstream.js tests/integration/stats.test.js
git commit -m "feat(stats): add upstream stats command (#8)"
```
