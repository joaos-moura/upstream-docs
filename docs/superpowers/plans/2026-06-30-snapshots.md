# Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upstream snapshot` command and `upstream stats --trend` flag to track PRD/ADR coverage over time via local JSON snapshots.

**Architecture:** Three units — `src/lib/snapshots.js` (pure logic: save/load/compare), `src/commands/snapshot.js` (thin command handler), and `src/commands/stats.js` (extended with `--trend` and exported `getCurrentStats`). No new npm dependencies.

**Tech Stack:** Node.js ESM, commander, chalk, vitest (integration via `makeTmpRepo`/`runCLI` from `tests/helpers.js`)

## Global Constraints

- ESM modules (`import`/`export`) — no `require()`
- No new npm dependencies
- Snapshots stored in `.upstream/snapshots/YYYY-MM-DD.json`
- `.upstream/snapshots/.gitignore` content: `*\n!.gitignore\n`
- Snapshot format: `{ upstream_version, saved_at, stats }` where `stats` is the object from `computeStats`
- One snapshot per day — same-day runs overwrite
- Run tests with: `npm test` (vitest)

---

### Task 1: `src/lib/snapshots.js` — snapshot library (with unit tests)

**Files:**
- Create: `src/lib/snapshots.js`
- Create: `tests/unit/snapshots.test.js`

**Interfaces:**
- Produces:
  - `saveSnapshot(cwd: string, stats: object, version: string): string` — saves snapshot, returns absolute path to file
  - `loadLatest(cwd: string): object | null` — returns parsed snapshot object or null
  - `compareForCI(prev: object, curr: object): { regressed: boolean, details: string[] }` — prev is a full snapshot object (has `.stats`), curr is a raw stats object

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/snapshots.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { saveSnapshot, loadLatest, compareForCI } from '../../src/lib/snapshots.js'

