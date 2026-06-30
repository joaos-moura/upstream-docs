# Snapshots Design

## Goal

Track PRD/ADR coverage over time by persisting `upstream stats` output as local snapshots, enabling trend comparison and CI regression detection.

## Architecture

Three units of work:

1. **`src/lib/snapshots.js`** — pure logic: save, load latest, compare for CI, format trend. No I/O side effects beyond the filesystem calls it owns. Fully unit-testable.
2. **`src/commands/snapshot.js`** — thin command handler for `upstream snapshot [--ci]`. Delegates to `snapshots.js` and `statsCommand`.
3. **`src/commands/stats.js`** — extended with `--trend` flag. Calls `snapshots.loadLatest` and renders the diff.

Snapshots live in `.upstream/snapshots/YYYY-MM-DD.json`. Running the command twice on the same day overwrites the file. The directory is created automatically with a `.gitignore` that ignores all snapshot files (user can opt in to committing them manually).

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/snapshots.js` | create | read, write, compare snapshots |
| `src/commands/snapshot.js` | create | handler for `upstream snapshot [--ci]` |
| `src/commands/stats.js` | modify | add `--trend` flag |
| `bin/upstream.js` | modify | register `snapshot` command |
| `tests/unit/snapshots.test.js` | create | unit tests for snapshots lib |
| `tests/integration/snapshot.test.js` | create | integration tests for the command |

## Snapshot Format

```json
{
  "upstream_version": "0.3.1",
  "saved_at": "2026-06-30T10:00:00.000Z",
  "stats": {
    "branches": { "total": 5, "withPrd": 4, "withAdr": 2, "skipped": 1, "skippedPrd": 1, "skippedAdr": 0, "noDocs": 0 },
    "adrCompliance": { "required": 2, "present": 1, "rate": 0.5 },
    "unlinkedDocs": 1
  }
}
```

`upstream_version` is included for forward compatibility. `saved_at` is an ISO 8601 UTC timestamp.

## Data Flow

```
upstream snapshot
  └─ statsCommand({ format: 'json' })    → stats object
  └─ snapshots.saveSnapshot(dir, stats)  → .upstream/snapshots/YYYY-MM-DD.json
  └─ creates .upstream/snapshots/.gitignore if absent

upstream snapshot --ci
  └─ snapshots.loadLatest(dir)           → previous stats (or null if none)
  └─ statsCommand({ format: 'json' })    → current stats
  └─ snapshots.saveSnapshot(dir, stats)  → overwrites today's file
  └─ if previous exists: snapshots.compareForCI(prev, curr) → exit 0 or 1

upstream stats --trend
  └─ statsCommand({ format: 'json' })    → current stats
  └─ snapshots.loadLatest(dir)           → previous stats (exit 1 if none)
  └─ renderTrend(current, previous)      → formatted output
```

## UX / Output

**`upstream snapshot`:**
```
Snapshot saved to .upstream/snapshots/2026-06-30.json
```

**`upstream snapshot --ci` (no regression):**
```
Snapshot saved to .upstream/snapshots/2026-06-30.json
No coverage regression detected.
```

**`upstream snapshot --ci` (regression, exit 1):**
```
Snapshot saved to .upstream/snapshots/2026-06-30.json
Coverage regression detected:
  PRD coverage: 60%  ↓ from 75%  (-15%)
  ADR compliance: 40%  ↓ from 56%  (-16%)
```

**`upstream stats --trend`:**
```
upstream coverage trend  (vs 2026-06-01)
=========================================
Branches tracked:   5
PRD coverage:      75%  ↑ from 60%  (+15%)
ADR compliance:    56%  ↑ from 44%  (+12%)
Skipped:            2   ↓ from 5    (-3)
Unlinked docs:      1   — from 1    (no change)
```

**`upstream stats --trend` (no snapshot, exit 1):**
```
upstream stats: no snapshots found, run 'upstream snapshot' first
```

## Error Handling

| Scenario | Behavior |
|---|---|
| `upstream snapshot` without `upstream.config.yaml` | exit 1: `"upstream snapshot: no upstream.config.yaml found"` |
| `upstream snapshot` outside git repo | exit 1: `"upstream snapshot: not a git repository"` |
| `upstream stats --trend` with no snapshots | exit 1: `"upstream stats: no snapshots found, run 'upstream snapshot' first"` |
| `upstream snapshot --ci` with no prior snapshot | save current snapshot, exit 0 (nothing to compare) |
| ADR compliance was `null` in previous snapshot | skip ADR regression check |
| ADR compliance is `null` now but had value before | not treated as regression |
| `.upstream/snapshots/` does not exist | created automatically with `.gitignore` |

**`.gitignore` content created automatically:**
```
*
!.gitignore
```

## Regression Definition (CI)

- PRD coverage = `branches.withPrd / branches.total` (percentage)
- ADR compliance = `adrCompliance.rate` (only checked if previous rate was not `null`)
- Regression = current value strictly less than previous value

## Testing Strategy

**Unit tests (`tests/unit/snapshots.test.js`):**
- `saveSnapshot` creates file at correct path with correct shape
- `saveSnapshot` overwrites if same date
- `saveSnapshot` creates `.gitignore` if directory does not exist
- `loadLatest` returns null when no snapshots exist
- `loadLatest` returns the most recent snapshot by filename
- `compareForCI` returns `{ regressed: false }` when no regression
- `compareForCI` returns `{ regressed: true, details }` on PRD regression
- `compareForCI` returns `{ regressed: true, details }` on ADR regression
- `compareForCI` skips ADR check when previous rate was null

**Integration tests (`tests/integration/snapshot.test.js`):**
- `upstream snapshot` exits 0, creates file, prints confirmation
- `upstream snapshot` run twice same day overwrites
- `upstream snapshot --ci` with no prior snapshot exits 0
- `upstream snapshot --ci` with no regression exits 0
- `upstream snapshot --ci` with PRD regression exits 1, prints details
- `upstream stats --trend` with no snapshot exits 1 with message
- `upstream stats --trend` with snapshot shows trend output
