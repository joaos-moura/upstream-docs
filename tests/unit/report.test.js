import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../src/lib/snapshots.js', () => ({ loadLatest: vi.fn() }))
vi.mock('../../src/commands/stats.js', () => ({ getCurrentStats: vi.fn() }))

import { loadLatest } from '../../src/lib/snapshots.js'
import { getCurrentStats } from '../../src/commands/stats.js'
import { buildReport, writeReport, formatSummary } from '../../src/lib/report.js'

const RESULT = {
  findings: [{ dimension: 'problem_statement', status: 'pass', detail: null }],
  verdict: 'aligned',
  engine: 'llm',
  prdPath: 'docs/upstream/PRD-feat.md',
  adrPath: null,
  summary: 'all good',
}

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'upstream-report-'))
  loadLatest.mockReturnValue(null)
  getCurrentStats.mockReturnValue({ stats: null, error: 'no snapshot' })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('buildReport', () => {
  it('returns null vsLast when no snapshot exists', () => {
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    expect(report.trend.vsLast).toBeNull()
  })

  it('returns correct top-level fields', () => {
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    expect(report.branch).toBe('feat/x')
    expect(report.verdict).toBe('aligned')
    expect(report.engine).toBe('llm')
    expect(report.coverage.prdPath).toBe('docs/upstream/PRD-feat.md')
    expect(report.coverage.adrPath).toBeNull()
    expect(report.findings).toHaveLength(1)
    expect(report.snapshot.upstream_version).toBe('0.3.1')
    expect(report.snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('computes vsLast prdCoverage and adrCompliance when snapshot exists', () => {
    loadLatest.mockReturnValue({
      upstream_version: '0.3.0',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 4, withPrd: 2 },
        adrCompliance: { rate: 0.5 },
      },
    })
    getCurrentStats.mockReturnValue({
      stats: {
        branches: { total: 4, withPrd: 4 },
        adrCompliance: { rate: 1 },
      },
    })
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    expect(report.trend.vsLast).not.toBeNull()
    expect(report.trend.vsLast.prdCoverage).toEqual({ before: 50, after: 100, delta: 50 })
    expect(report.trend.vsLast.adrCompliance).toEqual({ before: 50, after: 100, delta: 50 })
  })

  it('sets adrCompliance to null in vsLast when prev rate is null', () => {
    loadLatest.mockReturnValue({
      upstream_version: '0.3.0',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 4, withPrd: 2 },
        adrCompliance: { rate: null },
      },
    })
    getCurrentStats.mockReturnValue({
      stats: {
        branches: { total: 4, withPrd: 3 },
        adrCompliance: { rate: null },
      },
    })
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    expect(report.trend.vsLast.adrCompliance).toBeNull()
  })

  it('sets vsLast to null when getCurrentStats returns error', () => {
    loadLatest.mockReturnValue({
      upstream_version: '0.3.0',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: { branches: { total: 4, withPrd: 2 }, adrCompliance: { rate: 0.5 } },
    })
    getCurrentStats.mockReturnValue({ error: 'no git repo' })
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    expect(report.trend.vsLast).toBeNull()
  })
})

describe('writeReport', () => {
  it('writes JSON to the specified path', () => {
    const path = join(dir, 'out.json')
    writeReport(path, { branch: 'feat/x', verdict: 'aligned' })
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ branch: 'feat/x', verdict: 'aligned' })
  })
})

describe('formatSummary', () => {
  it('includes branch, verdict, engine in output', () => {
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    const md = formatSummary(report)
    expect(md).toContain('## upstream alignment report')
    expect(md).toContain('feat/x')
    expect(md).toContain('aligned')
    expect(md).toContain('llm')
  })

  it('renders findings as a table row', () => {
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    const md = formatSummary(report)
    expect(md).toContain('problem statement')
    expect(md).toContain('pass')
  })

  it('omits trend section when vsLast is null', () => {
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    expect(formatSummary(report)).not.toContain('Trend')
  })

  it('includes trend section with delta when vsLast is present', () => {
    loadLatest.mockReturnValue({
      upstream_version: '0.3.0',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: { branches: { total: 4, withPrd: 2 }, adrCompliance: { rate: 0.5 } },
    })
    getCurrentStats.mockReturnValue({
      stats: { branches: { total: 4, withPrd: 4 }, adrCompliance: { rate: 1 } },
    })
    const report = buildReport(RESULT, { branch: 'feat/x', cwd: dir, version: '0.3.1' })
    const md = formatSummary(report)
    expect(md).toContain('Trend vs last snapshot')
    expect(md).toContain('PRD coverage')
    expect(md).toContain('+50%')
  })
})
