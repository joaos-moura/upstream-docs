# upstream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `upstream` npm CLI package — `npx upstream init` scaffolds a Claude Code plugin (hook + skills + templates + config) into any git repo to enforce PRD/ADR creation before feature development.

**Architecture:** A Node.js CLI bundles template files and copies them into the target repo on `init` or `upgrade`. The hook (shell script) runs on every Claude Code prompt submission, checks for a PRD in `docs/upstream/`, and injects a warning if none is found. Three skill files guide developers through PRD/ADR creation interactively. When `docs_storage: link`, skills save a small stub file (title + URL + date) instead of a full document — git traceability is preserved without storing content in the repo.

**Tech Stack:** Node.js 18+, Commander.js (CLI parsing), js-yaml (config), Chalk (terminal output), Vitest (JS tests), bats-core via npm (shell tests)

---

## File Map

**This repo (`/Users/joaosmoura/dev/upstream/`):**

```text
package.json
.gitignore
bin/
  upstream.js                              # CLI entry (bin)
src/
  commands/
    init.js                                # upstream init
    upgrade.js                             # upstream upgrade
  lib/
    config.js                              # reads/validates upstream.config.yaml
    scaffold.js                            # copies templates into target repo
templates/                                 # bundled in npm package
  hooks/
    upstream-check.sh                      # UserPromptSubmit hook
  skills/
    upstream-guard.md
    upstream-prd.md
    upstream-adr.md
  templates/
    PRD.md
    ADR.md
    PRD-link.md                            # stub template for link mode
    ADR-link.md                            # stub template for link mode
  upstream.config.yaml                     # default config
tests/
  fixtures/
    templates/                             # minimal copies for unit tests
      hooks/upstream-check.sh
      skills/upstream-guard.md
      skills/upstream-prd.md
      skills/upstream-adr.md
      templates/PRD.md
      templates/ADR.md
      upstream.config.yaml
  unit/
    cli.test.js
    config.test.js
    scaffold.test.js
  integration/
    init.test.js
    upgrade.test.js
  hook/
    upstream-check.bats
```

**Scaffolded by `npx upstream init` into org repos:**

```text
.claude/
  hooks/
    upstream-check.sh                      (executable)
  plugins/upstream/
    skills/
      upstream-guard.md
      upstream-prd.md
      upstream-adr.md
    templates/
      PRD.md
      ADR.md
docs/upstream/
  .gitkeep
upstream.config.yaml
```

---

### Task 1: Project Setup

**Files:**

- Create: `package.json`
- Create: `bin/upstream.js`
- Create: `src/commands/init.js` (stub)
- Create: `src/commands/upgrade.js` (stub)
- Create: `.gitignore`
- Create: `tests/unit/cli.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli.test.js`:

```js
import { execSync } from 'child_process'
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'url'
import { join } from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const CLI = join(__dirname, '../../bin/upstream.js')

describe('CLI entry point', () => {
  it('shows help with init and upgrade commands', () => {
    const out = execSync(`node ${CLI} --help`).toString()
    expect(out).toContain('upstream')
    expect(out).toContain('init')
    expect(out).toContain('upgrade')
  })

  it('shows version', () => {
    const out = execSync(`node ${CLI} --version`).toString()
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/cli.test.js 2>&1 | head -20
```

Expected: error — `bin/upstream.js` not found

- [ ] **Step 3: Write package.json**

```json
{
  "name": "upstream",
  "version": "0.1.0",
  "description": "Claude Code plugin: enforce PRD/ADR before feature development",
  "type": "module",
  "bin": {
    "upstream": "./bin/upstream.js"
  },
  "files": ["bin", "src", "templates"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:hook": "npx bats tests/hook/"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "bats": "^1.11.0",
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

- [ ] **Step 5: Create bin/upstream.js**

```js
#!/usr/bin/env node
import { Command } from 'commander'
import { initCommand } from '../src/commands/init.js'
import { upgradeCommand } from '../src/commands/upgrade.js'

const program = new Command()

program
  .name('upstream')
  .description('Claude Code plugin: enforce PRD/ADR before feature development')
  .version('0.1.0')

program
  .command('init')
  .description('Scaffold upstream into the current repo')
  .action(initCommand)

program
  .command('upgrade')
  .description('Regenerate skills and hook, preserve config and docs')
  .action(upgradeCommand)

program.parse()
```

- [ ] **Step 6: Create stub command files**

Create `src/commands/init.js`:

```js
export async function initCommand() {
  console.log('init: not yet implemented')
}
```

Create `src/commands/upgrade.js`:

```js
export async function upgradeCommand() {
  console.log('upgrade: not yet implemented')
}
```

- [ ] **Step 7: Create .gitignore**

```gitignore
node_modules/
.DS_Store
*.log
/tmp/
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run tests/unit/cli.test.js
```

Expected: 2 tests PASS

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json bin/upstream.js src/commands/init.js src/commands/upgrade.js .gitignore tests/unit/cli.test.js
git commit -m "feat: scaffold CLI with init and upgrade commands"
```

---

### Task 2: Config Reader

**Files:**