const STATS = {
  branches: { total: 4, withPrd: 3, withAdr: 1, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 1 },
  adrCompliance: { required: 1, present: 1, rate: 1 },
  unlinkedDocs: 0,
}

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'upstream-snap-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('saveSnapshot', () => {
  it('creates snapshot file at correct path', () => {
    const path = saveSnapshot(dir, STATS, '0.3.1')
    expect(existsSync(path)).toBe(true)
    const data = JSON.parse(readFileSync(path, 'utf8'))
    expect(data.upstream_version).toBe('0.3.1')
    expect(data.stats).toEqual(STATS)
    expect(data.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('creates .gitignore in snapshots dir', () => {
    saveSnapshot(dir, STATS, '0.3.1')
    const gitignorePath = join(dir, '.upstream', 'snapshots', '.gitignore')
    expect(existsSync(gitignorePath)).toBe(true)
    expect(readFileSync(gitignorePath, 'utf8')).toBe('*\n!.gitignore\n')
  })

  it('does not overwrite .gitignore on second call', () => {
    saveSnapshot(dir, STATS, '0.3.1')
    const gitignorePath = join(dir, '.upstream', 'snapshots', '.gitignore')
    writeFileSync(gitignorePath, 'custom\n')
    saveSnapshot(dir, STATS, '0.3.1')
    expect(readFileSync(gitignorePath, 'utf8')).toBe('custom\n')
  })

  it('overwrites snapshot when called again on same date', () => {
    saveSnapshot(dir, STATS, '0.3.1')
    saveSnapshot(dir, { ...STATS, unlinkedDocs: 5 }, '0.3.1')
    const snapDir = join(dir, '.upstream', 'snapshots')
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
    const data = JSON.parse(readFileSync(join(snapDir, files[0]), 'utf8'))
    expect(data.stats.unlinkedDocs).toBe(5)
  })

  it('returns absolute path to the saved file', () => {
    const path = saveSnapshot(dir, STATS, '0.3.1')
    expect(path).toMatch(/\.upstream[\\/]snapshots[\\/]\d{4}-\d{2}-\d{2}\.json$/)
  })
})

describe('loadLatest', () => {
  it('returns null when .upstream/snapshots dir does not exist', () => {
    expect(loadLatest(dir)).toBeNull()
  })

  it('returns null when snapshots dir exists but has no json files', () => {
    mkdirSync(join(dir, '.upstream', 'snapshots'), { recursive: true })
    expect(loadLatest(dir)).toBeNull()
  })

  it('returns parsed snapshot when one exists', () => {
    saveSnapshot(dir, STATS, '0.3.1')
    const snap = loadLatest(dir)
    expect(snap).not.toBeNull()
    expect(snap.stats).toEqual(STATS)
    expect(snap.upstream_version).toBe('0.3.1')
  })

  it('returns the most recent snapshot by filename when multiple exist', () => {
    const snapDir = join(dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.0',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: { ...STATS, unlinkedDocs: 10 },
    }))
    writeFileSync(join(snapDir, '2026-06-30.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-06-30T00:00:00.000Z',
      stats: { ...STATS, unlinkedDocs: 0 },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    const snap = loadLatest(dir)
    expect(snap.stats.unlinkedDocs).toBe(0)
  })
})

describe('compareForCI', () => {
  const BASE_SNAPSHOT = {
    upstream_version: '0.3.1',
    saved_at: '2026-01-01T00:00:00.000Z',
    stats: {
      branches: { total: 4, withPrd: 4, withAdr: 2, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
      adrCompliance: { required: 2, present: 2, rate: 1 },
      unlinkedDocs: 0,
    },
  }

  it('returns regressed: false when coverage stays the same', () => {
    const { regressed } = compareForCI(BASE_SNAPSHOT, BASE_SNAPSHOT.stats)
    expect(regressed).toBe(false)
  })

  it('returns regressed: false when coverage improves', () => {
    const curr = {
      branches: { total: 4, withPrd: 4, withAdr: 2, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
      adrCompliance: { required: 2, present: 2, rate: 1 },
      unlinkedDocs: 0,
    }
    const { regressed } = compareForCI(BASE_SNAPSHOT, curr)
    expect(regressed).toBe(false)
  })

  it('returns regressed: true with detail when PRD coverage drops', () => {
    const curr = {
      branches: { total: 4, withPrd: 1, withAdr: 2, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 3 },
      adrCompliance: { required: 2, present: 2, rate: 1 },
      unlinkedDocs: 0,
    }
    const { regressed, details } = compareForCI(BASE_SNAPSHOT, curr)
    expect(regressed).toBe(true)
    expect(details.some(d => d.includes('PRD coverage'))).toBe(true)
  })

  it('returns regressed: true with detail when ADR compliance drops', () => {
    const curr = {
      branches: BASE_SNAPSHOT.stats.branches,
      adrCompliance: { required: 2, present: 0, rate: 0 },
      unlinkedDocs: 0,
    }
    const { regressed, details } = compareForCI(BASE_SNAPSHOT, curr)
    expect(regressed).toBe(true)
    expect(details.some(d => d.includes('ADR compliance'))).toBe(true)
  })

  it('skips ADR check when prev rate was null', () => {
    const prevWithNullAdr = {
      ...BASE_SNAPSHOT,
      stats: { ...BASE_SNAPSHOT.stats, adrCompliance: { required: 0, present: 0, rate: null } },
    }
    const curr = {
      branches: BASE_SNAPSHOT.stats.branches,
      adrCompliance: { required: 0, present: 0, rate: null },
      unlinkedDocs: 0,
    }
    const { regressed } = compareForCI(prevWithNullAdr, curr)
    expect(regressed).toBe(false)
  })

  it('includes both PRD and ADR details when both regress', () => {
    const curr = {
      branches: { total: 4, withPrd: 1, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 3 },
      adrCompliance: { required: 2, present: 0, rate: 0 },
      unlinkedDocs: 0,
    }
    const { regressed, details } = compareForCI(BASE_SNAPSHOT, curr)
    expect(regressed).toBe(true)
    expect(details).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/unit/snapshots.test.js
```

Expected: FAIL — `Cannot find module '../../src/lib/snapshots.js'`

- [ ] **Step 3: Implement `src/lib/snapshots.js`**

```js
// src/lib/snapshots.js
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

function pct(withCount, total) {
  return total === 0 ? 0 : Math.round((withCount / total) * 100)
}

export function saveSnapshot(cwd, stats, version) {
  const dir = join(cwd, '.upstream', 'snapshots')
  mkdirSync(dir, { recursive: true })

  const gitignorePath = join(dir, '.gitignore')
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*\n!.gitignore\n')
  }

  const date = new Date().toISOString().slice(0, 10)
  const filePath = join(dir, `${date}.json`)
  writeFileSync(filePath, JSON.stringify({ upstream_version: version, saved_at: new Date().toISOString(), stats }, null, 2))
  return filePath
}

export function loadLatest(cwd) {
  const dir = join(cwd, '.upstream', 'snapshots')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
  if (files.length === 0) return null
  try {
    return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'))
  } catch {
    return null
  }
}

export function compareForCI(prev, curr) {
  const details = []

  const prevPrd = pct(prev.stats.branches.withPrd, prev.stats.branches.total)
  const currPrd = pct(curr.branches.withPrd, curr.branches.total)
  if (currPrd < prevPrd) {
    details.push(`PRD coverage: ${currPrd}%  ↓ from ${prevPrd}%  (${currPrd - prevPrd}%)`)
  }

  if (prev.stats.adrCompliance.rate !== null) {
    const prevAdr = Math.round(prev.stats.adrCompliance.rate * 100)
    const currAdr = curr.adrCompliance.rate !== null ? Math.round(curr.adrCompliance.rate * 100) : 0
    if (currAdr < prevAdr) {
      details.push(`ADR compliance: ${currAdr}%  ↓ from ${prevAdr}%  (${currAdr - prevAdr}%)`)
    }
  }

  return { regressed: details.length > 0, details }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/unit/snapshots.test.js
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/snapshots.js tests/unit/snapshots.test.js
git commit -m "feat(snapshots): add snapshots lib with save/load/compare"
```

---

### Task 2: Refactor `stats.js` — export `getCurrentStats`, add `--trend`

**Files:**
- Modify: `src/commands/stats.js`
- Modify: `tests/integration/stats.test.js`

**Interfaces:**
- Consumes:
  - `loadLatest(cwd): object | null` from `src/lib/snapshots.js`
- Produces:
  - `getCurrentStats(cwd: string): { stats: object } | { error: string }` — exported for use by snapshot command
  - `statsCommand(opts, cwd)` unchanged external behavior; new `opts.trend` flag

- [ ] **Step 1: Write the failing tests for `--trend`**

Append to `tests/integration/stats.test.js` (after the existing describe block, inside the file):

```js
import { mkdirSync, writeFileSync } from 'fs'

// Add this import at the top of the existing file (merge with existing imports)
// The file already imports { writeFileSync } and { join } — add mkdirSync

describe('upstream stats --trend', () => {
  it('exits 1 with message when no snapshots exist', () => {
    const { exitCode, stderr } = runCLI('stats --trend', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/no snapshots found/)
  })

  it('shows trend output when a snapshot exists', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 0, withPrd: 0, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    const { exitCode, stdout } = runCLI('stats --trend', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/upstream coverage trend/)
    expect(stdout).toMatch(/vs 2026-01-01/)
  })

  it('shows trend arrow when PRD coverage improved', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 2, withPrd: 0, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 2 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    repo.git('checkout', '-b', 'feat/auth')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-auth.md'), '# PRD: Auth\n\ncontent')
    const { exitCode, stdout } = runCLI('stats --trend', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/↑/)
  })
})
```

**Note on editing `stats.test.js`:** The file already has `import { writeFileSync } from 'fs'` and `import { join } from 'path'`. Add `mkdirSync` to the fs import line. Add the new describe block at the bottom of the file.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/integration/stats.test.js
```

Expected: new tests FAIL — `--trend` flag not recognized, exits 0 instead of 1

- [ ] **Step 3: Refactor `src/commands/stats.js`**

Replace the entire file:

```js
// src/commands/stats.js
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getFeatureBranches, buildBranchEntry, parseSkips, computeStats } from '../lib/branch-stats.js'
import { loadLatest } from '../lib/snapshots.js'

function pct(n, total) {
  return total === 0 ? '—' : `${Math.round((n / total) * 100)}%`
}

function trendArrow(curr, prev) {
  if (curr > prev) return '↑'
  if (curr < prev) return '↓'
  return '—'
}

function fmtDiffPct(diff) {
  if (diff === 0) return 'no change'
  return (diff > 0 ? '+' : '') + diff + '%'
}

function fmtDiffCount(diff) {
  if (diff === 0) return 'no change'
  return (diff > 0 ? '+' : '') + diff
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
  console.log(`    PRD skips:     ${String(branches.skippedPrd).padStart(3)}`)
  console.log(`    ADR skips:     ${String(branches.skippedAdr).padStart(3)}`)
  console.log(`  No docs:         ${String(branches.noDocs).padStart(3)}  (${pct(branches.noDocs, t)})`)

  if (adrCompliance.rate !== null) {
    const rateStr = `${Math.round(adrCompliance.rate * 100)}%`
    console.log(`\nADR compliance:    ${rateStr.padStart(4)}  (${adrCompliance.present} of ${adrCompliance.required} PRDs that triggered ADR requirement)`)
  }

  console.log(`\nUnlinked docs:     ${String(unlinkedDocs).padStart(3)}`)
  console.log('')
}

function renderTrend(current, snapshot) {
  const prev = snapshot.stats
  const date = snapshot.saved_at.slice(0, 10)
  const t = current.branches.total

  const currPrdPct = t === 0 ? 0 : Math.round((current.branches.withPrd / t) * 100)
  const prevPrdPct = prev.branches.total === 0 ? 0 : Math.round((prev.branches.withPrd / prev.branches.total) * 100)
  const diffPrd = currPrdPct - prevPrdPct

  console.log(chalk.bold(`\nupstream coverage trend  (vs ${date})`))
  console.log('=========================================')
  console.log(`Branches tracked: ${String(t).padStart(4)}`)
  console.log(`PRD coverage:    ${String(currPrdPct + '%').padStart(4)}  ${trendArrow(currPrdPct, prevPrdPct)} from ${prevPrdPct}%  (${fmtDiffPct(diffPrd)})`)

  if (current.adrCompliance.rate !== null || prev.adrCompliance.rate !== null) {
    const currAdr = current.adrCompliance.rate !== null ? Math.round(current.adrCompliance.rate * 100) : 0
    const prevAdr = prev.adrCompliance.rate !== null ? Math.round(prev.adrCompliance.rate * 100) : 0
    const diffAdr = currAdr - prevAdr
    console.log(`ADR compliance:  ${String(currAdr + '%').padStart(4)}  ${trendArrow(currAdr, prevAdr)} from ${prevAdr}%  (${fmtDiffPct(diffAdr)})`)
  }

  const diffSkipped = current.branches.skipped - prev.branches.skipped
  console.log(`Skipped:         ${String(current.branches.skipped).padStart(4)}  ${trendArrow(current.branches.skipped, prev.branches.skipped)} from ${prev.branches.skipped}  (${fmtDiffCount(diffSkipped)})`)

  const diffUnlinked = current.unlinkedDocs - prev.unlinkedDocs
  console.log(`Unlinked docs:   ${String(current.unlinkedDocs).padStart(4)}  ${trendArrow(current.unlinkedDocs, prev.unlinkedDocs)} from ${prev.unlinkedDocs}  (${fmtDiffCount(diffUnlinked)})`)

  console.log('')
}

export function getCurrentStats(cwd) {
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

  let allDocs = []
  if (existsSync(docsPath)) {
    allDocs = readdirSync(docsPath).filter(f => f.endsWith('.md') && f !== 'SKIPS.md')
  }
  const allMatched = new Set(entries.flatMap(e => e._matched))

  return { stats: computeStats(entries, skipEntries, allDocs, allMatched) }
}

export function statsCommand(opts = {}, cwd = process.cwd()) {
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

- [ ] **Step 4: Add `--trend` flag to `bin/upstream.js`**

Find the stats command block in `bin/upstream.js`:

```js
program
  .command('stats')
  .description('Show PRD/ADR coverage summary across all feature branches')
  .option('--format <fmt>', 'output format: table or json', 'table')
  .action((opts) => statsCommand(opts))
```

Replace with:

```js
program
  .command('stats')
  .description('Show PRD/ADR coverage summary across all feature branches')
  .option('--format <fmt>', 'output format: table or json', 'table')
  .option('--trend', 'compare current stats against the latest snapshot')
  .action((opts) => statsCommand(opts))
```

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all existing tests PASS, new `--trend` tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/stats.js bin/upstream.js tests/integration/stats.test.js
git commit -m "feat(stats): export getCurrentStats, add --trend flag"
```

---

### Task 3: `src/commands/snapshot.js` — command handler + bin registration + integration tests

**Files:**
- Create: `src/commands/snapshot.js`
- Modify: `bin/upstream.js`
- Create: `tests/integration/snapshot.test.js`

**Interfaces:**
- Consumes:
  - `getCurrentStats(cwd): { stats } | { error }` from `src/commands/stats.js`
  - `saveSnapshot(cwd, stats, version): string` from `src/lib/snapshots.js`
  - `loadLatest(cwd): object | null` from `src/lib/snapshots.js`
  - `compareForCI(prev, curr): { regressed, details }` from `src/lib/snapshots.js`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/snapshot.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo
beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream snapshot', () => {
  it('exits 0 and creates snapshot file', () => {
    const { exitCode, stdout } = runCLI('snapshot', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/Snapshot saved to .upstream[/\\]snapshots[/\\]\d{4}-\d{2}-\d{2}\.json/)
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('creates .gitignore in snapshots dir', () => {
    runCLI('snapshot', { cwd: repo.dir })
    expect(existsSync(join(repo.dir, '.upstream', 'snapshots', '.gitignore'))).toBe(true)
  })

  it('overwrites when run twice on same day', () => {
    runCLI('snapshot', { cwd: repo.dir })
    runCLI('snapshot', { cwd: repo.dir })
    const files = readdirSync(join(repo.dir, '.upstream', 'snapshots')).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('snapshot file has correct shape', () => {
    runCLI('snapshot', { cwd: repo.dir })
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    const file = readdirSync(snapDir).find(f => f.endsWith('.json'))
    const data = JSON.parse(require('fs').readFileSync(join(snapDir, file), 'utf8'))
    expect(data).toHaveProperty('upstream_version')
    expect(data).toHaveProperty('saved_at')
    expect(data).toHaveProperty('stats')
    expect(data.stats).toHaveProperty('branches')
    expect(data.stats).toHaveProperty('adrCompliance')
    expect(data.stats).toHaveProperty('unlinkedDocs')
  })
})

describe('upstream snapshot --ci', () => {
  it('exits 0 when no prior snapshot exists (nothing to compare)', () => {
    const { exitCode, stdout } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/Snapshot saved/)
  })

  it('exits 0 and prints confirmation when no regression', () => {
    runCLI('snapshot', { cwd: repo.dir })
    const { exitCode, stdout } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/No coverage regression detected/)
  })

  it('exits 1 and prints details when PRD coverage regresses', () => {
    // Seed a snapshot showing 100% PRD coverage (2 branches, 2 PRDs)
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 2, withPrd: 2, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    // Current state: one branch with no PRD → coverage drops
    repo.git('checkout', '-b', 'feat/no-prd')
    repo.git('checkout', '-')
    const { exitCode, stdout, stderr } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stdout + stderr).toMatch(/regression detected/i)
    expect(stdout + stderr).toMatch(/PRD coverage/)
  })

  it('saves a new snapshot even when regression is detected', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 2, withPrd: 2, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    repo.git('checkout', '-b', 'feat/no-prd')
    repo.git('checkout', '-')
    runCLI('snapshot --ci', { cwd: repo.dir })
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json'))
    // today's file added alongside the seeded 2026-01-01 file
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files.some(f => f !== '2026-01-01.json')).toBe(true)
  })
})
```

**Note:** The `snapshot file has correct shape` test uses `require` — since this is ESM, replace that test's inline read with `readFileSync` from the top-level import. The full corrected version of that one test:

```js
  it('snapshot file has correct shape', () => {
    const { readFileSync } = await import('fs')
    runCLI('snapshot', { cwd: repo.dir })
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    const file = readdirSync(snapDir).find(f => f.endsWith('.json'))
    const data = JSON.parse(readFileSync(join(snapDir, file), 'utf8'))
    expect(data).toHaveProperty('upstream_version')
    expect(data).toHaveProperty('saved_at')
    expect(data).toHaveProperty('stats')
  })
```

Actually, simplify — `readFileSync` is already available from the top-level import in the test file. Use it directly (it's imported at the top). Final version of that test:

```js
  it('snapshot file has correct shape', () => {
    runCLI('snapshot', { cwd: repo.dir })
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    const file = readdirSync(snapDir).find(f => f.endsWith('.json'))
    const { readFileSync } = await import('fs') // ESM dynamic import not needed — readFileSync is at top of file
    // Use the readFileSync already imported at the top of the file:
    const data = JSON.parse(require('fs').readFileSync(join(snapDir, file), 'utf8'))
    ...
  })
```

**Correction — write the test file clean, importing `readFileSync` at top:**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo
beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream snapshot', () => {
  it('exits 0 and creates snapshot file', () => {
    const { exitCode, stdout } = runCLI('snapshot', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/Snapshot saved to .upstream[/\\]snapshots[/\\]\d{4}-\d{2}-\d{2}\.json/)
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('creates .gitignore in snapshots dir', () => {
    runCLI('snapshot', { cwd: repo.dir })
    expect(existsSync(join(repo.dir, '.upstream', 'snapshots', '.gitignore'))).toBe(true)
  })

  it('overwrites when run twice on same day', () => {
    runCLI('snapshot', { cwd: repo.dir })
    runCLI('snapshot', { cwd: repo.dir })
    const files = readdirSync(join(repo.dir, '.upstream', 'snapshots')).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('snapshot file has correct shape', () => {
    runCLI('snapshot', { cwd: repo.dir })
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    const file = readdirSync(snapDir).find(f => f.endsWith('.json'))
    const data = JSON.parse(readFileSync(join(snapDir, file), 'utf8'))
    expect(data).toHaveProperty('upstream_version')
    expect(data).toHaveProperty('saved_at')
    expect(data.stats).toHaveProperty('branches')
    expect(data.stats).toHaveProperty('adrCompliance')
    expect(data.stats).toHaveProperty('unlinkedDocs')
  })
})

describe('upstream snapshot --ci', () => {
  it('exits 0 when no prior snapshot exists', () => {
    const { exitCode, stdout } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/Snapshot saved/)
  })

  it('exits 0 and prints confirmation when no regression', () => {
    runCLI('snapshot', { cwd: repo.dir })
    const { exitCode, stdout } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/No coverage regression detected/)
  })

  it('exits 1 and prints details when PRD coverage regresses', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 2, withPrd: 2, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    repo.git('checkout', '-b', 'feat/no-prd')
    repo.git('checkout', '-')
    const { exitCode, stdout, stderr } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stdout + stderr).toMatch(/regression detected/i)
    expect(stdout + stderr).toMatch(/PRD coverage/)
  })

  it('saves a new snapshot even when regression is detected', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 2, withPrd: 2, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    repo.git('checkout', '-b', 'feat/no-prd')
    repo.git('checkout', '-')
    runCLI('snapshot --ci', { cwd: repo.dir })
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json'))
    expect(files.some(f => f !== '2026-01-01.json')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/integration/snapshot.test.js
```

Expected: FAIL — `unknown command 'snapshot'`

- [ ] **Step 3: Create `src/commands/snapshot.js`**

```js
// src/commands/snapshot.js
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import { getCurrentStats } from './stats.js'
import { saveSnapshot, loadLatest, compareForCI } from '../lib/snapshots.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function snapshotCommand(opts = {}, cwd = process.cwd()) {
  const result = getCurrentStats(cwd)
  if (result.error) {
    console.error(chalk.red(`upstream snapshot: ${result.error}`))
    process.exit(1)
  }

  const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'))

  let prev = null
  if (opts.ci) {
    prev = loadLatest(cwd)
  }

  const filePath = saveSnapshot(cwd, result.stats, version)
  const relPath = filePath.replace(cwd + '/', '').replace(cwd + '\\', '')
  console.log(`Snapshot saved to ${relPath}`)

  if (opts.ci) {
    if (!prev) {
      return
    }
    const { regressed, details } = compareForCI(prev, result.stats)
    if (regressed) {
      console.error(chalk.red('Coverage regression detected:'))
      for (const d of details) console.error(chalk.red(`  ${d}`))
      process.exit(1)
    }
    console.log('No coverage regression detected.')
  }
}
```

- [ ] **Step 4: Register the command in `bin/upstream.js`**

Add import at the top of `bin/upstream.js`, after the `statsCommand` import line:

```js
import { snapshotCommand } from '../src/commands/snapshot.js'
```

Add the command registration after the `stats` command block:

```js
program
  .command('snapshot')
  .description('Save current PRD/ADR coverage stats as a local snapshot')
  .option('--ci', 'exit non-zero if coverage regressed since last snapshot')
  .action((opts) => snapshotCommand(opts))
```

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests PASS including new integration tests for `snapshot` and `stats --trend`

- [ ] **Step 6: Commit**

```bash
git add src/commands/snapshot.js bin/upstream.js tests/integration/snapshot.test.js
git commit -m "feat(snapshots): add upstream snapshot command with --ci flag"
```
