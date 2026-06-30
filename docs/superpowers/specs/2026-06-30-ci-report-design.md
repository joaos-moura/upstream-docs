# Design: upstream validate --report / upstream report summary

**Issue:** #10  
**Branch:** feat/ci-report  
**Date:** 2026-06-30

## Overview

Extend `upstream validate` with a `--report <path>` flag that writes a structured JSON artifact to disk. Add `upstream report summary` subcommand that reads the artifact and prints a Markdown summary suitable for `$GITHUB_STEP_SUMMARY`. Update the workflow template to include both steps.

## Architecture

Two new files, minimal changes to existing ones:

```
src/lib/report.js          — buildReport(), writeReport(), formatSummary()
src/commands/report.js     — reportCommand() for "upstream report summary"
```

Changes to existing files:
- `src/commands/validate.js` — accept `reportPath` option, call lib after analysis
- `bin/upstream.js` — register `--report` on validate, register `report` command
- `templates/workflows/upstream-align.yml` — add upload-artifact and job-summary steps

## JSON Artifact Shape

Default filename: `upstream-report.json` (cwd).

```json
{
  "branch": "feat/user-auth",
  "verdict": "aligned",
  "engine": "llm",
  "coverage": {
    "prdPath": "docs/upstream/PRD-user-auth.md",
    "adrPath": null
  },
  "findings": [
    { "dimension": "problem_statement", "status": "pass", "detail": null }
  ],
  "snapshot": {
    "timestamp": "2026-06-30T12:00:00Z",
    "upstream_version": "0.3.1"
  },
  "trend": {
    "vsLast": null
  }
}
```

`trend.vsLast` is `null` when no previous snapshot exists. When a snapshot is found in `.upstream/snapshots/`:

```json
"vsLast": {
  "prdCoverage": { "before": 80, "after": 85, "delta": 5 },
  "adrCompliance": { "before": 60, "after": 60, "delta": 0 }
}
```

`buildReport()` calls `loadLatest(cwd)` from `src/lib/snapshots.js` (already exists) to compute trend. The `snapshot` field captures the current run's timestamp and upstream version — it does not save a new snapshot.

## Data Flow

```
upstream validate --report [path]
  → validateCommand() runs (unchanged behavior)
  → result = { findings, verdict, engine, prdPath, adrPath, summary }
  → buildReport(result, cwd, version) → report object
  → writeReport(resolvedPath, report) → writes JSON to disk

upstream report summary [--input path]
  → reads upstream-report.json (or --input value)
  → formatSummary(report) → Markdown string
  → stdout (piped to $GITHUB_STEP_SUMMARY by caller)
```

## CLI Changes

`validate` new option:
```
--report [path]    write JSON report artifact (default: upstream-report.json)
```

New `report` command:
```
upstream report <subcommand> [options]
  subcommands: summary
  --input <path>   report file to read (default: upstream-report.json)
```

`--report` and `--output json` are independent: `--output json` prints to stdout (existing behavior), `--report` writes to disk.

## Markdown Summary Format

```markdown
## upstream alignment report

**Branch:** feat/user-auth
**Verdict:** ✅ aligned
**Engine:** llm

| Dimension | Status | Detail |
|-----------|--------|--------|
| problem_statement | ✅ pass | — |
| success_metrics | ⚠️ warning | metrics not measurable yet |

**Trend vs last snapshot:** PRD coverage +5%
```

Verdict icons: `✅ aligned`, `⚠️ warning`, `❌ misaligned`.  
Finding icons: `✅ pass`, `⚠️ warning`, `❌ fail`.  
Trend section omitted when `vsLast` is null.

## Workflow Template Update

```yaml
- name: Run alignment check
  run: upstream validate --report upstream-report.json --output json
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GITHUB_PR_NUMBER: ${{ github.event.pull_request.number }}
    GITHUB_REPOSITORY: ${{ github.repository }}

- name: Upload report
  uses: actions/upload-artifact@v4
  with:
    name: upstream-report
    path: upstream-report.json

- name: Write job summary
  if: always()
  run: upstream report summary >> $GITHUB_STEP_SUMMARY
```

`if: always()` ensures the summary appears even when validate exits non-zero (on_violation: block).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `--report` without path | uses `upstream-report.json` |
| validate fails before analysis (no PRD, no repo) | no report written, existing behavior unchanged |
| `report summary` — file not found | `upstream report: file not found — run 'upstream validate --report' first` |
| `report summary` — invalid JSON | `upstream report: invalid report file` |
| `report <unknown>` | `upstream report: unknown subcommand '<x>'. Try 'summary'.` |
| no snapshot for trend | `trend.vsLast: null`, no error |

Exit codes: `report summary` always exits 0. `validate` exit behavior unchanged.