- Create: `src/lib/config.js`
- Create: `tests/unit/config.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/config.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { readConfig, DEFAULT_CONFIG } from '../../src/lib/config.js'

const TMP = '/tmp/upstream-test-config'

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('readConfig', () => {
  it('returns default config when file absent', () => {
    const cfg = readConfig(join(TMP, 'upstream.config.yaml'))
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  it('merges file values with defaults', () => {
    writeFileSync(join(TMP, 'upstream.config.yaml'), `
version: 1
bypass_for:
  - fix/
  - hotfix/
docs_path: docs/my-upstream/
`)
    const cfg = readConfig(join(TMP, 'upstream.config.yaml'))
    expect(cfg.bypass_for).toEqual(['fix/', 'hotfix/'])
    expect(cfg.docs_path).toBe('docs/my-upstream/')
    expect(cfg.prd_required_fields).toEqual(DEFAULT_CONFIG.prd_required_fields)
  })

  it('throws on invalid YAML', () => {
    writeFileSync(join(TMP, 'upstream.config.yaml'), '{ bad yaml: [unclosed')
    expect(() => readConfig(join(TMP, 'upstream.config.yaml'))).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/config.test.js 2>&1 | head -20
```

Expected: FAIL — `readConfig` not defined

- [ ] **Step 3: Implement src/lib/config.js**

```js
import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'

export const DEFAULT_CONFIG = {
  version: 1,
  bypass_for: ['fix/', 'hotfix/', 'chore/', 'docs/'],
  prd_required_fields: ['problem_statement', 'success_metrics', 'out_of_scope'],
  adr_triggers: [
    'new_external_dependency',
    'database_schema_change',
    'api_breaking_change',
    'infrastructure_change',
    'auth_change',
  ],
  docs_path: 'docs/upstream/',
  docs_storage: 'local',  // 'local' | 'link'
}

export function readConfig(configPath) {
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }
  const raw = readFileSync(configPath, 'utf8')
  const parsed = yaml.load(raw)
  return { ...DEFAULT_CONFIG, ...parsed }
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
npx vitest run tests/unit/config.test.js
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.js tests/unit/config.test.js
git commit -m "feat: add config reader with YAML merge and defaults"
```

---

### Task 3: Scaffold Logic

**Files:**

- Create: `src/lib/scaffold.js`
- Create: `tests/fixtures/templates/` (minimal files for unit tests)
- Create: `tests/unit/scaffold.test.js`

- [ ] **Step 1: Create test fixture templates**

These are minimal files used only by unit tests — real content is written in Tasks 4–6.

```bash
mkdir -p tests/fixtures/templates/hooks
mkdir -p tests/fixtures/templates/skills
mkdir -p tests/fixtures/templates/templates
```

Create `tests/fixtures/templates/hooks/upstream-check.sh`:

```bash
#!/usr/bin/env bash
echo "fixture hook"
```

Create `tests/fixtures/templates/skills/upstream-guard.md`:

```markdown
# upstream-guard fixture
```

Create `tests/fixtures/templates/skills/upstream-prd.md`:

```markdown
# upstream-prd fixture
```

Create `tests/fixtures/templates/skills/upstream-adr.md`:

```markdown
# upstream-adr fixture
```

Create `tests/fixtures/templates/templates/PRD.md`:

```markdown
# PRD fixture
```

Create `tests/fixtures/templates/templates/ADR.md`:

```markdown
# ADR fixture
```

Create `tests/fixtures/templates/upstream.config.yaml`:

```yaml
version: 1
bypass_for:
  - fix/
docs_path: docs/upstream/
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/scaffold.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { scaffoldInto, GENERATED_FILES } from '../../src/lib/scaffold.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-test-scaffold'
const FIXTURES = join(__dirname, '../fixtures/templates')

beforeEach(() => { mkdirSync(TARGET, { recursive: true }) })
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('scaffoldInto', () => {
  it('creates all GENERATED_FILES in the target', async () => {
    await scaffoldInto(TARGET, FIXTURES)
    for (const f of GENERATED_FILES) {
      expect(existsSync(join(TARGET, f)), `${f} should exist`).toBe(true)
    }
  })

  it('creates docs/upstream/.gitkeep', async () => {
    await scaffoldInto(TARGET, FIXTURES)
    expect(existsSync(join(TARGET, 'docs/upstream/.gitkeep'))).toBe(true)
  })

  it('creates upstream.config.yaml when absent', async () => {
    await scaffoldInto(TARGET, FIXTURES)
    expect(existsSync(join(TARGET, 'upstream.config.yaml'))).toBe(true)
  })

  it('preserves existing upstream.config.yaml', async () => {
    const configPath = join(TARGET, 'upstream.config.yaml')
    const original = 'version: 1\ncustom: true\n'
    writeFileSync(configPath, original)
    await scaffoldInto(TARGET, FIXTURES)
    expect(readFileSync(configPath, 'utf8')).toBe(original)
  })

  it('makes the hook executable', async () => {
    await scaffoldInto(TARGET, FIXTURES)
    const { statSync } = await import('fs')
    const mode = statSync(join(TARGET, '.claude/hooks/upstream-check.sh')).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run tests/unit/scaffold.test.js 2>&1 | head -20
```

Expected: FAIL — `scaffoldInto` not defined

