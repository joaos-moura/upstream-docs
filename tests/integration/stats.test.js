import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo

beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream stats', () => {
  it('exits 0 with no feature branches', () => {
    const { exitCode } = runCLI('stats', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('shows 0 branches tracked when no feature branches', () => {
    // Make main/master bypass upstream so the count is 0
    writeFileSync(join(repo.dir, 'upstream.config.yaml'), [
      'version: 1',
      'bypass_for: ["fix/", "hotfix/", "chore/", "docs/", "main", "master"]',
    ].join('\n'))
    const { stdout } = runCLI('stats', { cwd: repo.dir })
    expect(stdout).toMatch(/Branches tracked.*0/)
  })

  it('counts branch with PRD in withPrd', () => {
    writeFileSync(join(repo.dir, 'upstream.config.yaml'), [
      'version: 1',
      'bypass_for: ["fix/", "hotfix/", "chore/", "docs/", "main", "master"]',
    ].join('\n'))
    repo.git('checkout', '-b', 'feat/search')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-search.md'), '# PRD: Search\n\ncontent')
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.branches.withPrd).toBe(1)
    expect(data.branches.noDocs).toBe(0)
  })

  it('counts branch without docs in noDocs', () => {
    writeFileSync(join(repo.dir, 'upstream.config.yaml'), [
      'version: 1',
      'bypass_for: ["fix/", "hotfix/", "chore/", "docs/", "main", "master"]',
    ].join('\n'))
    repo.git('checkout', '-b', 'feat/empty')
    repo.git('checkout', '-')
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.branches.noDocs).toBe(1)
    expect(data.branches.skipped).toBe(0)
  })

  it('counts SKIPS.md entries in skipped, not noDocs', () => {
    writeFileSync(join(repo.dir, 'upstream.config.yaml'), [
      'version: 1',
      'bypass_for: ["fix/", "hotfix/", "chore/", "docs/", "main", "master"]',
    ].join('\n'))
    repo.git('checkout', '-b', 'feat/skipped')
    repo.git('checkout', '-')
    writeFileSync(
      join(repo.dir, 'docs/upstream/SKIPS.md'),
      '## Skip: PRD — feat/skipped — 2026-06-01\n\n**Reason:** hotfix\n'
    )
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.branches.skipped).toBe(1)
    expect(data.branches.noDocs).toBe(0)
  })

  it('counts PRD+ADR skip entries for same branch as skipped: 1 unique, prd+adr sub-counts: 1 each', () => {
    writeFileSync(join(repo.dir, 'upstream.config.yaml'), [
      'version: 1',
      'bypass_for: ["fix/", "hotfix/", "chore/", "docs/", "main", "master"]',
    ].join('\n'))
    repo.git('checkout', '-b', 'feat/both-skipped')
    repo.git('checkout', '-')
    const skipsContent = [
      '## Skip: PRD — feat/both-skipped — 2026-06-01\n\n**Reason:** reason A',
      '## Skip: ADR — feat/both-skipped — 2026-06-01\n\n**Reason:** reason B',
    ].join('\n\n')
    writeFileSync(join(repo.dir, 'docs/upstream/SKIPS.md'), skipsContent)
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.branches.skipped).toBe(1)
    expect(data.branches.skippedPrd).toBe(1)
    expect(data.branches.skippedAdr).toBe(1)
    expect(data.branches.noDocs).toBe(0)
  })

  it('--format json returns all expected keys', () => {
    const { stdout, exitCode } = runCLI('stats --format json', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    const data = JSON.parse(stdout)
    expect(data).toHaveProperty('branches')
    expect(data).toHaveProperty('adrCompliance')
    expect(data).toHaveProperty('unlinkedDocs')
    expect(data.branches).toHaveProperty('total')
    expect(data.branches).toHaveProperty('withPrd')
    expect(data.branches).toHaveProperty('withAdr')
    expect(data.branches).toHaveProperty('skipped')
    expect(data.branches).toHaveProperty('skippedPrd')
    expect(data.branches).toHaveProperty('skippedAdr')
    expect(data.branches).toHaveProperty('noDocs')
    expect(data.adrCompliance).toHaveProperty('required')
    expect(data.adrCompliance).toHaveProperty('present')
    expect(data.adrCompliance).toHaveProperty('rate')
  })

  it('adrCompliance.rate is null when no PRDs triggered ADR requirement', () => {
    repo.git('checkout', '-b', 'feat/ui')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-ui.md'), '# PRD: UI\n\nno triggers here')
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(data.adrCompliance.rate).toBeNull()
  })

  it('adrCompliance.rate is a number when PRD triggers ADR requirement', () => {
    repo.git('checkout', '-b', 'feat/auth')
    repo.git('checkout', '-')
    writeFileSync(
      join(repo.dir, 'docs/upstream/PRD-auth.md'),
      '# PRD: Auth\n\nThis involves an auth_change.'
    )
    const { stdout } = runCLI('stats --format json', { cwd: repo.dir })
    const data = JSON.parse(stdout)
    expect(typeof data.adrCompliance.rate).toBe('number')
    expect(data.adrCompliance.required).toBe(1)
    expect(data.adrCompliance.present).toBe(0)
  })
})

describe('upstream stats --trend', () => {
  it('exits 1 with message when no snapshots exist', () => {
    const { exitCode, stderr } = runCLI('stats --trend', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/no snapshots found/)
  })

  it('shows trend output when a snapshot exists', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 0, withPrd: 0, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    const { exitCode, stdout } = runCLI('stats --trend', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/upstream coverage trend/)
    expect(stdout).toMatch(/vs 2026-01-01/)
  })

  it('shows trend arrow when PRD coverage improved', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 2, withPrd: 0, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 2 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    repo.git('checkout', '-b', 'feat/auth')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-auth.md'), '# PRD: Auth\n\ncontent')
    const { exitCode, stdout } = runCLI('stats --trend', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/↑/)
  })
})
