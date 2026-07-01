# Adoption Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upstream stats --adoption` to show per-author PRD/ADR coverage and skip analytics scoped to a configurable time window.

**Architecture:** New pure-logic module `src/lib/adoption.js` exports `getAuthorMap` (git-based author lookup) and `computeAdoption` (groups entries/skips by author). `src/commands/stats.js` gets `getAdoptionData`, `renderAdoption`, and wiring in `statsCommand`. Three new CLI flags added to `bin/upstream.js`.

**Tech Stack:** Node.js ESM, Commander.js (CLI), Vitest (tests), chalk (output colouring), git CLI via `execFileSync`.

## Global Constraints

- ESM modules (`import`/`export`), no CommonJS `require`
- No network calls — all data from local git history and `SKIPS.md`
- Node.js `execFileSync` for git commands (never `exec` or shell interpolation)
- Vitest for all tests (`import { describe, it, expect } from 'vitest'`)
- Test runner: `npm test` (runs `vitest run`)
- Single-test runner: `npx vitest run tests/path/file.test.js`
- Author of a branch = most recent committer on that branch (tip commit via `git log --all --format=%an|%D`)
- `--since` scopes both git log (author map) and skip entry filtering
- Entries not in `authorMap` (no activity in window) are excluded from adoption counts and score

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/adoption.js` | `getAuthorMap`, `computeAdoption` |
| Modify | `src/commands/stats.js` | `getAdoptionData`, `renderAdoption`, `statsCommand` wiring |
| Modify | `bin/upstream.js` | `--adoption`, `--since`, `--no-authors` flags |
| Create | `tests/unit/adoption.test.js` | Unit tests for `computeAdoption` |
| Modify | `tests/integration/stats.test.js` | Integration tests for `--adoption` |

---

## Task 1: Create feature branch

**Files:** none

- [ ] **Step 1: Create and switch to the feature branch**

```bash
git checkout -b feat/adoption-analytics
```

- [ ] **Step 2: Verify branch**

```bash
git branch --show-current
```

Expected output: `feat/adoption-analytics`

---

## Task 2: `src/lib/adoption.js` — core logic (TDD)

**Files:**
- Create: `src/lib/adoption.js`
- Create: `tests/unit/adoption.test.js`

**Interfaces:**
- Produces:
  - `getAuthorMap(cwd: string, branches: string[], since: string | null): Map<string, string>`
  - `computeAdoption(entries, skipEntries, authorMap, since): { authors, skips, adoptionScore, since }`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/adoption.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { computeAdoption } from '../../src/lib/adoption.js'

describe('computeAdoption', () => {
  it('zero entries and empty authorMap → empty authors, score 0, no skips', () => {
    const result = computeAdoption([], [], new Map(), null)
    expect(result.authors).toEqual([])
    expect(result.adoptionScore).toBe(0)
    expect(result.skips).toEqual([])
    expect(result.since).toBeNull()
  })

  it('entries not in authorMap are excluded from authors and score', () => {
    const entries = [{ branch: 'feat/old', prd: 'PRD.md', adr: null }]
    const result = computeAdoption(entries, [], new Map(), null)
    expect(result.authors).toEqual([])
    expect(result.adoptionScore).toBe(0)
  })

  it('groups entries by author and counts branches, withPrd, withAdr', () => {
    const entries = [
      { branch: 'feat/a', prd: 'PRD-a.md', adr: null },
      { branch: 'feat/b', prd: null, adr: null },
      { branch: 'feat/c', prd: 'PRD-c.md', adr: 'ADR-c.md' },
    ]
    const authorMap = new Map([
      ['feat/a', 'alice'],
      ['feat/b', 'bob'],
      ['feat/c', 'alice'],
    ])
    const result = computeAdoption(entries, [], authorMap, null)
    const alice = result.authors.find(a => a.name === 'alice')
    const bob = result.authors.find(a => a.name === 'bob')
    expect(alice).toEqual({ name: 'alice', branches: 2, withPrd: 2, withAdr: 1, skips: 0 })
    expect(bob).toEqual({ name: 'bob', branches: 1, withPrd: 0, withAdr: 0, skips: 0 })
  })

  it('adoptionScore = Math.round(withPrd / totalActive * 100)', () => {
    const entries = [
      { branch: 'feat/a', prd: 'PRD-a.md', adr: null },
      { branch: 'feat/b', prd: null, adr: null },
    ]
    const authorMap = new Map([['feat/a', 'alice'], ['feat/b', 'alice']])
    const result = computeAdoption(entries, [], authorMap, null)
    expect(result.adoptionScore).toBe(50)
  })

  it('since filters skip entries — entries older than since are excluded', () => {
    const skips = [
      { type: 'prd', branch: 'feat/a', date: '2026-01-01', reason: 'old' },
      { type: 'prd', branch: 'feat/b', date: '2026-06-15', reason: 'recent' },
    ]
    const authorMap = new Map([['feat/a', 'alice'], ['feat/b', 'bob']])
    const result = computeAdoption([], skips, authorMap, '2026-04-01')
    expect(result.skips).toHaveLength(1)
    expect(result.skips[0].reason).toBe('recent')
  })

  it('since = null → all skip entries included', () => {
    const skips = [
      { type: 'prd', branch: 'feat/a', date: '2020-01-01', reason: 'very old' },
    ]
    const authorMap = new Map([['feat/a', 'alice']])
    const result = computeAdoption([], skips, authorMap, null)
    expect(result.skips).toHaveLength(1)
  })

  it('skip author derived from authorMap, falls back to "unknown"', () => {
    const skips = [
      { type: 'prd', branch: 'feat/known', date: '2026-06-01', reason: 'x' },
      { type: 'prd', branch: 'feat/missing', date: '2026-06-01', reason: 'y' },
    ]
    const authorMap = new Map([['feat/known', 'alice']])
    const result = computeAdoption([], skips, authorMap, null)
    expect(result.skips.find(s => s.branch === 'feat/known').author).toBe('alice')
    expect(result.skips.find(s => s.branch === 'feat/missing').author).toBe('unknown')
  })

  it('skip counts are attributed to the correct author', () => {
    const entries = [{ branch: 'feat/a', prd: null, adr: null }]
    const skips = [{ type: 'prd', branch: 'feat/a', date: '2026-06-01', reason: 'r' }]
    const authorMap = new Map([['feat/a', 'alice']])
    const result = computeAdoption(entries, skips, authorMap, null)
    const alice = result.authors.find(a => a.name === 'alice')
    expect(alice.skips).toBe(1)
  })

  it('since is included in the return value', () => {
    const result = computeAdoption([], [], new Map(), '2026-04-02')
    expect(result.since).toBe('2026-04-02')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/adoption.test.js
```