- [ ] **Step 4: Implement src/lib/scaffold.js**

```js
import { copyFile, mkdir, writeFile, access, chmod } from 'fs/promises'
import { join, dirname } from 'path'

const FILE_MAP = [
  ['hooks/upstream-check.sh',    '.claude/hooks/upstream-check.sh'],
  ['skills/upstream-guard.md',   '.claude/plugins/upstream/skills/upstream-guard.md'],
  ['skills/upstream-prd.md',     '.claude/plugins/upstream/skills/upstream-prd.md'],
  ['skills/upstream-adr.md',     '.claude/plugins/upstream/skills/upstream-adr.md'],
  ['templates/PRD.md',           '.claude/plugins/upstream/templates/PRD.md'],
  ['templates/ADR.md',           '.claude/plugins/upstream/templates/ADR.md'],
]

export const GENERATED_FILES = FILE_MAP.map(([, dest]) => dest)

async function fileExists(p) {
  try { await access(p); return true } catch { return false }
}

export async function scaffoldInto(targetDir, templatesDir) {
  for (const [src, dest] of FILE_MAP) {
    const srcPath = join(templatesDir, src)
    const destPath = join(targetDir, dest)
    await mkdir(dirname(destPath), { recursive: true })
    await copyFile(srcPath, destPath)
  }

  // Make hook executable
  await chmod(join(targetDir, '.claude/hooks/upstream-check.sh'), 0o755)

  // Config: only write if absent (never overwrite org customizations)
  const configDest = join(targetDir, 'upstream.config.yaml')
  if (!await fileExists(configDest)) {
    await copyFile(join(templatesDir, 'upstream.config.yaml'), configDest)
  }

  // Ensure docs dir exists
  const docsDir = join(targetDir, 'docs/upstream')
  await mkdir(docsDir, { recursive: true })
  const gitkeep = join(docsDir, '.gitkeep')
  if (!await fileExists(gitkeep)) {
    await writeFile(gitkeep, '')
  }
}
```

- [ ] **Step 5: Run to verify tests pass**

```bash
npx vitest run tests/unit/scaffold.test.js
```

Expected: 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/scaffold.js tests/unit/scaffold.test.js tests/fixtures/
git commit -m "feat: add scaffold logic with config preservation and hook chmod"
```

---

### Task 4: Hook Script + Tests

**Files:**

- Create: `templates/hooks/upstream-check.sh`
- Create: `tests/hook/upstream-check.bats`

- [ ] **Step 1: Write bats tests first**

Create `tests/hook/upstream-check.bats`:

```bash
#!/usr/bin/env bats

HOOK="$BATS_TEST_DIRNAME/../../templates/hooks/upstream-check.sh"

setup() {
  TMPDIR="$(mktemp -d)"
  cd "$TMPDIR"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  touch .gitkeep && git add .gitkeep && git commit -q -m "init"
  mkdir -p docs/upstream
}

teardown() {
  rm -rf "$TMPDIR"
}

@test "exits silently when upstream.config.yaml is absent" {
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "exits silently on a bypass branch (fix/)" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for:
  - fix/
  - hotfix/
docs_path: docs/upstream/
EOF
  git checkout -b fix/typo -q
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "exits silently on a bypass branch (hotfix/)" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for:
  - fix/
  - hotfix/
docs_path: docs/upstream/
EOF
  git checkout -b hotfix/crash -q
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "injects UPSTREAM message on feature branch with no PRD" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for:
  - fix/
docs_path: docs/upstream/
EOF
  git checkout -b feat/new-payments -q
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [[ "$output" == *"UPSTREAM:"* ]]
}

@test "exits silently when matching PRD file exists" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for: []
docs_path: docs/upstream/
EOF
  git checkout -b feat/oauth-login -q
  echo "# PRD: OAuth Login" > docs/upstream/PRD-oauth-login.md
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "exits silently when PRD exists for branch with prefix" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for: []
docs_path: docs/upstream/
EOF
  git checkout -b feature/user-dashboard -q
  echo "# PRD: User Dashboard" > docs/upstream/PRD-user-dashboard.md
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx bats tests/hook/upstream-check.bats 2>&1 | head -30
```

Expected: all tests fail — hook file missing

- [ ] **Step 3: Create templates/hooks/upstream-check.sh**

```bash
#!/usr/bin/env bash

set -euo pipefail

CONFIG="upstream.config.yaml"

# Not an upstream-enabled repo — exit silently
[[ -f "$CONFIG" ]] || exit 0

# Not in a git repo or on a detached HEAD — exit silently
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
[[ -z "$BRANCH" || "$BRANCH" == "HEAD" ]] && exit 0

# --- Parse bypass_for from config (pure bash, no external deps) ---
BYPASS="no"
in_bypass=0
while IFS= read -r line; do
  if [[ "$line" =~ ^bypass_for: ]]; then
    in_bypass=1
    continue
  fi
  if [[ $in_bypass -eq 1 ]]; then
    if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+(.*) ]]; then
      pattern="${BASH_REMATCH[1]}"
      pattern="${pattern//\'/}"
      pattern="${pattern//\"/}"
      if [[ "$BRANCH" == ${pattern}* ]]; then
        BYPASS="yes"
        break
      fi
    elif [[ "$line" =~ ^[^[:space:]] ]]; then
      in_bypass=0
    fi
  fi
