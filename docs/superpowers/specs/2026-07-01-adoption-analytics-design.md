# Design: Team Adoption Analytics (`upstream stats --adoption`)

**Date:** 2026-07-01
**Issue:** #11
**Branch:** feat/adoption-analytics

## Overview

Extend `upstream stats` with an `--adoption` flag that produces a per-author adoption report: how many branches each author owns, what percentage have PRDs/ADRs, how many skips they've logged, and an overall adoption score.

All data is derived from local git history and `SKIPS.md` — no network calls.

## Expected Output

```
upstream adoption report
========================
Authors (last 90 days):
  alice    branches:  5   PRD:  5 (100%)   ADR:  3 ( 60%)   skips: 0
  bob      branches:  4   PRD:  2 ( 50%)   ADR:  1 ( 25%)   skips: 2
  carol    branches:  3   PRD:  3 (100%)   ADR:  2 ( 67%)   skips: 0

Skip log (last 90 days):  2 skips
  bob    feat/quick-fix   2026-06-10   "hotfix, no PRD needed"
  bob    feat/typo        2026-06-15   "one-liner, low risk"

Adoption score: 83%  (PRD coverage weighted by branch author)
```

## Architecture

```
src/lib/adoption.js          ← new module, all adoption logic
src/commands/stats.js        ← adds renderAdoption, getAdoptionData, wiring
bin/upstream.js              ← adds --adoption, --since, --no-authors to stats
tests/unit/adoption.test.js  ← unit tests for computeAdoption
tests/integration/stats.test.js ← integration tests for --adoption
```

Data flow:
```
statsCommand(opts.adoption)
  → getAdoptionData(cwd, since)
      → getFeatureBranches()         (existing, branch-stats.js)
      → buildBranchEntry() x N       (existing, branch-stats.js)
      → parseSkips()                 (existing, branch-stats.js)
      → getAuthorMap(cwd, branches, since)       ← new in adoption.js
      → computeAdoption(entries, skips, authorMap, since)  ← new in adoption.js
  → renderAdoption(data, noAuthors)  ← new in stats.js
```

## `src/lib/adoption.js`

### `getAuthorMap(cwd, branches, since)`

- Runs `git log --all --format=%an|%D --since=<since>`
- Parses `%D` (ref decorations) per line: strips `HEAD -> ` and `origin/` prefixes, checks if the ref name is a known branch
- Returns `Map<branchName, authorName>` — first match per branch (tip commit = most recent committer)
- Branches with no activity in the window are absent from the map; callers fall back to `'unknown'`

### `computeAdoption(entries, skipEntries, authorMap, since)`

Inputs:
- `entries` — branch entries from `buildBranchEntry` (with `prd`, `adr` fields)
- `skipEntries` — parsed skip log entries (with `branch`, `date`, `reason`, `type`)
- `authorMap` — `Map<branch, author>` from `getAuthorMap`
- `since` — ISO date string (`YYYY-MM-DD`) or `null`

Behaviour:
1. Filters `skipEntries` to those with `date >= since` (if `since` is set)
2. Filters `entries` to only those whose branch appears in `authorMap` — branches with no recent git activity (not in the window) are excluded; this makes the "last N days" label accurate
3. Groups filtered entries by author (via authorMap)
4. Per-author: counts `branches`, `withPrd`, `withAdr`, `skips`
5. Adoption score: `Math.round(totalWithPrd / totalBranches * 100)` over filtered entries, or `0` if none

Returns:
```js
{
  authors: [{ name, branches, withPrd, withAdr, skips }],
  skips:   [{ type, branch, date, reason, author }],
  adoptionScore: number,
  since: string | null,
}
```

## `src/commands/stats.js` changes

### `getAdoptionData(cwd, since)`

New exported function. Same setup as `getCurrentStats` (validates config, reads branches, builds entries, parses skips), then calls `getAuthorMap` + `computeAdoption`. Returns `{ adoption }` or `{ error }`.

### `renderAdoption(data, noAuthors)`

Internal function. Renders:
1. Header line
2. Authors table (skipped if `noAuthors`): columns aligned with padding
3. Skip log section: count header + one line per skip with author, branch, date, quoted reason
4. Adoption score line

### `statsCommand` wiring

```js
if (opts.adoption) {
  const since = opts.since ?? defaultSince()  // today minus 90 days, YYYY-MM-DD
  const result = getAdoptionData(cwd, since)
  if (result.error) { console.error(...); process.exit(1) }
  if (opts.format === 'json') { console.log(JSON.stringify(result.adoption, null, 2)); return }
  renderAdoption(result.adoption, !opts.authors)
  return
}
```

`defaultSince()` computes today − 90 days as `YYYY-MM-DD`.

## `bin/upstream.js` changes

Add three options to the `stats` command:

```js
.option('--adoption',       'show team adoption analytics')
.option('--since <date>',   'scope lookback window (default: 90 days ago, YYYY-MM-DD)')
.option('--no-authors',     'suppress per-author table, show only aggregate totals')
```

`--no-authors` uses Commander's built-in negation: sets `opts.authors = false`.

## `--since` semantics

`--since` scopes the entire lookback window:
- **git log**: `--since` passed to `git log --all` so only branches with commits in the window are mapped to authors; older branches appear as `'unknown'`
- **skip log**: entries with `date < since` are excluded from the Skip log section and from per-author skip counts

Default: 90 days ago from the current date at runtime.

## Adoption Score Formula

```
adoptionScore = Math.round(totalWithPrd / totalBranches * 100)
```

Simple total: counts only feature branches with author activity in the `--since` window (those present in `authorMap`), measures what fraction have a linked PRD. Per-author breakdown is already visible in the table; the score gives a single headline number for dashboards/CI.

## `--format json`

When `--adoption --format json`, outputs the raw `adoption` object:
```json
{
  "authors": [...],
  "skips": [...],
  "adoptionScore": 83,
  "since": "2026-04-02"
}
```

## Tests

### Unit (`tests/unit/adoption.test.js`)

`computeAdoption`:
- Zero entries → `adoptionScore: 0`, `authors: []`
- Entries grouped correctly by author from authorMap
- Branches missing from authorMap → grouped under `'unknown'`
- `--since` filters skip entries by date
- Skip author derived from authorMap, falls back to `'unknown'`

### Integration (`tests/integration/stats.test.js`)

- `upstream stats --adoption` exits 0 and output contains `upstream adoption report`
- `--format json` returns object with `authors`, `skips`, `adoptionScore`, `since`
- `--no-authors` output does not contain the authors table but still shows skip log and score
- `--since <date>` excludes skip entries older than the given date

## Out of Scope

- Persisting adoption snapshots (no `upstream snapshot --adoption`)
- Remote data or network calls
- Sorting options for the authors table (sorted alphabetically by name)