Expected: errors like `Cannot find module '../../src/lib/adoption.js'`

- [ ] **Step 3: Create `src/lib/adoption.js`**

```javascript
import { execFileSync } from 'child_process'

export function getAuthorMap(cwd, branches, since) {
  const branchSet = new Set(branches)
  const authorMap = new Map()

  const args = ['log', '--all', '--format=%an|%D']
  if (since) args.push('--since', since)

  let out
  try {
    out = execFileSync('git', args, { encoding: 'utf8', cwd, stdio: 'pipe' })
  } catch {
    return authorMap
  }

  for (const line of out.trim().split('\n')) {
    if (!line.trim()) continue
    const pipeIdx = line.indexOf('|')
    if (pipeIdx === -1) continue
    const author = line.slice(0, pipeIdx)
    const refs = line.slice(pipeIdx + 1)
    if (!refs.trim()) continue
    for (const ref of refs.split(',').map(r => r.trim())) {
      const clean = ref.replace(/^HEAD -> /, '')
      if (branchSet.has(clean) && !authorMap.has(clean)) {
        authorMap.set(clean, author)
      }
    }
  }

  return authorMap
}

export function computeAdoption(entries, skipEntries, authorMap, since) {
  const sinceDate = since ? new Date(since) : null

  const filteredSkips = sinceDate
    ? skipEntries.filter(s => new Date(s.date) >= sinceDate)
    : skipEntries

  const activeEntries = entries.filter(e => authorMap.has(e.branch))

  const authors = new Map()

  for (const entry of activeEntries) {
    const author = authorMap.get(entry.branch)
    if (!authors.has(author)) authors.set(author, { branches: 0, withPrd: 0, withAdr: 0, skips: 0 })
    const a = authors.get(author)
    a.branches++
    if (entry.prd) a.withPrd++
    if (entry.adr) a.withAdr++
  }

  for (const skip of filteredSkips) {
    const author = authorMap.get(skip.branch) ?? 'unknown'
    if (!authors.has(author)) authors.set(author, { branches: 0, withPrd: 0, withAdr: 0, skips: 0 })
    authors.get(author).skips++
  }

  const totalBranches = activeEntries.length
  const totalWithPrd = activeEntries.filter(e => e.prd).length
  const adoptionScore = totalBranches > 0 ? Math.round((totalWithPrd / totalBranches) * 100) : 0

  return {
    authors: [...authors.entries()].map(([name, stats]) => ({ name, ...stats })),
    skips: filteredSkips.map(s => ({ ...s, author: authorMap.get(s.branch) ?? 'unknown' })),
    adoptionScore,
    since: since ?? null,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/adoption.test.js
```

Expected: all tests pass (green)

- [ ] **Step 5: Commit**