done < "$CONFIG"

[[ "$BYPASS" == "yes" ]] && exit 0

# --- Get docs_path from config ---
DOCS_PATH=$(grep -E '^docs_path:' "$CONFIG" | head -1 | sed 's/docs_path:[[:space:]]*//' | tr -d "'\"")
DOCS_PATH="${DOCS_PATH:-docs/upstream}"
DOCS_PATH="${DOCS_PATH%/}"  # strip trailing slash

# --- Derive slug from branch name ---
SLUG=$(echo "$BRANCH" | sed 's|.*/||' | tr '[:upper:]' '[:lower:]' | tr '_' '-')

# --- Check for existing PRD ---
PRD_FOUND=0

# Match by filename slug
while IFS= read -r prd_file; do
  fname=$(basename "$prd_file" .md)
  if [[ "$fname" == *"$SLUG"* ]]; then
    PRD_FOUND=1
    break
  fi
done < <(ls "$DOCS_PATH"/PRD-*.md 2>/dev/null || true)

# Match by content if filename check failed
if [[ $PRD_FOUND -eq 0 ]]; then
  while IFS= read -r prd_file; do
    if grep -qiF "$SLUG" "$prd_file" 2>/dev/null || grep -qiF "$BRANCH" "$prd_file" 2>/dev/null; then
      PRD_FOUND=1
      break
    fi
  done < <(ls "$DOCS_PATH"/PRD-*.md 2>/dev/null || true)
fi

if [[ $PRD_FOUND -eq 0 ]]; then
  echo "UPSTREAM: feature detected without PRD. Invoke upstream-guard before continuing."
fi
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx bats tests/hook/upstream-check.bats
```

Expected: 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add templates/hooks/upstream-check.sh tests/hook/upstream-check.bats
git commit -m "feat: add upstream-check hook with bypass and PRD detection"
```

---

### Task 5: Skill Files

**Files:**

- Create: `templates/skills/upstream-guard.md`
- Create: `templates/skills/upstream-prd.md`
- Create: `templates/skills/upstream-adr.md`

No unit tests — these are instruction files for Claude Code. Verified via manual testing in Task 9.

- [ ] **Step 1: Create templates/skills/upstream-guard.md**

```markdown
---
name: upstream-guard
description: Validates PRD and ADR documentation before feature development. Auto-invoked by the upstream hook when a feature branch lacks a PRD.
---

You are the upstream guard. Your job: ensure documentation exists before development begins. You gate development on two artefacts: a PRD (what and why) and an ADR (how, for architectural decisions).

## Step 1 — Classify the request

Analyze three signals:
1. The user's prompt
2. Current git branch: run `git rev-parse --abbrev-ref HEAD`
3. Recent commits: run `git log --oneline -5`

Classify as one of:
- **feature**: new capability, endpoint, UI, integration, or user-facing behavior
- **bug**: fixing existing broken behavior with a clear expected state
- **fix**: non-breaking correction (typo, minor config, wording)
- **incident**: production issue requiring immediate action
- **chore**: dependency update, refactor without behavior change, CI/CD, tooling
- **ambiguous**: signals conflict or are too vague

**If ambiguous:** Ask the user directly — "Is this a new feature, a bug fix, or something else like a refactor or chore?" Wait for the answer before continuing.

**If NOT feature:** Respond: "This looks like a **[classification]**. No PRD required — development can proceed." Stop.

**If feature:** Continue to Step 2.

## Step 2 — Check for existing PRD

1. Read `upstream.config.yaml` to get `docs_path` (default: `docs/upstream/`) and `prd_required_fields`.
2. Derive a slug from the branch: take the segment after the last `/`, lowercase, replace `_` with `-`. Example: `feat/user-oauth-login` → `user-oauth-login`.
3. Search `<docs_path>/` for a file named `PRD-<slug>.md` or any `PRD-*.md` whose name contains the slug.
4. If no filename match, check if any PRD file's content contains the branch name or slug.

**If PRD found:**
- Read the file
- Check each field in `prd_required_fields` has non-empty content (not just a heading or comment)
- If any field is empty or missing: "PRD found but incomplete. Missing: **[field1]**, **[field2]**. Please fill these in — I can help if you'd like." Block until resolved.
- If all fields present: proceed to Step 3.

**If no PRD found:** Present these options exactly:

Check `docs_storage` from config, then present options. If `docs_storage: link`, show option 4 first and mark it as recommended.

```

No PRD found for this feature. Choose how to proceed:

1. **Import** — you have an existing document (Notion, Confluence, email, etc.) to bring in
2. **Interview** — I'll guide you through questions one at a time (~5 minutes)
3. **Auto-draft** — I'll generate a draft from available context for you to review
4. **Link** — your PRD lives in Notion, Confluence, or another tool; just share the URL

Which would you like? (1, 2, 3, or 4)

