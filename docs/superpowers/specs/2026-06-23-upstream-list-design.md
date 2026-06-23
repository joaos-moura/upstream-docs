# upstream list — Design Spec

**Date:** 2026-06-23
**Status:** Approved
**Command:** `upstream list [--format table|json]`

---

## Problem

`upstream status` shows PRD/ADR coverage for the **current branch** only. There is no way to see the state of the whole repository at a glance — which feature branches are covered, which are missing docs, and which docs are orphaned (no active branch).

---

## Goal

Add `upstream list` — a read-only command that shows a hybrid view:

1. **Active feature branches** with their PRD/ADR coverage status
2. **Unlinked documents** — docs in `docs_path` that cannot be matched to any active branch

---

## Output format (table, default)

```
upstream list

Active branches
  branch              PRD                        ADR
  feat/auth           PRD-auth.md ✅              ADR-auth.md ✅
  feat/payments       PRD-payments.md ✅          ⚠  required, missing
  feat/search         ✗  missing                 —

Unlinked documents
  PRD-old-feature.md    (no active branch match)
  ADR-old-arch.md       (no active branch match)
```

**ADR column rules:**

| Condition | Display |
|-----------|---------|
| ADR present | `✅ ADR-xxx.md` |
| ADR absent, triggers found in PRD content | `⚠ required, missing` |
| ADR absent, no triggers in PRD | `—` (not required) |
| PRD missing | `—` (cannot assess) |

**ADR trigger detection:** scan the matched PRD file content for any of the `adr_triggers` keywords defined in `upstream.config.yaml`. This mirrors what the `upstream-guard` skill does manually.

---

## Architecture

### New file: `src/commands/list.js`

Owns the `upstream list` command. Imports shared helpers extracted from `status.js`.

### Refactor: `src/lib/docs.js` (new shared module)

Extract reusable logic from `src/commands/status.js` into a shared library:

- `getSlug(branch)` — strips prefix (`feat/` → slug)
- `scanDocs(docsPath, branch, slug)` — finds matching files by name or content
- `classifyFile(filePath)` — returns `'prd'`, `'adr'`, or `null`
- `adrRequired(prdFilePath, adrTriggers)` — reads PRD content, returns `true` if any trigger keyword appears

`status.js` is updated to import from `src/lib/docs.js` instead of defining these locally.

### `bin/upstream.js`

Register the new `list` sub-command.

---

## Data flow

```
upstream list
  │
  ├─ readConfig()               # load upstream.config.yaml
  ├─ git branch -a              # all local branches (execFileSync, arg array)
  ├─ filter bypass branches     # skip fix/, hotfix/, etc.
  │
  ├─ for each feature branch:
  │    ├─ scanDocs()            # find matching docs
  │    ├─ classifyFile()        # separate PRD from ADR
  │    └─ adrRequired()         # check PRD content for trigger keywords
  │
  ├─ collect all matched files  # to compute orphans
  ├─ scan all docs_path files   # any doc not in matched set = orphan
  │
  └─ render table or JSON
```

---

## `--format json` output

```json
{
  "branches": [
    {
      "branch": "feat/auth",
      "prd": "docs/upstream/PRD-auth.md",
      "adr": "docs/upstream/ADR-auth.md",
      "adrRequired": true
    },
    {
      "branch": "feat/payments",
      "prd": "docs/upstream/PRD-payments.md",
      "adr": null,
      "adrRequired": true
    },
    {
      "branch": "feat/search",
      "prd": null,
      "adr": null,
      "adrRequired": false
    }
  ],
  "unlinked": [
    "docs/upstream/PRD-old-feature.md"
  ]
}
```

---

## Error handling

- Not a git repo → print error, exit 1 (same as `status`)
- `upstream.config.yaml` missing → print error, exit 1
- `docs_path` directory missing → warn, show empty state (not fatal — repo may have no docs yet)
- `git branch` fails → print error, exit 1

---

## Edge cases

- Repo on detached HEAD → skip branch-side, still show unlinked docs
- Branch with no `docs_path` match → PRD row shows `✗ missing`
- `docs_path` is empty → "Active branches" table shows all as missing; no "Unlinked documents" section
- Remote-only branches (refs/remotes/) → excluded; only local branches listed

---

## Testing

**Unit tests** (`tests/unit/docs.test.js`):
- `getSlug` — various prefix formats
- `classifyFile` — by filename, by heading, unknown
- `adrRequired` — trigger found, trigger not found, file unreadable

**Integration tests** (`tests/integration/list.test.js`):
- No feature branches → empty active section
- One branch with PRD only, no ADR triggers → ADR shows `—`
- One branch with PRD containing trigger keyword, no ADR → ADR shows `⚠ required, missing`
- One branch with PRD + ADR → both ✅
- Branch with no docs → PRD shows missing
- Orphaned doc in `docs_path` → appears in Unlinked section
- `--format json` → valid JSON with correct shape

**Refactor test** (`tests/integration/status.test.js`): existing tests must still pass after `docs.js` extraction.

---

## Files changed

| Action | File |
|--------|------|
| New | `src/commands/list.js` |
| New | `src/lib/docs.js` |
| Modified | `src/commands/status.js` — import from `docs.js` |
| Modified | `bin/upstream.js` — register `list` command |
| New | `tests/unit/docs.test.js` |
| New | `tests/integration/list.test.js` |
