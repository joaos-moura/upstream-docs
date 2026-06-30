import { describe, it, expect } from 'vitest'
import { parseSkips, computeStats } from '../../src/lib/branch-stats.js'

describe('parseSkips', () => {
  it('empty string returns empty array', () => {
    expect(parseSkips('')).toEqual([])
  })

  it('single PRD entry', () => {
    const content = '## Skip: PRD — feat/foo — 2026-06-10\n\n**Reason:** hotfix, no PRD needed\n'
    expect(parseSkips(content)).toEqual([
      { type: 'prd', branch: 'feat/foo', date: '2026-06-10', reason: 'hotfix, no PRD needed' },
    ])
  })

  it('single ADR entry', () => {
    const content = '## Skip: ADR — feat/bar — 2026-06-15\n\n**Reason:** low risk\n'
    expect(parseSkips(content)).toEqual([
      { type: 'adr', branch: 'feat/bar', date: '2026-06-15', reason: 'low risk' },
    ])
  })

  it('same branch PRD and ADR entries → count 2', () => {
    const content = [
      '## Skip: PRD — feat/foo — 2026-06-10\n\n**Reason:** reason A',
      '## Skip: ADR — feat/foo — 2026-06-10\n\n**Reason:** reason B',
    ].join('\n\n')
    const result = parseSkips(content)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('prd')
    expect(result[1].type).toBe('adr')
  })

  it('malformed entry mixed with valid → valid parsed, malformed ignored', () => {
    const content = 'Some random text\n\n## Skip: PRD — feat/ok — 2026-01-01\n\n**Reason:** valid\n'
    const result = parseSkips(content)
    expect(result).toHaveLength(1)
    expect(result[0].branch).toBe('feat/ok')
  })
})

describe('computeStats', () => {
  it('zero branches → all zeros, rate null', () => {
    const result = computeStats([], [], [], new Set())
    expect(result.branches.total).toBe(0)
    expect(result.branches.withPrd).toBe(0)
    expect(result.branches.withAdr).toBe(0)
    expect(result.branches.skipped).toBe(0)
    expect(result.branches.skippedPrd).toBe(0)
    expect(result.branches.skippedAdr).toBe(0)
    expect(result.branches.noDocs).toBe(0)
    expect(result.adrCompliance.rate).toBeNull()
    expect(result.unlinkedDocs).toBe(0)
  })

  it('branch with PRD only → withPrd: 1, noDocs: 0', () => {
    const entries = [
      { branch: 'feat/a', prd: 'docs/upstream/PRD-a.md', adr: null, adrRequired: false, _matched: ['PRD-a.md'] },
    ]
    const result = computeStats(entries, [], ['PRD-a.md'], new Set(['PRD-a.md']))
    expect(result.branches.withPrd).toBe(1)
    expect(result.branches.withAdr).toBe(0)
    expect(result.branches.noDocs).toBe(0)
  })

  it('branch without docs and no skip → noDocs: 1', () => {
    const entries = [
      { branch: 'feat/b', prd: null, adr: null, adrRequired: false, _matched: [] },
    ]
    const result = computeStats(entries, [], [], new Set())
    expect(result.branches.noDocs).toBe(1)
    expect(result.branches.skipped).toBe(0)
  })

  it('branch with skip entry → skipped: 1, noDocs: 0', () => {
    const entries = [
      { branch: 'feat/c', prd: null, adr: null, adrRequired: false, _matched: [] },
    ]
    const skips = [{ type: 'prd', branch: 'feat/c', date: '2026-06-01', reason: 'ok' }]
    const result = computeStats(entries, skips, [], new Set())
    expect(result.branches.skipped).toBe(1)
    expect(result.branches.noDocs).toBe(0)
  })

  it('same branch PRD+ADR skip → skipped: 1 unique branch, entries: prdSkips=1 adrSkips=1', () => {
    const entries = [
      { branch: 'feat/d', prd: null, adr: null, adrRequired: false, _matched: [] },
    ]
    const skips = [
      { type: 'prd', branch: 'feat/d', date: '2026-06-01', reason: 'a' },
      { type: 'adr', branch: 'feat/d', date: '2026-06-01', reason: 'b' },
    ]
    const result = computeStats(entries, skips, [], new Set())
    expect(result.branches.skipped).toBe(1)
    expect(result.branches.skippedPrd).toBe(1)
    expect(result.branches.skippedAdr).toBe(1)
    expect(result.branches.noDocs).toBe(0)
  })

  it('branch with PRD + ADR skip entries → skipped: 1 unique branch, skippedPrd: 1, skippedAdr: 1, noDocs: 0', () => {
    const entries = [
      { branch: 'feat/e', prd: null, adr: null, adrRequired: false, _matched: [] },
    ]
    const skips = [
      { type: 'prd', branch: 'feat/e', date: '2026-06-01', reason: 'a' },
      { type: 'adr', branch: 'feat/e', date: '2026-06-01', reason: 'b' },
    ]
    const result = computeStats(entries, skips, [], new Set())
    expect(result.branches.skipped).toBe(1)
    expect(result.branches.skippedPrd).toBe(1)
    expect(result.branches.skippedAdr).toBe(1)
    expect(result.branches.noDocs).toBe(0)
  })

  it('adrCompliance.rate null when required = 0', () => {
    const entries = [
      { branch: 'feat/a', prd: 'PRD-a.md', adr: null, adrRequired: false, _matched: ['PRD-a.md'] },
    ]
    const result = computeStats(entries, [], [], new Set())
    expect(result.adrCompliance.required).toBe(0)
    expect(result.adrCompliance.rate).toBeNull()
  })

  it('adrCompliance.rate = present/required', () => {
    const entries = [
      { branch: 'feat/a', prd: 'PRD-a.md', adr: 'ADR-a.md', adrRequired: true, _matched: ['PRD-a.md', 'ADR-a.md'] },
      { branch: 'feat/b', prd: 'PRD-b.md', adr: null, adrRequired: true, _matched: ['PRD-b.md'] },
    ]
    const result = computeStats(entries, [], [], new Set())
    expect(result.adrCompliance.required).toBe(2)
    expect(result.adrCompliance.present).toBe(1)
    expect(result.adrCompliance.rate).toBeCloseTo(0.5)
  })

  it('unlinkedDocs counts docs not in allMatched', () => {
    const result = computeStats([], [], ['PRD-old.md', 'ADR-old.md'], new Set())
    expect(result.unlinkedDocs).toBe(2)
  })
})