```markdown

Based on the choice, invoke `upstream-prd` with mode `import`, `interview`, `auto-draft`, or `link`. After it completes, return to Step 3.

## Step 3 — Check for ADR

1. Read `adr_triggers` from `upstream.config.yaml`.
2. Read the PRD content.
3. Evaluate whether the feature involves any of:
   - A configured `adr_triggers` entry
   - New third-party library or external service
   - Database schema changes (tables, columns, migrations)
   - Public API contract changes (new endpoints, changed response shapes)
   - Infrastructure changes (new cloud services, deployment topology)
   - Authentication or authorization logic changes
   - Any significant architectural choice with meaningful trade-offs

**If no trigger applies:** Note "No ADR required." and proceed to Step 4.

**If a trigger applies:**
- Search `<docs_path>/ADR-*.md` for a relevant ADR
- If found and it covers the decision: proceed to Step 4
- If not found: "This feature requires an ADR for **[reason]**. Invoking upstream-adr." Invoke `upstream-adr` with mode `interview` (unless the user specifies). After it completes, proceed to Step 4.

## Step 4 — Release

Respond:

```

Docs complete.

- PRD: `<docs_path>/PRD-<slug>.md` ✓
- ADR: `<docs_path>/ADR-NNN-<slug>.md` ✓   [or: not required]

Development can proceed.

```text

## Skip Flow

If the user asks to skip PRD or ADR creation at any point:

1. Respond: "Understood. To log this skip, I need a brief justification."
2. Wait for their justification.
3. Append to `<docs_path>/SKIPS.md` (create the file if absent):

```markdown

## Skip: [PRD|ADR] — [branch] — [YYYY-MM-DD]

**Reason:** [their justification]
```

1. Generate this PR snippet for them:

```markdown
> ⚠️ **upstream skip**: [PRD|ADR] not created for `[branch]`.
> **Reason:** [their justification]
> **Logged in:** `docs/upstream/SKIPS.md`
```

1. Respond: "Skip logged to `docs/upstream/SKIPS.md`. You can paste the above into your PR description. Development can proceed."

```text

- [ ] **Step 2: Create templates/skills/upstream-prd.md**

```markdown
---
name: upstream-prd
description: Creates a PRD via import, interactive interview, or auto-draft. Invoked by upstream-guard or directly.
---

You are creating a Product Requirements Document (PRD).

**Setup before any mode:**
1. Read `upstream.config.yaml` → get `docs_path` (default: `docs/upstream/`) and `prd_required_fields`.
2. Read template from `.claude/plugins/upstream/templates/PRD.md`.
3. Get current branch: `git rev-parse --abbrev-ref HEAD`
4. Derive slug: last segment after `/`, lowercase, `_` → `-`. Example: `feat/user-auth` → `user-auth`.

You will be invoked with a mode: `import`, `interview`, or `auto-draft`.

---

## Mode: import

Say: "Great. Paste your existing document, or describe it in as much detail as you have. It doesn't need to be formatted."

Wait for their input. Then:
1. Map their content to the PRD template fields.
2. For each field in `prd_required_fields` not covered, ask specifically: "Your document doesn't cover **[field_name]**. Can you tell me: [natural-language version of the field]?"
3. Assemble the complete PRD from the template.
4. Show it and say: "Here's the PRD. Anything to adjust?" Apply feedback.
5. Save (see Saving section).

---

## Mode: interview

Conduct a structured interview — one question at a time, wait for each answer.

**Q1:** "What problem does this feature solve? Be specific — who experiences it, and what's the current workaround or pain?"

*(After answer)*

**Q2:** "What does success look like? How will you know this is working? (Metrics, user behavior, or observable outcomes)"

*(After answer)*

**Q3:** "What is explicitly out of scope for this version? What are you deferring?"

*(After answer — check `prd_required_fields`. If additional required fields exist beyond these three, ask them one at a time. Then:)*

**Q-final:** "Any technical constraints, external dependencies, or known risks to include?"

After the last answer: "Thanks — let me put this together."

Assemble the PRD from the template with answers filled in. Show it: "Here's the PRD. Anything to adjust?" Apply feedback, then save.

---

## Mode: auto-draft

1. Run `git log --oneline -10` and `git diff --stat HEAD~3..HEAD 2>/dev/null || echo "no prior commits"`.
2. Generate a complete PRD draft from: the user's original prompt, the branch name, and the git context.
3. Show the draft: "Here's my draft PRD. Let me know what to change, or say 'looks good' to save."
4. Apply feedback until approved. Save.

---

## Mode: link

Ask: "What's the URL for your PRD? (Notion, Confluence, or any other tool)"

Wait for the URL. Then ask: "What's the title of this document?" (use branch slug as fallback if they skip).

Read `.claude/plugins/upstream/templates/PRD-link.md` and fill in: title, URL, branch, date.

Save the stub (see Saving). Do not ask further questions.

---

## Saving

If mode is `link`: read template from `.claude/plugins/upstream/templates/PRD-link.md`, fill fields, save stub.
Otherwise: save full PRD content.

Save to: `<docs_path>/PRD-<slug>.md`

After saving, say: "PRD saved to `<docs_path>/PRD-<slug>.md`."

If invoked from upstream-guard, add: "Returning to upstream-guard to check ADR requirements."
```

- [ ] **Step 3: Create templates/skills/upstream-adr.md**

