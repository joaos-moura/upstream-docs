# upstream-align — Design Spec

**Date:** 2026-06-23
**Status:** Approved
**Author:** João S. Moura

---

## Summary

`upstream-align` extends upstream with a second enforcement layer: after PRD/ADR existence is verified before development (via `upstream-guard`), alignment checks verify that the _implementation_ matches the intent documented in those artifacts. Checks run at two moments — pre-push (local, blocking or warning) and PR creation (server-side, always posts a comment).

---

## Problem

`upstream-guard` gates development on PRD/ADR _existence_. It does not verify that what was built matches what was planned. Drift accumulates silently: scope creep, violated ADR decisions, unaddressed success metrics. The gap closes with `upstream-align`.

---

## Architecture

Four new artifacts, all scaffolded by `upstream init`:

| Artifact | Role |
|----------|------|
| `upstream-align` skill | Inline analysis in Claude Code (pre-push hook) |
| `upstream validate` CLI | Standalone analysis (GH Actions + on-demand) |
| `.github/workflows/upstream-align.yml` | GH Actions workflow (PR trigger) |
| `upstream.config.yaml` `align:` section | Config for violation policy, base branch |

### Pre-push flow

```
upstream-check.sh
  → detects feature branch
  → invokes upstream-align skill
       → reads PRD/ADR
           → if link mode: fetches content from provider (Google Docs / Confluence)
           → if provider offline: falls back to heuristics
       → git diff <base_branch>..HEAD
       → analyzes alignment (5 dimensions — see below)
       → on_violation=block: exit 1 (blocks push)
       → on_violation=warn:  prints findings, exit 0
```

### PR flow

```
GH Action (pull_request: opened, synchronize)
  → upstream validate --output json --base <base_branch>
       → attempts: claude -p "invoke upstream-align skill"
       → fallback: deterministic heuristics
  → posts structured comment via GitHub API (GITHUB_TOKEN)
  → if on_violation=block + misalignment: Action fails
      → can be configured as required status check
```

---

## Configuration

New `align:` section in `upstream.config.yaml`:

```yaml
align:
  on_violation: warn      # warn | block
  base_branch: auto       # auto | main | develop | trunk | any branch name
  post_pr_comment: true
```

`base_branch: auto` resolves via `git symbolic-ref refs/remotes/origin/HEAD`, which returns the repo's default branch regardless of naming convention (main, master, develop, trunk). Falls back to `main` if the ref is unset.

---

## Alignment Checks

Five dimensions analyzed against PRD and ADR content:

| Dimension | Source | Question |
|-----------|--------|----------|
| Problem coverage | PRD `problem_statement` | Does the diff address the described problem? |
| Success metrics | PRD `success_metrics` | Does each metric have corresponding implementation? |
| Scope creep | PRD `out_of_scope` | Does the diff touch areas explicitly out of scope? |
| ADR decisions | Each decision in ADR | Does the implementation follow recorded decisions? |
| New dependencies | ADR + `package.json` diff | Are new dependencies not mentioned in the ADR? |

### Heuristic fallback (no LLM)

When `claude -p` is unavailable:

- **Scope creep:** keyword/path matching between `out_of_scope` text and diff file paths
- **New dependencies:** `package.json` diff parsed for new packages, checked against ADR text
- Output clearly labeled: `heuristic analysis (no LLM available)`

---

## PR Comment Format

Posted automatically via `GITHUB_TOKEN`. Always posted — aligned or not.

```markdown
## upstream alignment check

**PRD:** docs/upstream/PRD-user-auth.md
**ADR:** docs/upstream/ADR-001-user-auth.md

| Check | Status | Detail |
|-------|--------|--------|
| Problem coverage | ✅ | |
| Success metrics (3/3) | ✅ | |
| Out of scope | ⚠️ | `src/billing/invoice.js` touched |
| ADR decisions | ❌ | ADR mandates JWT — code uses session cookies |

**Verdict: MISALIGNED** — 2 issue(s) found.

<details><summary>How to resolve</summary>
Either update the PRD/ADR to reflect the new decisions, or adjust the implementation.
Run `upstream validate` locally for details.
</details>

> Analysis by upstream-align · [upstream docs](https://github.com/joaos-moura/upstream-docs)
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| PRD/ADR not found | Skip analysis, emit: "No PRD/ADR found — skipping alignment check" |
| Link mode + provider offline | Fall back to heuristics, note in comment |
| `claude -p` fails | Fall back to heuristics automatically, no error |
| GH Actions, no `ANTHROPIC_API_KEY` | Fall back to heuristics silently |
| Diff exceeds token budget | Analyze first N files, warn about truncation in output |

---

## `upstream init` Changes

Two new prompts added to the wizard:

```
Enable alignment checks? (pre-push + PR comments) [Y/n]
  → On violation: warn or block? [warn]
  → Base branch: [auto-detect]
```

New scaffolding generated:

- `.github/workflows/upstream-align.yml`
- `align:` section written to `upstream.config.yaml`
- `ANTHROPIC_API_KEY=` placeholder added to `.env`, `.env.local`, `.env.example`

`upstream upgrade` regenerates the workflow file if it already exists, preserving any manual edits to `on_violation` and `base_branch` from config.

---

## Testing Strategy

| Layer | What |
|-------|------|
| Unit | Deterministic heuristics: scope creep keyword matching, dependency diffing |
| Unit | `upstream validate` CLI: exit codes, JSON output shape |
| Unit | `base_branch: auto` resolution logic |
| Integration | `claude -p` invocation → fallback path trigger |
| Fixture-based | PRD + ADR + diff fixtures → expected alignment verdict |

---

## New CLI Command

```
upstream validate             # analyze current branch alignment, human output
upstream validate --output json  # structured JSON for CI consumption
upstream validate --base develop # explicit base branch override
```

Exit codes: `0` = aligned or warn mode, `1` = misaligned + block mode.

---

## Files Added / Modified

```
src/commands/validate.js                         ← new CLI command
.claude/plugins/upstream/skills/upstream-align.md ← new skill
.github/workflows/upstream-align.yml              ← scaffolded by init
upstream.config.yaml                              ← align: section added by init
```