```bash
git add src/lib/adoption.js tests/unit/adoption.test.js
git commit -m "feat(adoption): add adoption.js with getAuthorMap and computeAdoption"
```

---

## Task 3: CLI integration — `stats.js` + `bin/upstream.js` + integration tests (TDD)

**Files:**
- Modify: `src/commands/stats.js`
- Modify: `bin/upstream.js`
- Modify: `tests/integration/stats.test.js`

**Interfaces:**
- Consumes:
  - `getAuthorMap(cwd, branches, since)` from `src/lib/adoption.js`
  - `computeAdoption(entries, skipEntries, authorMap, since)` from `src/lib/adoption.js`
  - `getFeatureBranches(cwd, config)`, `buildBranchEntry(...)`, `parseSkips(content)` from `src/lib/branch-stats.js` (already imported in stats.js)
- Produces:
  - `getAdoptionData(cwd: string, since: string): { adoption } | { error: string }` (exported)
  - CLI: `upstream stats --adoption [--since <date>] [--no-authors] [--format json]`

- [ ] **Step 1: Write failing integration tests**

Append to `tests/integration/stats.test.js` (after the existing `describe` blocks):

```javascript
describe('upstream stats --adoption', () => {
  it('exits 0 and shows adoption report header', () => {
    const { exitCode, stdout } = runCLI('stats --adoption', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/upstream adoption report/)
  })

  it('--format json returns object with authors, skips, adoptionScore, since', () => {
    const { stdout, exitCode } = runCLI('stats --adoption --format json', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    const data = JSON.parse(stdout)
    expect(Array.isArray(data.authors)).toBe(true)
    expect(Array.isArray(data.skips)).toBe(true)
    expect(typeof data.adoptionScore).toBe('number')
    expect(data).toHaveProperty('since')
  })

  it('--no-authors suppresses author table but shows skip log and adoption score', () => {
    const { stdout, exitCode } = runCLI('stats --adoption --no-authors', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).not.toMatch(/Authors \(/)
    expect(stdout).toMatch(/Skip log/)
    expect(stdout).toMatch(/Adoption score/)
  })

  it('--since filters out skip entries older than the given date', () => {
    writeFileSync(join(repo.dir, 'upstream.config.yaml'), [
      'version: 1',
      'bypass_for: ["fix/", "hotfix/", "chore/", "docs/", "main", "master"]',
    ].join('\n'))
    repo.git('checkout', '-b', 'feat/alpha')
    repo.git('checkout', '-')
    writeFileSync(
      join(repo.dir, 'docs/upstream/SKIPS.md'),
      [
        '## Skip: PRD — feat/alpha — 2026-01-01\n\n**Reason:** old skip',
        '## Skip: PRD — feat/alpha — 2026-06-15\n\n**Reason:** recent skip',
      ].join('\n\n')
    )
    const { stdout } = runCLI('stats --adoption --since 2026-04-01', { cwd: repo.dir })
    expect(stdout).not.toMatch(/old skip/)
    expect(stdout).toMatch(/recent skip/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/integration/stats.test.js
```

Expected: tests fail with `unknown option '--adoption'`

- [ ] **Step 3: Add import to `src/commands/stats.js`**

Add one line to the existing imports at the top of `src/commands/stats.js`, after the `snapshots.js` import:

```javascript
import { getAuthorMap, computeAdoption } from '../lib/adoption.js'
```

- [ ] **Step 4: Add `defaultSince` and `renderAdoption` to `src/commands/stats.js`**

Add after the existing `fmtDiffCount` function (before `renderStats`):

```javascript
function defaultSince() {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

function renderAdoption(data, noAuthors) {
  const { authors, skips, adoptionScore, since } = data
  const period = since ? `since ${since}` : 'last 90 days'

  console.log(chalk.bold('\nupstream adoption report'))
  console.log('========================')

  if (!noAuthors) {
    console.log(`Authors (${period}):`)
    if (authors.length === 0) {
      console.log('  (none)')
    } else {
      const nameWidth = Math.max(...authors.map(a => a.name.length), 6)
      for (const a of [...authors].sort((x, y) => x.name.localeCompare(y.name))) {
        const prdPct = a.branches > 0 ? Math.round((a.withPrd / a.branches) * 100) : 0
        const adrPct = a.branches > 0 ? Math.round((a.withAdr / a.branches) * 100) : 0
        console.log(
          `  ${a.name.padEnd(nameWidth)}` +
          `   branches: ${String(a.branches).padStart(2)}` +
          `   PRD: ${String(a.withPrd).padStart(2)} (${String(prdPct + '%').padStart(4)})` +
          `   ADR: ${String(a.withAdr).padStart(2)} (${String(adrPct + '%').padStart(4)})` +
          `   skips: ${a.skips}`
        )
      }
    }
  }

  console.log(`\nSkip log (${period}):  ${skips.length} skip${skips.length !== 1 ? 's' : ''}`)
  if (skips.length > 0) {
    const authorWidth = noAuthors ? 0 : Math.max(...skips.map(s => s.author.length), 6)
    for (const s of skips) {
      const authorPart = noAuthors ? '' : `${s.author.padEnd(authorWidth)}   `
      console.log(`  ${authorPart}${s.branch.padEnd(30)}   ${s.date}   "${s.reason}"`)
    }
  }

  console.log(`\nAdoption score: ${adoptionScore}%  (PRD coverage weighted by branch author)`)
  console.log('')
}
```