```markdown
---
name: upstream-adr
description: Creates an ADR via import, interactive interview, or auto-draft. Invoked by upstream-guard when an architectural decision is detected.
---

You are creating an Architecture Decision Record (ADR).

**Setup before any mode:**
1. Read `upstream.config.yaml` → get `docs_path` (default: `docs/upstream/`).
2. Read template from `.claude/plugins/upstream/templates/ADR.md`.
3. Find next ADR number: list `<docs_path>/ADR-*.md`, extract the highest NNN from filenames, add 1. If none exist, start at 1. Zero-pad to 3 digits (001, 002...).
4. Get current branch: `git rev-parse --abbrev-ref HEAD`
5. Derive slug: last segment after `/`, lowercase, `_` → `-`.
6. Read `<docs_path>/PRD-<slug>.md` if it exists (for context).

You will be invoked with a mode (`import`, `interview`, or `auto-draft`) and a trigger reason.

---

## Mode: import

Say: "Please paste or describe your existing architecture decision document."

Map content to template fields. For uncovered fields, ask:
- "What alternatives did you consider?"
- "What are the trade-offs of the chosen approach vs. alternatives?"
- "What are the consequences — what gets easier, what gets harder?"

Assemble, show for review, apply feedback, save.

---

## Mode: interview

One question at a time.

**Q1:** "What is the architectural decision being made? Try stating it as: 'We will use X instead of Y for Z.'"

*(After answer)*

**Q2:** "What alternatives did you evaluate? List them briefly."

*(After answer)*

**Q3:** "Why did you choose your approach over the alternatives? What are the trade-offs?"

*(After answer)*

**Q4:** "What are the consequences of this decision? What gets easier? What gets harder? Any risks?"

Assemble ADR, show for review: "Here's the ADR. Anything to adjust?" Apply feedback, save.

---

## Mode: auto-draft

Generate from: the trigger reason, PRD content, branch name, and `git log --oneline -5`.

Show draft: "Here's my draft ADR for **[trigger reason]**. Let me know what to change, or say 'looks good' to save."

Apply feedback, save.

---

## Mode: link

Ask: "What's the URL for your ADR? (Notion, Confluence, or any other tool)"

Wait for the URL. Then ask: "What's the title of this ADR?" (use branch slug + trigger reason as fallback).

Read `.claude/plugins/upstream/templates/ADR-link.md` and fill in: title, URL, branch, date, trigger reason.

Save the stub (see Saving). Do not ask further questions.

---

## Saving

If mode is `link`: read template from `.claude/plugins/upstream/templates/ADR-link.md`, fill fields, save stub.
Otherwise: save full ADR content.

Save to: `<docs_path>/ADR-<NNN>-<slug>.md`

After saving: "ADR saved to `<docs_path>/ADR-<NNN>-<slug>.md`."

If invoked from upstream-guard: "Returning to upstream-guard."
```

- [ ] **Step 4: Commit**

```bash
git add templates/skills/
git commit -m "feat: add upstream-guard, upstream-prd, upstream-adr skill files"
```

---

### Task 6: Template Files and Default Config

**Files:**

- Create: `templates/templates/PRD.md`
- Create: `templates/templates/ADR.md`
- Create: `templates/templates/PRD-link.md`
- Create: `templates/templates/ADR-link.md`
- Create: `templates/upstream.config.yaml`

No tests — these are scaffolded into org repos and verified in integration test (Task 9).

- [ ] **Step 1: Create templates/templates/PRD.md**

```markdown
# PRD: [Feature Name]

**Branch:**
**Author:**
**Date:**
**Status:** Draft

---

## Problem Statement

<!-- What problem does this solve? Who experiences it, and what is their current workaround? -->

## Success Metrics

<!-- How will you know this is working? Be specific: numbers, behaviors, or observable outcomes. -->

## User Stories

<!-- As a [type of user], I want [capability], so that [outcome]. -->

- As a , I want , so that .

## Out of Scope

<!-- What is explicitly NOT included in this version? What is deferred? -->

## Technical Notes

<!-- Optional: constraints, dependencies, risks, open questions. -->
```

- [ ] **Step 2: Create templates/templates/ADR.md**

```markdown
# ADR-NNN: [Title]

**Date:**
**Status:** Proposed
**Deciders:**

---

## Context

<!-- What situation requires a decision? What forces are at play? -->

## Decision

<!-- State clearly: "We will use X for Y because Z." -->

## Alternatives Considered

### Alternative 1: [Name]

**Pros:**
**Cons:**

### Alternative 2: [Name]

**Pros:**
**Cons:**

## Trade-offs

<!-- What does the chosen approach do well? What does it sacrifice? -->

## Consequences

<!-- What changes as a result? What gets easier? What gets harder? -->
```

- [ ] **Step 3: Create templates/templates/PRD-link.md**

```markdown
# PRD: [title]

**Branch:** [branch]
**Date:** [date]
**Status:** Linked
**Storage:** external

---

**Document URL:** [url]

> This PRD lives in an external tool. The URL above is the authoritative source.
> Linked by upstream on [date] for branch `[branch]`.
```

- [ ] **Step 4: Create templates/templates/ADR-link.md**

