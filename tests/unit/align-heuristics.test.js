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
