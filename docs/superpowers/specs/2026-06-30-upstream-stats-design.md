# Design: upstream stats (#8)

**Date:** 2026-06-30
**Issue:** #8 — feat(stats): add upstream stats command — local PRD/ADR coverage report
**Branch:** feat/analytics-initiative

## Context

`upstream list` already shows per-branch coverage in a table. `upstream stats` extends this into an aggregate summary report: coverage percentages, ADR compliance rate, skip count — at a glance. This is the foundation for issues #9 (snapshots), #10 (CI report), and #11 (adoption analytics).

## Architecture

### New / modified files

```
src/lib/branch-stats.js         ← new shared helper
src/commands/stats.js           ← new command
src/commands/list.js            ← refactored to import from branch-stats.js (no behaviour change)
bin/upstream.js                 ← registers `upstream stats`
tests/unit/branch-stats.test.js ← unit tests for helper
tests/integration/stats.test.js ← integration tests for command
```

### Shared helper: `src/lib/branch-stats.js`

Exports:

- `getFeatureBranches(cwd, config)` — runs `git branch`, filters by `config.bypass_for`. Extracted from `list.js`.
- `buildBranchEntry(branch, docsPath, configDocsPath, adrTriggers)` — builds `{ branch, prd, adr, adrRequired, _matched }`. Extracted from `list.js` verbatim.
- `parseSkips(content)` — parses SKIPS.md string into skip entries.
- `computeStats(entries, skipEntries, allDocs, allMatched)` — aggregates counters for `upstream stats`.

`list.js` imports `getFeatureBranches` and `buildBranchEntry` from `branch-stats.js`. Behaviour is identical; this is a pure extraction.

## Data Shapes

### `parseSkips(content)` return type

```js
[{ type: 'prd' | 'adr', branch: string, date: string, reason: string }]
```

Parses entries matching the format written by the `upstream-guard` skill:
```
## Skip: [PRD|ADR] — [branch] — [YYYY-MM-DD]

**Reason:** [justification]
```

Malformed entries (no regex match) are silently ignored.

### `computeStats` return type / JSON output shape

```js
{
  branches: {
    total: number,
    withPrd: number,
    withAdr: number,
    skipped: number,   // total entries in SKIPS.md (not unique branches)
    noDocs: number,    // no PRD, no ADR, no skip entry
  },
  adrCompliance: {
    required: number,  // branches with PRD where adrRequired() = true
    present: number,   // of those, how many have an ADR file
    rate: number | null, // present / required; null when required = 0
  },
  unlinkedDocs: number,
}
```

### Category rules (mutually exclusive at top level)

- **With PRD** — branch has a PRD file (can overlap with With ADR)
- **With ADR** — branch has an ADR file (sub-metric, shown as subset of total)
- **Skipped** — branch name appears in at least one SKIPS.md entry (even if no doc files exist)
- **No docs** — no PRD, no ADR, and no entry in SKIPS.md
- Top-level exclusive breakdown: `withPrd` + `skipped` + `noDocs` = `total` (ADR is a sub-metric of withPrd)

### Human output

```
upstream coverage report
========================
Branches tracked:   12
  With PRD:          9  (75%)
  With ADR:          5  (42%)
  Skipped:           2  (17%)
  No docs:           1   (8%)

ADR compliance:     56%  (5 of 9 PRDs that triggered ADR requirement)

Unlinked docs:       3
```

- Percentages are `Math.round(n / total * 100)`
- "ADR compliance" line is omitted when `rate === null` (no PRDs triggered ADR requirement)

## Error Handling & Edge Cases

| Condition | Behaviour |
|-----------|-----------|
| No `upstream.config.yaml` | exit 1 with error message (same as `list`) |
| Not a git repo | exit 1 with error message |
| `docs_path` does not exist | `unlinkedDocs: 0`; branches counted, all fall into `noDocs` |
| `SKIPS.md` absent | `skipped: 0`; no error |
| `SKIPS.md` malformed | non-matching entries silently skipped |
| `adr_triggers` empty/absent | `adrCompliance.required: 0`; `rate: null`; line omitted in human output |

## Testing

### `tests/unit/branch-stats.test.js`

`parseSkips`:
- Empty string → empty array
- Single PRD entry → correct fields
- Single ADR entry → correct fields
- Multiple entries including same branch PRD+ADR → both appear (count = 2)
- Malformed entry mixed with valid → valid parsed, malformed ignored

`computeStats`:
- Zero branches → all zeros, rate null
- Mix of PRD/ADR/skipped/noDocs → correct counters
- `rate: null` when `required = 0`

### `tests/integration/stats.test.js`

Using `makeTmpRepo({ init: true })` pattern from `helpers.js`:

- Exits 0 with no feature branches
- Branch with PRD → `withPrd: 1`
- Branch without any docs → `noDocs: 1`
- Branch with SKIPS.md entry → counted in `skipped`, not in `noDocs`
- Branch with PRD + SKIPS.md ADR entry → `withPrd: 1`, `skipped: 1`
- `--format json` returns shape with all expected keys
- `--format json` with ADR triggers and no ADR → `adrCompliance.rate` is a number

### Regression

`tests/integration/list.test.js` runs unchanged and must pass — validates the `list.js` refactor is transparent.