```markdown
# ADR-NNN: [title]

**Branch:** [branch]
**Date:** [date]
**Status:** Linked
**Trigger:** [trigger_reason]
**Storage:** external

---

**Document URL:** [url]

> This ADR lives in an external tool. The URL above is the authoritative source.
> Linked by upstream on [date] for branch `[branch]`.
```

- [ ] **Step 5: Create templates/upstream.config.yaml**

```yaml
version: 1

# Branch prefixes that bypass upstream checks (bugs, hotfixes, chores)
bypass_for:
  - fix/
  - hotfix/
  - chore/
  - docs/

# Required PRD fields — upstream-guard blocks if any are missing
prd_required_fields:
  - problem_statement
  - success_metrics
  - out_of_scope

# Architectural triggers — any of these in the PRD requires an ADR
adr_triggers:
  - new_external_dependency
  - database_schema_change
  - api_breaking_change
  - infrastructure_change
  - auth_change

# Where PRDs, ADRs, and skip log are stored
docs_path: docs/upstream/

# 'local': full PRD/ADR content stored in this repo
# 'link': stub file with URL + metadata; actual doc lives in Notion/Confluence/etc.
docs_storage: local
```

- [ ] **Step 6: Commit**

```bash
git add templates/templates/ templates/upstream.config.yaml
git commit -m "feat: add PRD/ADR templates, link stubs, and default upstream.config.yaml"
```

---

### Task 7: `init` Command

**Files:**

- Modify: `src/commands/init.js`
- Create: `tests/integration/init.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/init.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, statSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { GENERATED_FILES } from '../../src/lib/scaffold.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-test-init'
const CLI = join(__dirname, '../../bin/upstream.js')

beforeEach(() => {
  mkdirSync(TARGET, { recursive: true })
  execSync('git init -q', { cwd: TARGET })
})
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream init', () => {
  it('creates all expected files', () => {
    execSync(`node ${CLI} init`, { cwd: TARGET })
    for (const f of GENERATED_FILES) {
      expect(existsSync(join(TARGET, f)), `${f} should exist`).toBe(true)
    }
    expect(existsSync(join(TARGET, 'upstream.config.yaml'))).toBe(true)
    expect(existsSync(join(TARGET, 'docs/upstream/.gitkeep'))).toBe(true)
  })

  it('makes the hook executable', () => {
    execSync(`node ${CLI} init`, { cwd: TARGET })
    const mode = statSync(join(TARGET, '.claude/hooks/upstream-check.sh')).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('exits with code 0', () => {
    expect(() => execSync(`node ${CLI} init`, { cwd: TARGET })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/integration/init.test.js 2>&1 | head -20
```

Expected: FAIL — init command is a stub

- [ ] **Step 3: Implement src/commands/init.js**

```js
import chalk from 'chalk'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { scaffoldInto } from '../lib/scaffold.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(__dirname, '../../templates')

export async function initCommand() {
  const target = process.cwd()
  console.log(chalk.blue('upstream:'), 'scaffolding into', target)

  try {
    await scaffoldInto(target, TEMPLATES)
    console.log(chalk.green('✓ upstream initialized'))
    console.log('')
    console.log('Next steps:')
    console.log('  1. Review and customize upstream.config.yaml')
    console.log('  2. git add .claude/ docs/ upstream.config.yaml')
    console.log('  3. git commit -m "feat: add upstream Claude Code plugin"')
    console.log('  4. Push — your team pulls it with the next git pull')
  } catch (err) {
    console.error(chalk.red('upstream init failed:'), err.message)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/integration/init.test.js
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.js tests/integration/init.test.js
git commit -m "feat: implement upstream init command"
```

---

### Task 8: `upgrade` Command

**Files:**

- Modify: `src/commands/upgrade.js`
- Create: `tests/integration/upgrade.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/upgrade.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-test-upgrade'
const CLI = join(__dirname, '../../bin/upstream.js')

beforeEach(() => {
  mkdirSync(TARGET, { recursive: true })
  execSync('git init -q', { cwd: TARGET })
  execSync(`node ${CLI} init`, { cwd: TARGET })
})
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream upgrade', () => {
  it('preserves existing upstream.config.yaml', () => {
    const configPath = join(TARGET, 'upstream.config.yaml')
    const custom = 'version: 1\ncustom_field: preserved\n'
    writeFileSync(configPath, custom)

    execSync(`node ${CLI} upgrade`, { cwd: TARGET })

    expect(readFileSync(configPath, 'utf8')).toBe(custom)
  })

  it('overwrites skill files with latest content', () => {
    const guardPath = join(TARGET, '.claude/plugins/upstream/skills/upstream-guard.md')
    writeFileSync(guardPath, '# stale content')

    execSync(`node ${CLI} upgrade`, { cwd: TARGET })

    const content = readFileSync(guardPath, 'utf8')
    expect(content).not.toBe('# stale content')
    expect(content).toContain('upstream-guard')
  })

  it('exits with code 0', () => {
    expect(() => execSync(`node ${CLI} upgrade`, { cwd: TARGET })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/integration/upgrade.test.js 2>&1 | head -20
```

Expected: FAIL — upgrade is a stub

- [ ] **Step 3: Implement src/commands/upgrade.js**

