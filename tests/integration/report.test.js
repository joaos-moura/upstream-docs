import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

const SAMPLE_REPORT = {
  branch: 'feat/test',
  verdict: 'aligned',
  engine: 'llm',
  coverage: { prdPath: 'docs/upstream/PRD-test.md', adrPath: null },
  findings: [{ dimension: 'problem_statement', status: 'pass', detail: null }],
  snapshot: { timestamp: '2026-06-30T12:00:00Z', upstream_version: '0.3.1' },
  trend: { vsLast: null },
}

let repo
beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream report summary', () => {
  it('prints markdown summary from default report file', () => {
    writeFileSync(join(repo.dir, 'upstream-report.json'), JSON.stringify(SAMPLE_REPORT))
    const { exitCode, stdout } = runCLI('report summary', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toContain('## upstream alignment report')
    expect(stdout).toContain('feat/test')
    expect(stdout).toContain('aligned')
  })

  it('reads from --input path when specified', () => {
    writeFileSync(join(repo.dir, 'custom.json'), JSON.stringify(SAMPLE_REPORT))
    const { exitCode, stdout } = runCLI(['report', 'summary', '--input', 'custom.json'], { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toContain('## upstream alignment report')
  })

  it('exits 1 and prints file-not-found error when default file missing', () => {
    const { exitCode, stderr } = runCLI('report summary', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stderr).toContain('file not found')
  })

  it('exits 1 and prints error when file contains invalid JSON', () => {
    writeFileSync(join(repo.dir, 'upstream-report.json'), 'not-json{{')
    const { exitCode, stderr } = runCLI('report summary', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stderr).toContain('invalid report file')
  })

  it('exits 1 for unknown subcommand', () => {
    const { exitCode, stderr } = runCLI('report unknown', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stderr).toContain("unknown subcommand 'unknown'")
  })

  it('includes trend section when vsLast is present', () => {
    const reportWithTrend = {
      ...SAMPLE_REPORT,
      trend: {
        vsLast: {
          prdCoverage: { before: 50, after: 75, delta: 25 },
          adrCompliance: { before: 60, after: 80, delta: 20 },
        },
      },
    }
    writeFileSync(join(repo.dir, 'upstream-report.json'), JSON.stringify(reportWithTrend))
    const { exitCode, stdout } = runCLI('report summary', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Trend vs last snapshot')
    expect(stdout).toContain('+25%')
  })
})

describe('upstream validate --report', () => {
  it('does not create report file when no PRD found (skip case)', () => {
    runCLI('validate --report', { cwd: repo.dir })
    expect(existsSync(join(repo.dir, 'upstream-report.json'))).toBe(false)
  })

  it('creates report at default path when --report used without value', () => {
    repo.git('checkout', '-b', 'feat/ci-test')
    mkdirSync(join(repo.dir, 'docs', 'upstream'), { recursive: true })
    writeFileSync(
      join(repo.dir, 'docs', 'upstream', 'PRD-ci-test.md'),
      '## Problem Statement\nTest CI\n## Success Metrics\n- ships\n## Out of Scope\n- nothing\n'
    )
    const { exitCode } = runCLI('validate --report', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(existsSync(join(repo.dir, 'upstream-report.json'))).toBe(true)
    const report = JSON.parse(readFileSync(join(repo.dir, 'upstream-report.json'), 'utf8'))
    expect(report.branch).toBe('feat/ci-test')
    expect(report.verdict).toBeDefined()
    expect(report.findings).toBeDefined()
    expect(report.snapshot.upstream_version).toBeDefined()
  })

  it('creates report at custom path when path specified', () => {
    repo.git('checkout', '-b', 'feat/ci-test')
    mkdirSync(join(repo.dir, 'docs', 'upstream'), { recursive: true })
    writeFileSync(
      join(repo.dir, 'docs', 'upstream', 'PRD-ci-test.md'),
      '## Problem Statement\nTest CI\n## Success Metrics\n- ships\n## Out of Scope\n- nothing\n'
    )
    const { exitCode } = runCLI(['validate', '--report', 'ci-report.json'], { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(existsSync(join(repo.dir, 'ci-report.json'))).toBe(true)
  })
})
