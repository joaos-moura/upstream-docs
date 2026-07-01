import { describe, it, expect } from 'vitest'
import { computeAdoption } from '../../src/lib/adoption.js'

describe('computeAdoption', () => {
  it('zero entries and empty authorMap → empty authors, score 0, no skips', () => {
    const result = computeAdoption([], [], new Map(), null)
    expect(result.authors).toEqual([])
    expect(result.adoptionScore).toBe(0)
    expect(result.skips).toEqual([])
    expect(result.since).toBeNull()
  })

  it('entries not in authorMap are excluded from authors and score', () => {
    const entries = [{ branch: 'feat/old', prd: 'PRD.md', adr: null }]
    const result = computeAdoption(entries, [], new Map(), null)
    expect(result.authors).toEqual([])
    expect(result.adoptionScore).toBe(0)
  })

  it('groups entries by author and counts branches, withPrd, withAdr', () => {
    const entries = [
      { branch: 'feat/a', prd: 'PRD-a.md', adr: null },
      { branch: 'feat/b', prd: null, adr: null },
      { branch: 'feat/c', prd: 'PRD-c.md', adr: 'ADR-c.md' },
    ]
    const authorMap = new Map([
      ['feat/a', 'alice'],
      ['feat/b', 'bob'],
      ['feat/c', 'alice'],
    ])
    const result = computeAdoption(entries, [], authorMap, null)
    const alice = result.authors.find(a => a.name === 'alice')
    const bob = result.authors.find(a => a.name === 'bob')
    expect(alice).toEqual({ name: 'alice', branches: 2, withPrd: 2, withAdr: 1, skips: 0 })
    expect(bob).toEqual({ name: 'bob', branches: 1, withPrd: 0, withAdr: 0, skips: 0 })
  })

  it('adoptionScore = Math.round(withPrd / totalActive * 100)', () => {
    const entries = [
      { branch: 'feat/a', prd: 'PRD-a.md', adr: null },
      { branch: 'feat/b', prd: null, adr: null },
    ]
    const authorMap = new Map([['feat/a', 'alice'], ['feat/b', 'alice']])
    const result = computeAdoption(entries, [], authorMap, null)
    expect(result.adoptionScore).toBe(50)
  })

  it('since filters skip entries — entries older than since are excluded', () => {
    const skips = [
      { type: 'prd', branch: 'feat/a', date: '2026-01-01', reason: 'old' },
      { type: 'prd', branch: 'feat/b', date: '2026-06-15', reason: 'recent' },
    ]
    const authorMap = new Map([['feat/a', 'alice'], ['feat/b', 'bob']])
    const result = computeAdoption([], skips, authorMap, '2026-04-01')
    expect(result.skips).toHaveLength(1)
    expect(result.skips[0].reason).toBe('recent')
  })

  it('since = null → all skip entries included', () => {
    const skips = [
      { type: 'prd', branch: 'feat/a', date: '2020-01-01', reason: 'very old' },
    ]
    const authorMap = new Map([['feat/a', 'alice']])
    const result = computeAdoption([], skips, authorMap, null)
    expect(result.skips).toHaveLength(1)
  })

  it('skip author derived from authorMap, falls back to "unknown"', () => {
    const skips = [
      { type: 'prd', branch: 'feat/known', date: '2026-06-01', reason: 'x' },
      { type: 'prd', branch: 'feat/missing', date: '2026-06-01', reason: 'y' },
    ]
    const authorMap = new Map([['feat/known', 'alice']])
    const result = computeAdoption([], skips, authorMap, null)
    expect(result.skips.find(s => s.branch === 'feat/known').author).toBe('alice')
    expect(result.skips.find(s => s.branch === 'feat/missing').author).toBe('unknown')
  })

  it('skip counts are attributed to the correct author', () => {
    const entries = [{ branch: 'feat/a', prd: null, adr: null }]
    const skips = [{ type: 'prd', branch: 'feat/a', date: '2026-06-01', reason: 'r' }]
    const authorMap = new Map([['feat/a', 'alice']])
    const result = computeAdoption(entries, skips, authorMap, null)
    const alice = result.authors.find(a => a.name === 'alice')
    expect(alice.skips).toBe(1)
  })

  it('since is included in the return value', () => {
    const result = computeAdoption([], [], new Map(), '2026-04-02')
    expect(result.since).toBe('2026-04-02')
  })
})