- [ ] **Step 5: Add `getAdoptionData` to `src/commands/stats.js`**

Add after `getCurrentStats` function (before `statsCommand`):

```javascript
export function getAdoptionData(cwd, since) {
  const configPath = join(cwd, 'upstream.config.yaml')
  if (!existsSync(configPath)) return { error: 'no upstream.config.yaml found' }

  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  let featureBranches
  try {
    featureBranches = getFeatureBranches(cwd, config)
  } catch {
    return { error: 'not a git repository' }
  }

  const entries = featureBranches.map(b =>
    buildBranchEntry(b, docsPath, config.docs_path, config.adr_triggers ?? [])
  )

  let skipEntries = []
  const skipsPath = join(docsPath, 'SKIPS.md')
  if (existsSync(skipsPath)) {
    try { skipEntries = parseSkips(readFileSync(skipsPath, 'utf8')) } catch {}
  }

  const authorMap = getAuthorMap(cwd, featureBranches, since)
  const adoption = computeAdoption(entries, skipEntries, authorMap, since)

  return { adoption }
}
```

- [ ] **Step 6: Wire `--adoption` into `statsCommand` in `src/commands/stats.js`**

Inside `statsCommand`, add the adoption block immediately after the opening guard (after `const { stats } = result` would be wrong — add it before the existing `if (opts.trend)` check, but first the function needs to handle the adoption path before calling `getCurrentStats`). Replace the body of `statsCommand` with:

```javascript
export function statsCommand(opts = {}, cwd = process.cwd()) {
  if (opts.adoption) {
    const since = opts.since ?? defaultSince()
    const result = getAdoptionData(cwd, since)
    if (result.error) {
      console.error(chalk.red(`upstream stats: ${result.error}`))
      process.exit(1)
    }
    if (opts.format === 'json') {
      console.log(JSON.stringify(result.adoption, null, 2))
      return
    }
    renderAdoption(result.adoption, !opts.authors)
    return
  }

  const result = getCurrentStats(cwd)
  if (result.error) {
    console.error(chalk.red(`upstream stats: ${result.error}`))
    process.exit(1)
  }

  const { stats } = result

  if (opts.trend) {
    const snapshot = loadLatest(cwd)
    if (!snapshot) {
      console.error(chalk.red("upstream stats: no snapshots found, run 'upstream snapshot' first"))
      process.exit(1)
    }
    renderTrend(stats, snapshot)
    return
  }

  if (opts.format === 'json') {
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  renderStats(stats)
}
```

- [ ] **Step 7: Add CLI flags in `bin/upstream.js`**

Find the `stats` command block (lines 83–88) and add three new `.option` calls:

```javascript
program
  .command('stats')
  .description('Show PRD/ADR coverage summary across all feature branches')
  .option('--format <fmt>', 'output format: table or json', 'table')
  .option('--trend', 'compare current stats against the latest snapshot')
  .option('--adoption', 'show team adoption analytics — skip analysis and author-level coverage')
  .option('--since <date>', 'scope adoption lookback window (default: 90 days ago, YYYY-MM-DD)')
  .option('--no-authors', 'suppress per-author table, show only aggregate totals')
  .action((opts) => statsCommand(opts))
```

- [ ] **Step 8: Run all tests**

```bash
npm test
```

Expected: all tests pass including the new integration tests

- [ ] **Step 9: Smoke test manually**

```bash
node bin/upstream.js stats --adoption
node bin/upstream.js stats --adoption --format json
node bin/upstream.js stats --adoption --no-authors
```

Expected: `upstream adoption report` header, valid JSON, no Authors table respectively

- [ ] **Step 10: Commit**

```bash
git add src/commands/stats.js bin/upstream.js tests/integration/stats.test.js
git commit -m "feat(adoption): add upstream stats --adoption with --since and --no-authors"
```

---

## Final Check

- [ ] Run full test suite one last time: `npm test`
- [ ] Verify `upstream stats` (without `--adoption`) still works normally
- [ ] Verify `upstream stats --trend` still works normally