```js
import chalk from 'chalk'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { scaffoldInto } from '../lib/scaffold.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(__dirname, '../../templates')

export async function upgradeCommand() {
  const target = process.cwd()
  console.log(chalk.blue('upstream:'), 'upgrading skills and hook in', target)

  try {
    await scaffoldInto(target, TEMPLATES)
    console.log(chalk.green('✓ upstream upgraded'))
    console.log('')
    console.log('Review the diff and commit:')
    console.log('  git diff .claude/')
    console.log('  git add .claude/')
    console.log('  git commit -m "chore: upgrade upstream plugin"')
  } catch (err) {
    console.error(chalk.red('upstream upgrade failed:'), err.message)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/integration/upgrade.test.js
```

Expected: 3 tests PASS

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all unit + integration tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/upgrade.js tests/integration/upgrade.test.js
git commit -m "feat: implement upstream upgrade command"
```

---

### Task 9: Full Test Suite + Manual Smoke Test

**Files:**

- No new files — verification only

- [ ] **Step 1: Run full JS test suite**

```bash
npm test
```

Expected: all tests PASS (unit: config, scaffold, cli; integration: init, upgrade)

- [ ] **Step 2: Run hook tests**

```bash
npm run test:hook
```

Expected: 6 bats tests PASS

- [ ] **Step 3: Smoke test init in a temp repo**

```bash
SMOKE=/tmp/upstream-smoke-$(date +%s)
mkdir -p "$SMOKE" && cd "$SMOKE"
git init -q
node /Users/joaosmoura/dev/upstream/bin/upstream.js init
ls .claude/hooks/
ls .claude/plugins/upstream/skills/
ls .claude/plugins/upstream/templates/
cat upstream.config.yaml
ls docs/upstream/
```

Expected output:

- `upstream-check.sh` in `.claude/hooks/`
- `upstream-guard.md`, `upstream-prd.md`, `upstream-adr.md` in skills/
- `PRD.md`, `ADR.md` in templates/
- `upstream.config.yaml` with version/bypass_for/etc
- `.gitkeep` in docs/upstream/

- [ ] **Step 4: Verify hook is executable and runs**

```bash
cd "$SMOKE"
bash .claude/hooks/upstream-check.sh
echo "exit: $?"
```

Expected: exits 0 silently (no config yet triggers silent exit — wait, config WAS created by init)

Re-run after checking out a feature branch:

```bash
git checkout -b feat/test-feature -q 2>/dev/null || git switch -c feat/test-feature -q
bash .claude/hooks/upstream-check.sh
```

Expected: `UPSTREAM: feature detected without PRD. Invoke upstream-guard before continuing.`

- [ ] **Step 5: Smoke test upgrade preserves config**

```bash
cd "$SMOKE"
echo "custom: yes" >> upstream.config.yaml
node /Users/joaosmoura/dev/upstream/bin/upstream.js upgrade
grep "custom: yes" upstream.config.yaml && echo "config preserved ✓"
```

Expected: `config preserved ✓`

- [ ] **Step 6: Cleanup smoke dir**

```bash
rm -rf "$SMOKE"
```

- [ ] **Step 7: Final commit**

```bash
cd /Users/joaosmoura/dev/upstream
git add -p  # review any uncommitted changes
git status  # verify tree is clean
```

If clean:

```bash
git log --oneline
```

Expected: 8 commits from Tasks 1–8, all features implemented.

---

## Self-Review Against Spec

**Spec requirements → tasks:**

| Requirement | Task |
| --- | --- |
| `npx upstream init` scaffolds all files | Task 7 |
| `npx upstream upgrade` regenerates skills/hook, preserves config | Task 8 |
| Hook: exit silently if no config | Task 4 |
| Hook: exit silently on bypass branch | Task 4 |
| Hook: search docs_path for PRD | Task 4 |
| Hook: inject UPSTREAM message if no PRD | Task 4 |
| `upstream-guard`: classify request | Task 5 |
| `upstream-guard`: validate PRD required fields | Task 5 |
| `upstream-guard`: three PRD creation paths | Task 5 |
| `upstream-guard`: evaluate ADR triggers | Task 5 |
| `upstream-guard`: skip flow with SKIPS.md + PR snippet | Task 5 |
| `upstream-prd`: import / interview / auto-draft / link modes | Task 5 |
| `upstream-adr`: import / interview / auto-draft / link modes | Task 5 |
| `docs_storage: link` in config + skill behavior | Tasks 2, 5, 6 |
| PRD-link.md and ADR-link.md stub templates | Task 6 |
| ADR numbering (ADR-NNN-slug) | Task 5 |
| Default config template | Task 6 |
| PRD/ADR templates | Task 6 |
| Config reader with defaults + merge | Task 2 |
| Scaffold logic (file map, chmod hook) | Task 3 |

**Placeholder scan:** None found — all steps contain actual code, commands, or content.

**Type consistency:** `scaffoldInto(targetDir, templatesDir)` used consistently in Tasks 3, 7, and 8. `GENERATED_FILES` exported from `scaffold.js` and consumed in `init.test.js`. `readConfig(configPath)` exported from `config.js`, not used by commands (commands delegate to `scaffoldInto` which uses the bundled templates directly).
