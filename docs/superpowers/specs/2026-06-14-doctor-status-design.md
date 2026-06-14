# upstream doctor + upstream status — Design Spec

**Date:** 2026-06-14  
**Approach:** Two independent read-only diagnostic commands (Approach A)

---

## 1. `upstream doctor`

### Purpose

Diagnoses whether upstream is correctly installed in the current repo. Designed to run after `git pull` or when something feels broken. With `--fix`, repairs structural issues automatically.

### File

`src/commands/doctor.js`

### Checks (in order)

| ID | Check | Pass condition |
| --- | --- | --- |
| config | `upstream.config.yaml` | File exists AND parses as valid YAML object |
| hook | `.claude/hooks/upstream-check.sh` | File exists AND has execute bit (`chmod 755`) |
| mcp | `.claude/settings.json` | File exists, parses as JSON, has `mcpServers.upstream.command === "npx"` and `args === ["upstream", "mcp"]` |
| skills | `.claude/plugins/upstream/skills/{upstream-guard,upstream-prd,upstream-adr}.md` | All 3 present |
| templates | `.claude/plugins/upstream/templates/{PRD,ADR}.md` | Both present |
| auth | Token in `~/.upstream/tokens.json` per provider | For each entry in `PROVIDERS` where `config.integrations[providerDef.configKey]` is set, `getProviderToken(providerId)` returns non-null. Skip if no integrations configured. |

### Output format

```
upstream doctor

✅  config       upstream.config.yaml — valid
✅  hook         .claude/hooks/upstream-check.sh — executable
❌  mcp          .claude/settings.json — upstream server not registered
✅  skills       3/3 present
✅  templates    2/2 present
⚠️   auth         google-docs — token not found (run: upstream auth google-docs)

1 error found. Run: upstream doctor --fix
```

- `✅` = pass
- `❌` = error (fixable by `--fix`)
- `⚠️` = warning (not fixable by `--fix` — needs manual action)
- Auth issues are always `⚠️` (never `❌`) because fix requires browser interaction

### `--fix` behaviour

Calls `scaffoldInto(cwd, TEMPLATES)` + `writeMcpSettings(cwd)` — both are already idempotent.  
Auth issues print the corrective command but are never auto-fixed.

After fix, re-runs all checks and prints final state.

### Exit codes

- `0` — all checks ✅ (warnings allowed)
- `1` — any ❌ error

### Error handling

- Not in a repo with `upstream.config.yaml`: print `upstream doctor: no upstream.config.yaml found in <cwd>` + exit 1
- `upstream.config.yaml` is invalid YAML: report as ❌ config check, continue remaining checks

---

## 2. `upstream status`

### Purpose

Shows PRD/ADR state for the current git branch without running Claude. Designed for quick branch health checks and CI scripting.

### File

`src/commands/status.js`

### Algorithm

1. `execSync('git rev-parse --abbrev-ref HEAD')` → `branch`
2. Read `upstream.config.yaml` → get `bypass_for` list and `docs_path`
3. If branch starts with any bypass prefix → print bypass message, exit 0
4. Compute slug: strip prefix up to and including `/` (e.g. `feat/add-auth` → `add-auth`)
5. Scan all `.md` files in `docs_path` (non-recursive, top-level only)
6. Match logic per file:
   - **filename match**: `basename.toLowerCase()` contains slug
   - **content match**: file content contains the full branch name string
7. Classify matched files:
   - **PRD**: `basename` contains `PRD` (case-insensitive) OR first heading contains `# PRD`
   - **ADR**: `basename` contains `ADR` (case-insensitive) OR first heading contains `# ADR`
8. Report first match per type (PRD, ADR)

### Output examples

Feature branch, both docs present:
```
upstream status

Branch:  feat/add-payment-flow
Type:    feature

PRD  ✅  docs/upstream/PRD-add-payment-flow.md
ADR  ✅  docs/upstream/ADR-add-payment-flow.md
```

Feature branch, missing docs:
```
upstream status

Branch:  feat/add-payment-flow
Type:    feature

PRD  ❌  not found in docs/upstream/
ADR  —   (check PRD first)
```

Bypass branch:
```
upstream status

Branch:  fix/login-button
Type:    bypass — upstream skipped for fix/ branches
```

### Exit codes

- `0` — bypass branch OR feature branch with PRD present
- `1` — feature branch with PRD missing, or any error condition

### Error handling

| Condition | Output |
| --- | --- |
| Not in a git repo | `upstream status: not a git repository` + exit 1 |
| `upstream.config.yaml` missing | `upstream status: no upstream.config.yaml found in <cwd>` + exit 1 |
| `docs_path` directory missing | `upstream status: docs path not found: <path>` + exit 1 |

---

## CLI registration

Both commands added to `bin/upstream.js`:

```
upstream doctor         Check upstream installation health
upstream doctor --fix   Repair missing or misconfigured files
upstream status         Show PRD/ADR state for current branch
```

---

## Tests

### doctor tests (`tests/unit/doctor.test.js`)

- All checks pass → exit 0, all ✅
- Missing hook → ❌ hook reported, exit 1
- Missing MCP entry → ❌ mcp reported, exit 1
- Missing skill files → ❌ skills shows 2/3, exit 1
- Auth token missing (integration configured) → ⚠️ auth warning, exit 0
- `--fix` on broken install → re-runs checks, all ✅ after

### status tests (`tests/unit/status.test.js`)

- Feature branch, PRD + ADR by filename → both ✅
- Feature branch, PRD found by content scan → ✅
- Feature branch, no docs → PRD ❌, ADR `—`
- Bypass branch → bypass message, exit 0
- Not a git repo → error message, exit 1
- No `upstream.config.yaml` → error message, exit 1

---

## Out of scope

- Recursive scan of subdirectories in `docs_path` (top-level only for v1)
- `upstream status --branch <name>` flag (deferred)
- `upstream doctor --json` machine-readable output (deferred)
