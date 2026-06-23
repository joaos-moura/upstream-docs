# upstream-align Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upstream validate` command and `upstream-align` skill that verify implementation matches PRD/ADR content, triggered at pre-push (local) and PR creation (GitHub Actions).

**Architecture:** New `align:` config section controls `on_violation` (warn/block) and `base_branch` (auto-detect or explicit). `upstream validate` CLI tries `claude -p` with a self-contained analysis prompt; falls back to deterministic heuristics. GitHub Actions workflow scaffolded by `upstream init` calls `upstream validate` and posts a PR comment via `GITHUB_TOKEN`.

**Tech Stack:** Node.js ESM, vitest, chalk, js-yaml, `@inquirer/prompts`, native `fetch` (Node 18+)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/align/heuristics.js` | Deterministic scope-creep + dep analysis |
| Create | `src/lib/align/github.js` | Format and post PR comment via GitHub API |
| Create | `src/lib/align/prompt.js` | Build `claude -p` analysis prompt from PRD/ADR/diff |
| Create | `src/commands/validate.js` | `upstream validate` CLI command |
| Create | `tests/unit/align-heuristics.test.js` | Unit tests for heuristics |
| Create | `tests/unit/align-github.test.js` | Unit tests for comment formatting |
| Create | `tests/unit/align-prompt.test.js` | Unit tests for prompt building |
| Create | `tests/unit/validate.test.js` | Unit tests for validate command |
| Create | `.claude/plugins/upstream/skills/upstream-align.md` | Claude Code inline skill |
| Create | `templates/workflows/upstream-align.yml` | GH Actions workflow template |
| Modify | `src/lib/config.js` | Add `align` to `DEFAULT_CONFIG` |
| Modify | `src/lib/scaffold.js` | Add workflow to `FILE_MAP`, add `generateAlignConfig` |
| Modify | `src/lib/wizard.js` | Add align prompts to `runWizard` |
| Modify | `bin/upstream.js` | Register `validate` command |

---

## Task 1: Extend config with `align` defaults

**Files:**
- Modify: `src/lib/config.js`
- Test: `tests/unit/config.test.js`

- [ ] **Step 1: Write failing test for align defaults**

Add to `tests/unit/config.test.js`:

```js
it('includes align defaults', () => {
  const cfg = readConfig('/nonexistent/upstream.config.yaml')
  expect(cfg.align).toEqual({
    on_violation: 'warn',
    base_branch: 'auto',
    post_pr_comment: true,
  })
})

