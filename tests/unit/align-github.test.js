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