it('merges align section from file', () => {
  writeFileSync(join(TMP, 'upstream.config.yaml'), `
version: 1
align:
  on_violation: block
  base_branch: develop
`)
  const cfg = readConfig(join(TMP, 'upstream.config.yaml'))
  expect(cfg.align.on_violation).toBe('block')
  expect(cfg.align.base_branch).toBe('develop')
  expect(cfg.align.post_pr_comment).toBe(true)
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/config.test.js
```

Expected: FAIL — `cfg.align` is `undefined`

- [ ] **Step 3: Add `align` to `DEFAULT_CONFIG` in `src/lib/config.js`**

```js
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
  docs_storage: 'local',
  integrations: {},
  link_policy: {},
  align: {
    on_violation: 'warn',
    base_branch: 'auto',
    post_pr_comment: true,
  },
}

export function readConfig(configPath) {
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }
  const raw = readFileSync(configPath, 'utf8')
  const parsed = yaml.load(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_CONFIG }
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    align: { ...DEFAULT_CONFIG.align, ...(parsed.align ?? {}) },
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run tests/unit/config.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.js tests/unit/config.test.js
git commit -m "feat(config): add align defaults to DEFAULT_CONFIG"
```

---

## Task 2: `resolveBaseBranch` utility

**Files:**
- Create: `src/lib/git.js`
- Test: `tests/unit/git.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/git.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { execSync } from 'child_process'

vi.mock('child_process')

import { resolveBaseBranch } from '../../src/lib/git.js'

describe('resolveBaseBranch', () => {
  it('returns config value when not auto', () => {
    expect(resolveBaseBranch('develop')).toBe('develop')
    expect(resolveBaseBranch('trunk')).toBe('trunk')
  })

  it('reads symbolic-ref when auto', () => {
    execSync.mockReturnValue('refs/remotes/origin/main\n')
    expect(resolveBaseBranch('auto')).toBe('main')
  })

  it('falls back to main when symbolic-ref fails', () => {
    execSync.mockImplementation(() => { throw new Error('not a git repo') })
    expect(resolveBaseBranch('auto')).toBe('main')
  })

  it('falls back to main when auto not set', () => {
    execSync.mockImplementation(() => { throw new Error() })
    expect(resolveBaseBranch(undefined)).toBe('main')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/git.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/lib/git.js`**

```js
import { execSync } from 'child_process'

export function resolveBaseBranch(configBase) {
  if (configBase && configBase !== 'auto') return configBase
  try {
    return execSync('git symbolic-ref refs/remotes/origin/HEAD', { encoding: 'utf8', stdio: 'pipe' })
      .trim()
      .replace('refs/remotes/origin/', '')
  } catch {
    return 'main'
  }
}

export function getCurrentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim()
}

export function getDiff(baseBranch, maxBytes = 10 * 1024 * 1024) {
  try {
    return execSync(`git diff ${baseBranch}...HEAD`, {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: maxBytes,
    })
  } catch {
    return ''
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run tests/unit/git.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/git.js tests/unit/git.test.js
git commit -m "feat(git): add resolveBaseBranch, getCurrentBranch, getDiff utilities"
```

---

## Task 3: Heuristics module

**Files:**
- Create: `src/lib/align/heuristics.js`
- Test: `tests/unit/align-heuristics.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/align-heuristics.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  parseOutOfScope,
  checkScopeCreep,
  parseNewDeps,
  checkNewDepsInAdr,
  runHeuristics,
} from '../../src/lib/align/heuristics.js'

describe('parseOutOfScope', () => {
  it('extracts bullet items from out_of_scope section', () => {
    const prd = `## Problem Statement\nFoo\n\n## Out of Scope\n- billing integration\n- admin dashboard\n\n## Success Metrics\nBar`
    expect(parseOutOfScope(prd)).toEqual(['billing integration', 'admin dashboard'])
  })

  it('returns empty array when section absent', () => {
    expect(parseOutOfScope('## Problem Statement\nFoo')).toEqual([])
  })
})

describe('checkScopeCreep', () => {
  it('flags paths matching out-of-scope keywords', () => {
    const items = ['billing integration', 'admin dashboard']
    const paths = ['src/billing/invoice.js', 'src/auth/login.js']
    const findings = checkScopeCreep(items, paths)
    expect(findings).toHaveLength(1)
    expect(findings[0].path).toBe('src/billing/invoice.js')
  })

  it('returns empty when no match', () => {
    expect(checkScopeCreep(['billing'], ['src/auth/login.js'])).toHaveLength(0)
  })
})

describe('parseNewDeps', () => {
  it('extracts added package names from package.json diff', () => {
    const diff = `diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1,5 +1,6 @@\n {\n   "dependencies": {\n+    "axios": "^1.0.0",\n     "chalk": "^5.0.0"\n   }\n }`
    expect(parseNewDeps(diff)).toContain('axios')
    expect(parseNewDeps(diff)).not.toContain('chalk')
  })

  it('returns empty for no package.json changes', () => {
    expect(parseNewDeps('diff --git a/src/foo.js b/src/foo.js\n+const x = 1')).toHaveLength(0)
  })
})

describe('checkNewDepsInAdr', () => {
  it('returns deps not mentioned in ADR', () => {
    const adr = 'We decided to use axios for HTTP requests.'
    expect(checkNewDepsInAdr(['axios', 'lodash'], adr)).toEqual(['lodash'])
  })
})

describe('runHeuristics', () => {
  it('returns aligned when no issues found', () => {
    const result = runHeuristics('## Out of Scope\n- billing\n', '', 'diff --git a/src/auth.js b/src/auth.js\n+const x = 1')
    expect(result.verdict).toBe('aligned')
    expect(result.engine).toBe('heuristic')
  })

  it('returns warning for scope creep', () => {
    const diff = 'diff --git a/src/billing/invoice.js b/src/billing/invoice.js\n+const x = 1'
    const result = runHeuristics('## Out of Scope\n- billing\n', '', diff)
    expect(result.verdict).toBe('warning')
    expect(result.findings.some(f => f.dimension === 'out_of_scope')).toBe(true)
  })

  it('returns misaligned for undocumented deps', () => {
    const diff = 'diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n+    "lodash": "^4.0.0",\n'
    const result = runHeuristics('', 'We use axios only.', diff)
    expect(result.verdict).toBe('misaligned')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/align-heuristics.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/lib/align/heuristics.js`**

```js
export function parseOutOfScope(prdContent) {
  const match = prdContent.match(/##\s*out[_\s-]*of[_\s-]*scope\s*\n([\s\S]*?)(?=\n##|$)/i)
  if (!match) return []
  return match[1]
    .split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

export function checkScopeCreep(outOfScopeItems, diffPaths) {
  const findings = []
  for (const item of outOfScopeItems) {
    const keywords = item.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    for (const path of diffPaths) {
      if (keywords.some(kw => path.toLowerCase().includes(kw))) {
        findings.push({ path, outOfScopeItem: item })
      }
    }
  }
  return findings
}

export function parseNewDeps(packageJsonDiff) {
  const pkgSection = packageJsonDiff.match(/diff --git a\/package\.json[\s\S]*?(?=diff --git|$)/)?.[0] ?? ''
  return pkgSection
    .split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1).match(/"([^"@][^"]+)":\s*"[^"]*"/)?.[1])
    .filter(Boolean)
}

export function checkNewDepsInAdr(newDeps, adrContent) {
  return newDeps.filter(dep => !adrContent.toLowerCase().includes(dep.toLowerCase()))
}

export function runHeuristics(prdContent, adrContent, diff) {
  const diffPaths = diff
    .split('\n')
    .filter(l => l.startsWith('diff --git'))
    .map(l => l.match(/b\/(.*)/)?.[1] ?? '')
    .filter(Boolean)

  const outOfScopeItems = parseOutOfScope(prdContent)
  const scopeCreepFindings = checkScopeCreep(outOfScopeItems, diffPaths)

  const newDeps = parseNewDeps(diff)
  const undocumentedDeps = adrContent ? checkNewDepsInAdr(newDeps, adrContent) : []

  const findings = []

  if (outOfScopeItems.length > 0) {
    findings.push({
      dimension: 'out_of_scope',
      status: scopeCreepFindings.length > 0 ? 'warning' : 'pass',
      detail: scopeCreepFindings.length > 0
        ? scopeCreepFindings.map(f => `\`${f.path}\` matches "${f.outOfScopeItem}"`).join('; ')
        : null,
    })
  }

  if (newDeps.length > 0) {
    findings.push({
      dimension: 'new_dependencies',
      status: undocumentedDeps.length > 0 ? 'fail' : 'pass',
      detail: undocumentedDeps.length > 0
        ? `New deps not in ADR: ${undocumentedDeps.join(', ')}`
        : null,
    })
  }

  const verdict = findings.some(f => f.status === 'fail')
    ? 'misaligned'
    : findings.some(f => f.status === 'warning')
      ? 'warning'
      : 'aligned'

  return { engine: 'heuristic', findings, verdict }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/align-heuristics.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/align/heuristics.js tests/unit/align-heuristics.test.js
git commit -m "feat(align): add heuristic analysis module for scope creep and dep checking"
```

---

## Task 4: GitHub comment module

**Files:**
- Create: `src/lib/align/github.js`
- Test: `tests/unit/align-github.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/align-github.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { formatComment } from '../../src/lib/align/github.js'

const ALIGNED_RESULT = {
  engine: 'llm',
  prdPath: 'docs/upstream/PRD-user-auth.md',
  adrPath: 'docs/upstream/ADR-001-user-auth.md',
  findings: [
    { dimension: 'problem_statement', status: 'pass', detail: null },
    { dimension: 'success_metrics', status: 'pass', detail: null },
    { dimension: 'out_of_scope', status: 'pass', detail: null },
  ],
  verdict: 'aligned',
  summary: 'Implementation matches PRD and ADR.',
}

const MISALIGNED_RESULT = {
  engine: 'heuristic',
  prdPath: 'docs/upstream/PRD-user-auth.md',
  adrPath: null,
  findings: [
    { dimension: 'out_of_scope', status: 'warning', detail: '`src/billing/invoice.js` matches "billing"' },
    { dimension: 'new_dependencies', status: 'fail', detail: 'New deps not in ADR: lodash' },
  ],
  verdict: 'misaligned',
  summary: 'Scope creep and undocumented dependency detected.',
}

describe('formatComment', () => {
  it('includes PRD path in header', () => {
    const comment = formatComment(ALIGNED_RESULT)
    expect(comment).toContain('docs/upstream/PRD-user-auth.md')
  })

  it('shows ✅ for aligned verdict', () => {
    const comment = formatComment(ALIGNED_RESULT)
    expect(comment).toContain('ALIGNED')
  })

  it('shows ❌ for misaligned verdict', () => {
    const comment = formatComment(MISALIGNED_RESULT)
    expect(comment).toContain('MISALIGNED')
  })

  it('includes finding details', () => {
    const comment = formatComment(MISALIGNED_RESULT)
    expect(comment).toContain('src/billing/invoice.js')
    expect(comment).toContain('lodash')
  })

  it('notes heuristic engine when LLM unavailable', () => {
    const comment = formatComment(MISALIGNED_RESULT)
    expect(comment).toContain('heuristic')
  })

  it('shows ADR path when present', () => {
    const comment = formatComment(ALIGNED_RESULT)
    expect(comment).toContain('docs/upstream/ADR-001-user-auth.md')
  })

  it('omits ADR row when null', () => {
    const comment = formatComment(MISALIGNED_RESULT)
    expect(comment).not.toContain('**ADR:**')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/align-github.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/lib/align/github.js`**

```js
const STATUS_ICON = { pass: '✅', warning: '⚠️', fail: '❌' }
const VERDICT_LABEL = { aligned: '✅ ALIGNED', warning: '⚠️ WARNING', misaligned: '❌ MISALIGNED' }

export function formatComment(result) {
  const lines = ['## upstream alignment check', '']

  lines.push(`**PRD:** ${result.prdPath}`)
  if (result.adrPath) lines.push(`**ADR:** ${result.adrPath}`)
  lines.push('')

  lines.push('| Check | Status | Detail |')
  lines.push('|-------|--------|--------|')
  for (const f of result.findings) {
    const icon = STATUS_ICON[f.status] ?? '—'
    lines.push(`| ${f.dimension.replace(/_/g, ' ')} | ${icon} | ${f.detail ?? ''} |`)
  }

  lines.push('')
  lines.push(`**Verdict: ${VERDICT_LABEL[result.verdict] ?? result.verdict}**`)

  if (result.summary) {
    lines.push('')
    lines.push(`> ${result.summary}`)
  }

  if (result.engine === 'heuristic') {
    lines.push('')
    lines.push('> _Analysis via heuristic fallback (claude not available in this runner). Run `upstream validate` locally for full LLM analysis._')
  }

  lines.push('')
  lines.push('<details><summary>How to resolve misalignments</summary>')
  lines.push('')
  lines.push('Update the PRD/ADR to reflect the new decisions, or adjust the implementation to match the documented plan. Run `upstream validate` locally for details.')
  lines.push('')
  lines.push('</details>')

  return lines.join('\n')
}

export async function postPrComment(result, env) {
  const { GITHUB_TOKEN, GITHUB_PR_NUMBER, GITHUB_REPOSITORY } = env
  if (!GITHUB_TOKEN || !GITHUB_PR_NUMBER || !GITHUB_REPOSITORY) return

  const [owner, repo] = GITHUB_REPOSITORY.split('/')
  const body = formatComment(result)

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${GITHUB_PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub API error ${response.status}: ${text}`)
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/align-github.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/align/github.js tests/unit/align-github.test.js
git commit -m "feat(align): add comment formatting and GitHub PR comment posting"
```

---

## Task 5: LLM analysis prompt builder

**Files:**
- Create: `src/lib/align/prompt.js`
- Test: `tests/unit/align-prompt.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/align-prompt.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildAnalysisPrompt, parseAnalysisResponse } from '../../src/lib/align/prompt.js'

describe('buildAnalysisPrompt', () => {
  it('includes PRD content', () => {
    const prompt = buildAnalysisPrompt('PRD content here', null, 'diff content')
    expect(prompt).toContain('PRD content here')
  })

  it('includes ADR section when present', () => {
    const prompt = buildAnalysisPrompt('PRD', 'ADR content', 'diff')
    expect(prompt).toContain('ADR content')
  })

  it('truncates diff over 50k chars', () => {
    const bigDiff = 'x'.repeat(60000)
    const prompt = buildAnalysisPrompt('PRD', null, bigDiff)
    expect(prompt).not.toContain(bigDiff)
    expect(prompt).toContain('[diff truncated')
  })

  it('asks for JSON output', () => {
    const prompt = buildAnalysisPrompt('PRD', null, 'diff')
    expect(prompt).toContain('JSON')
  })
})

describe('parseAnalysisResponse', () => {
  it('parses valid JSON response', () => {
    const json = JSON.stringify({
      findings: [{ dimension: 'problem_statement', status: 'pass', detail: null }],
      verdict: 'aligned',
      summary: 'All good.',
    })
    const result = parseAnalysisResponse(json)
    expect(result.verdict).toBe('aligned')
    expect(result.findings).toHaveLength(1)
  })

  it('extracts JSON from markdown code block', () => {
    const response = '```json\n{"findings":[],"verdict":"aligned","summary":"ok"}\n```'
    const result = parseAnalysisResponse(response)
    expect(result.verdict).toBe('aligned')
  })

  it('returns null for invalid JSON', () => {
    expect(parseAnalysisResponse('not json at all')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/align-prompt.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/lib/align/prompt.js`**

```js
const MAX_DIFF_CHARS = 50_000

export function buildAnalysisPrompt(prdContent, adrContent, diff) {
  const truncatedDiff = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + `\n\n[diff truncated — ${diff.length} total chars, showing first ${MAX_DIFF_CHARS}]`
    : diff

  const adrSection = adrContent
    ? `## Architecture Decision Record\n\n${adrContent}`
    : '## Architecture Decision Record\n\nNone provided.'

  return `You are an alignment checker. Compare the git diff (implementation) against the PRD and ADR.

## Product Requirements Document

${prdContent}

${adrSection}

## Git Diff (feature branch vs base)

\`\`\`diff
${truncatedDiff}
\`\`\`

Analyze alignment across these dimensions:
- problem_statement: Does the diff address the problem described in the PRD?
- success_metrics: Are the PRD success metrics addressed by the implementation?
- out_of_scope: Does the diff touch areas explicitly marked out of scope in the PRD?
- adr_decisions: Does the implementation follow the decisions recorded in the ADR?
- new_dependencies: Are new dependencies in the diff documented in the ADR?

Output ONLY valid JSON with no other text:
{
  "findings": [
    { "dimension": "problem_statement", "status": "pass|warning|fail", "detail": "explanation or null" }
  ],
  "verdict": "aligned|warning|misaligned",
  "summary": "one sentence summary"
}`
}

export function parseAnalysisResponse(text) {
  try {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const raw = codeBlock ? codeBlock[1].trim() : text.trim()
    const parsed = JSON.parse(raw)
    if (!parsed.findings || !parsed.verdict) return null
    return parsed
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/align-prompt.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/align/prompt.js tests/unit/align-prompt.test.js
git commit -m "feat(align): add LLM analysis prompt builder and response parser"
```

---

## Task 6: `upstream validate` CLI command

**Files:**
- Create: `src/commands/validate.js`
- Test: `tests/unit/validate.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/validate.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

vi.mock('child_process')
vi.mock('../../src/lib/align/github.js', () => ({ postPrComment: vi.fn(), formatComment: vi.fn(() => '') }))

import { execSync, spawnSync } from 'child_process'
import { validateCommand } from '../../src/commands/validate.js'

const TMP = '/tmp/upstream-test-validate'

beforeEach(() => {
  mkdirSync(join(TMP, 'docs/upstream'), { recursive: true })
  execSync.mockReturnValue('feat/user-auth\n')
  writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')
})
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('validateCommand', () => {
  it('exits 0 when no PRD found (skip mode)', async () => {
    const result = await validateCommand({ outputFormat: 'json' }, TMP)
    expect(result.skipped).toBe(true)
  })

  it('exits 0 on aligned result in warn mode', async () => {
    writeFileSync(join(TMP, 'docs/upstream/PRD-user-auth.md'), '## Problem Statement\nAuth\n## Success Metrics\nLogin works\n## Out of Scope\n- billing\n')
    spawnSync.mockReturnValue({ status: 1, error: new Error('not found') })
    execSync.mockImplementation(cmd => {
      if (cmd.includes('rev-parse')) return 'feat/user-auth\n'
      if (cmd.includes('symbolic-ref')) return 'refs/remotes/origin/main\n'
      if (cmd.includes('diff')) return ''
      return ''
    })
    const result = await validateCommand({ outputFormat: 'json' }, TMP)
    expect(result.verdict).toBeDefined()
    expect(result.engine).toBe('heuristic')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/validate.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/commands/validate.js`**

```js
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getSlug, scanDocs, classifyFile } from '../lib/docs.js'
import { getCurrentBranch, resolveBaseBranch, getDiff } from '../lib/git.js'
import { runHeuristics } from '../lib/align/heuristics.js'
import { buildAnalysisPrompt, parseAnalysisResponse } from '../lib/align/prompt.js'
import { formatComment, postPrComment } from '../lib/align/github.js'

function tryClaudeAnalysis(prdContent, adrContent, diff) {
  const prompt = buildAnalysisPrompt(prdContent, adrContent, diff)
  const result = spawnSync('claude', ['-p', prompt], {
    encoding: 'utf8',
    timeout: 90_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0) return null
  return parseAnalysisResponse(result.stdout ?? '')
}

export async function validateCommand({ outputFormat = 'human', base = null } = {}, cwd = process.cwd()) {
  let branch
  try {
    branch = getCurrentBranch()
  } catch {
    console.error(chalk.red('upstream validate: not a git repository'))
    process.exit(1)
  }

  const configPath = join(cwd, 'upstream.config.yaml')
  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  if (!existsSync(docsPath)) {
    const skipped = { skipped: true, reason: 'docs path not found' }
    if (outputFormat === 'json') console.log(JSON.stringify(skipped, null, 2))
    else console.log(chalk.yellow('upstream validate: docs path not found — skipping alignment check'))
    return skipped
  }

  const slug = getSlug(branch)
  const matched = scanDocs(docsPath, branch, slug)

  let prdFile = null
  let adrFile = null
  for (const f of matched) {
    const type = classifyFile(join(docsPath, f))
    if (type === 'prd' && !prdFile) prdFile = f
    if (type === 'adr' && !adrFile) adrFile = f
  }

  if (!prdFile) {
    const skipped = { skipped: true, reason: 'no PRD found for this branch' }
    if (outputFormat === 'json') console.log(JSON.stringify(skipped, null, 2))
    else console.log(chalk.yellow('upstream validate: no PRD found — skipping alignment check'))
    return skipped
  }

  const prdContent = readFileSync(join(docsPath, prdFile), 'utf8')
  const adrContent = adrFile ? readFileSync(join(docsPath, adrFile), 'utf8') : null

  const baseBranch = base ?? resolveBaseBranch(config.align?.base_branch)
  const diff = getDiff(baseBranch)

  let analysisResult = tryClaudeAnalysis(prdContent, adrContent ?? '', diff)
  if (!analysisResult) {
    analysisResult = runHeuristics(prdContent, adrContent ?? '', diff)
  } else {
    analysisResult.engine = 'llm'
  }

  const result = {
    ...analysisResult,
    prdPath: join(config.docs_path, prdFile),
    adrPath: adrFile ? join(config.docs_path, adrFile) : null,
  }

  if (outputFormat === 'json') {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(chalk.bold('\nupstream alignment check\n'))
    console.log(`Branch:  ${branch}`)
    console.log(`PRD:     ${result.prdPath}`)
    if (result.adrPath) console.log(`ADR:     ${result.adrPath}`)
    console.log(`Engine:  ${result.engine}\n`)
    for (const f of result.findings) {
      const icon = f.status === 'pass' ? chalk.green('✅') : f.status === 'warning' ? chalk.yellow('⚠️') : chalk.red('❌')
      console.log(`${icon}  ${f.dimension.replace(/_/g, ' ')}${f.detail ? ` — ${f.detail}` : ''}`)
    }
    console.log()
    const verdictColor = result.verdict === 'aligned' ? chalk.green : result.verdict === 'warning' ? chalk.yellow : chalk.red
    console.log(verdictColor(`Verdict: ${result.verdict.toUpperCase()}`))
    if (result.summary) console.log(`\n${result.summary}`)
  }

  if (config.align?.post_pr_comment !== false) {
    try {
      await postPrComment(result, process.env)
    } catch {
      // Non-fatal — comment posting failure should not block validate
    }
  }

  const shouldBlock = config.align?.on_violation === 'block' && result.verdict === 'misaligned'
  if (shouldBlock) process.exit(1)

  return result
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/validate.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/validate.js tests/unit/validate.test.js
git commit -m "feat(validate): add upstream validate CLI command"
```

---

## Task 7: Wire `validate` into CLI entry

**Files:**
- Modify: `bin/upstream.js`

- [ ] **Step 1: Add import and command registration to `bin/upstream.js`**

Add after the `listCommand` import:

```js
import { validateCommand } from '../src/commands/validate.js'
```

Add after the `list` command block:

```js
program
  .command('validate')
  .description('Check alignment between implementation and PRD/ADR')
  .option('--output <format>', 'output format: human or json', 'human')
  .option('--base <branch>', 'base branch for diff (overrides config)')
  .action((opts) => validateCommand({ outputFormat: opts.output, base: opts.base ?? null }))
```

- [ ] **Step 2: Smoke test**

```bash
node bin/upstream.js validate --help
```

Expected output includes:
```
Usage: upstream validate [options]

Check alignment between implementation and PRD/ADR

Options:
  --output <format>   output format: human or json (default: "human")
  --base <branch>     base branch for diff (overrides config)
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add bin/upstream.js
git commit -m "feat(cli): register upstream validate command"
```

---

## Task 8: `upstream-align` skill

**Files:**
- Create: `templates/skills/upstream-align.md` (canonical source — scaffold copies this to `.claude/`)
- Create: `.claude/plugins/upstream/skills/upstream-align.md` (local dev copy, same content)

> The `FILE_MAP` in `scaffold.js` copies from `templates/skills/` → `.claude/plugins/upstream/skills/`. Create the file at the template source path; then copy it locally for dev use.

- [ ] **Step 1: Create the skill file at the template source**

```bash
cat > templates/skills/upstream-align.md << 'SKILL'
---
name: upstream-align
description: Validates that the current implementation aligns with the PRD and ADR for this branch. Checks problem coverage, success metrics, scope creep, ADR decisions, and new dependencies.
---

You are the upstream alignment checker. Your job: compare what was built (git diff) against what was planned (PRD and ADR).

## Step 1 — Load config and find docs

1. Read `upstream.config.yaml` → `docs_path`, `align.on_violation`, `align.base_branch`
2. Run `git rev-parse --abbrev-ref HEAD` → derive slug (segment after last `/`)
3. Find `PRD-<slug>.md` in `<docs_path>/` — if not found, respond: "No PRD found for this branch — skipping alignment check." Stop.
4. Find `ADR-*.md` in `<docs_path>/` matching the slug — optional

## Step 2 — Fetch document content

- For `docs_storage: local`: read the file directly
- For `docs_storage: link`: read the stub file, extract the URL, fetch the document via the appropriate provider (Google Docs or Confluence). If fetch fails, note "external doc unavailable — using stub only" and continue with stub content.

## Step 3 — Get the diff

Run: `git diff <base_branch>...HEAD`

Where `<base_branch>` is resolved as:
- If `align.base_branch` is set and not `auto`: use that value
- If `auto` or unset: run `git symbolic-ref refs/remotes/origin/HEAD`, strip `refs/remotes/origin/` prefix. Fall back to `main` if the command fails.

If the diff is very large (>500 lines), summarize changed files and note you're working from a summary.

## Step 4 — Analyze alignment

Evaluate each dimension:

**problem_statement** — Does the diff address the problem described in the PRD? Look for code that implements the core behavior described.

**success_metrics** — Does the diff include implementation corresponding to each success metric listed in the PRD? A metric with no implementation is a gap.

**out_of_scope** — Does the diff modify files or add functionality explicitly listed in the `out_of_scope` section of the PRD? Flag each match.

**adr_decisions** (skip if no ADR) — For each architectural decision in the ADR, does the implementation follow it? Example: ADR says "use PostgreSQL" → check for SQLite or other DB code.

**new_dependencies** (skip if no ADR) — Are new packages added (in `package.json`, `requirements.txt`, `go.mod`, etc.) mentioned in the ADR? Flag undocumented additions.

## Step 5 — Report findings

Format the results as a table:

```
upstream alignment check

PRD: <path>
ADR: <path or "not required">

| Check              | Status | Detail                          |
|--------------------|--------|---------------------------------|
| problem_statement  | ✅     |                                 |
| success_metrics    | ✅     | 3/3 addressed                   |
| out_of_scope       | ⚠️    | src/billing/invoice.js touched  |
| adr_decisions      | ❌     | ADR mandates JWT, code uses sessions |
| new_dependencies   | ✅     |                                 |

Verdict: MISALIGNED — 2 issue(s) found.
```

## Step 6 — Apply policy

- If `align.on_violation: warn` (default): show findings, do NOT block. Offer to help resolve.
- If `align.on_violation: block`: show findings. State: "Development is blocked until alignment issues are resolved. Update the PRD/ADR or adjust the implementation."

## Resolving findings

For each ❌ or ⚠️ finding, offer the developer two options:
1. "Update the PRD/ADR to reflect the actual decisions made"
2. "Show me what code to change to align with the PRD/ADR"

Invoke `upstream-prd` or `upstream-adr` if the developer wants to update the docs.
SKILL
```

- [ ] **Step 2: Copy to local `.claude/` for dev use**

```bash
cp templates/skills/upstream-align.md .claude/plugins/upstream/skills/upstream-align.md
```

- [ ] **Step 3: Verify both files exist**

```bash
head -3 templates/skills/upstream-align.md
head -3 .claude/plugins/upstream/skills/upstream-align.md
```

Expected both:
```
---
name: upstream-align
```

- [ ] **Step 4: Commit**

```bash
git add templates/skills/upstream-align.md .claude/plugins/upstream/skills/upstream-align.md
git commit -m "feat(skill): add upstream-align Claude Code skill"
```

---

## Task 9: GH Actions workflow template + scaffold integration

**Files:**
- Create: `templates/workflows/upstream-align.yml`
- Modify: `src/lib/scaffold.js`
- Test: `tests/unit/scaffold.test.js` (extend existing)

- [ ] **Step 1: Create workflow template**

```bash
mkdir -p templates/workflows
```

Create `templates/workflows/upstream-align.yml`:

```yaml
name: upstream alignment check

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  align:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install upstream
        run: npm install -g upstream-docs

      - name: Run alignment check
        run: upstream validate --output json
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_PR_NUMBER: ${{ github.event.pull_request.number }}
          GITHUB_REPOSITORY: ${{ github.repository }}
```

- [ ] **Step 2: Write failing scaffold test**

Add to `tests/unit/scaffold.test.js`:

```js
it('scaffolds upstream-align workflow when align enabled in answers', async () => {
  await scaffoldInto(TMP, TEMPLATES, { ...BASE_ANSWERS, align: { on_violation: 'warn', base_branch: 'auto' } })
  expect(existsSync(join(TMP, '.github/workflows/upstream-align.yml'))).toBe(true)
})

it('does not scaffold workflow when align absent from answers', async () => {
  await scaffoldInto(TMP, TEMPLATES, BASE_ANSWERS)
  expect(existsSync(join(TMP, '.github/workflows/upstream-align.yml'))).toBe(false)
})
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx vitest run tests/unit/scaffold.test.js
```

Expected: FAIL

- [ ] **Step 4: Update `src/lib/scaffold.js` to scaffold the workflow**

Add the `upstream-align` skill to `FILE_MAP`:

```js
const FILE_MAP = [
  [HOOK_SRC,                          '.claude/hooks/upstream-check.sh'],
  ['skills/upstream-guard.md',        '.claude/plugins/upstream/skills/upstream-guard.md'],
  ['skills/upstream-prd.md',          '.claude/plugins/upstream/skills/upstream-prd.md'],
  ['skills/upstream-adr.md',          '.claude/plugins/upstream/skills/upstream-adr.md'],
  ['skills/upstream-align.md',        '.claude/plugins/upstream/skills/upstream-align.md'],
  ['templates/PRD.md',                '.claude/plugins/upstream/templates/PRD.md'],
  ['templates/ADR.md',                '.claude/plugins/upstream/templates/ADR.md'],
]
```

Add workflow scaffolding at the end of `scaffoldInto`:

```js
  if (answers?.align) {
    const workflowSrc = join(templatesDir, 'workflows/upstream-align.yml')
    const workflowDest = join(targetDir, '.github/workflows/upstream-align.yml')
    await mkdir(dirname(workflowDest), { recursive: true })
    await copyFile(workflowSrc, workflowDest)
  }
```

- [ ] **Step 5: Update `generateConfig` to include `align` section**

In `generateConfig` in `src/lib/scaffold.js`, add after the `docs_storage` line:

```js
  if (answers.align) {
    config.align = {
      on_violation: answers.align.on_violation ?? 'warn',
      base_branch: answers.align.base_branch ?? 'auto',
      post_pr_comment: true,
    }
  }
```

- [ ] **Step 6: Run scaffold tests**

```bash
npx vitest run tests/unit/scaffold.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add templates/workflows/upstream-align.yml src/lib/scaffold.js tests/unit/scaffold.test.js
git commit -m "feat(scaffold): add upstream-align workflow template and scaffold integration"
```

---

## Task 10: `upstream init` wizard updates

**Files:**
- Modify: `src/lib/wizard.js`
- Test: `tests/unit/wizard.test.js` (extend existing)

- [ ] **Step 1: Write failing test**

Add to `tests/unit/wizard.test.js`:

```js
it('includes align section when user enables it', async () => {
  // Mock confirm to return true for align, select to return 'warn'
  confirm.mockResolvedValueOnce(false) // configure org defaults: no
  confirm.mockResolvedValueOnce(true)  // enable alignment checks: yes
  select.mockResolvedValueOnce('warn') // on_violation: warn
  input.mockResolvedValueOnce('')      // base_branch: accept default (auto)

  const answers = await runWizard({ docs_storage: 'local', docs_path: 'docs/upstream/', providers: [], guardian: '' })
  expect(answers.align).toEqual({ on_violation: 'warn', base_branch: 'auto' })
})

it('sets align to null when user disables it', async () => {
  confirm.mockResolvedValueOnce(false) // configure org defaults: no
  confirm.mockResolvedValueOnce(false) // enable alignment checks: no

  const answers = await runWizard({ docs_storage: 'local', docs_path: 'docs/upstream/', providers: [], guardian: '' })
  expect(answers.align).toBeNull()
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/wizard.test.js
```

Expected: FAIL

- [ ] **Step 3: Add align prompts to `runWizard` in `src/lib/wizard.js`**

Add before the final `return` statement:

```js
  let align = prefilled.align !== undefined ? prefilled.align : null

  if (align === null && process.stdin.isTTY) {
    const enableAlign = await confirm({
      message: 'Enable alignment checks? (pre-push + automatic PR comments)',
      default: true,
    })

    if (enableAlign) {
      const onViolation = await select({
        message: 'On alignment violation:',
        choices: [
          { value: 'warn', name: 'warn — show findings but allow push/PR' },
          { value: 'block', name: 'block — prevent push and fail the PR check' },
        ],
      })

      const baseBranchInput = await input({
        message: 'Base branch for diff (leave blank to auto-detect):',
        default: '',
      })

      align = {
        on_violation: onViolation,
        base_branch: baseBranchInput.trim() || 'auto',
      }
    }
  }

  return { docs_storage, docs_path, providers, guardian, ...orgDefaults, align }
```

- [ ] **Step 4: Run wizard tests**

```bash
npx vitest run tests/unit/wizard.test.js
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 6: Also add `ANTHROPIC_API_KEY` env placeholder when align enabled**

In `src/commands/init.js`, in the section that calls `ensureClientSecretEnv` for providers, add after the provider loop:

```js
  if (answers.align) {
    const ANTHROPIC_KEY = 'ANTHROPIC_API_KEY'
    const ANTHROPIC_COMMENT = `\n# upstream align: Anthropic API key for LLM-based alignment analysis\n${ANTHROPIC_KEY}=\n`
    const ANTHROPIC_EXAMPLE_COMMENT = `\n# upstream align: Anthropic API key for LLM-based alignment analysis\n${ANTHROPIC_KEY}=your-anthropic-api-key\n`

    const examplePath = join(target, '.env.example')
    const exampleContent = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : ''
    if (!exampleContent.includes(ANTHROPIC_KEY)) {
      appendFileSync(examplePath, ANTHROPIC_EXAMPLE_COMMENT)
      console.log(chalk.green(`✓ ${ANTHROPIC_KEY} added to .env.example`))
    }
  }
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/wizard.js src/commands/init.js tests/unit/wizard.test.js
git commit -m "feat(init): add alignment check prompts to upstream init wizard"
```

---

## Task 11: Final integration smoke test

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 2: Verify `upstream validate --help`**

```bash
node bin/upstream.js validate --help
```

Expected: shows `--output` and `--base` options

- [ ] **Step 3: Verify `upstream init --help`** still works

```bash
node bin/upstream.js init --help
```

Expected: no errors

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: upstream-align feature complete"
```

---

## Known limitation: link mode in `upstream validate`

`validateCommand` reads PRD/ADR content directly from disk. When `docs_storage: link`, stub files contain only a URL — the CLI does not fetch the external document. The `upstream-align` skill handles this correctly (it fetches via provider), but the CLI falls back to stub content for heuristics and passes only the stub to `claude -p`.

This is acceptable for the initial release. A follow-up task should add provider fetching to `validateCommand` using the existing `src/lib/providers/` registry (same pattern used by `upstream mcp`).
