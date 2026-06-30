import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo
beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream snapshot', () => {
  it('exits 0 and creates snapshot file', () => {
    const { exitCode, stdout } = runCLI('snapshot', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/Snapshot saved to .upstream[/\\]snapshots[/\\]\d{4}-\d{2}-\d{2}\.json/)
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('creates .gitignore in snapshots dir', () => {
    runCLI('snapshot', { cwd: repo.dir })
    expect(existsSync(join(repo.dir, '.upstream', 'snapshots', '.gitignore'))).toBe(true)
  })

  it('overwrites when run twice on same day', () => {
    runCLI('snapshot', { cwd: repo.dir })
    runCLI('snapshot', { cwd: repo.dir })
    const files = readdirSync(join(repo.dir, '.upstream', 'snapshots')).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('snapshot file has correct shape', () => {
    runCLI('snapshot', { cwd: repo.dir })
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    const file = readdirSync(snapDir).find(f => f.endsWith('.json'))
    const data = JSON.parse(readFileSync(join(snapDir, file), 'utf8'))
    expect(data).toHaveProperty('upstream_version')
    expect(data).toHaveProperty('saved_at')
    expect(data.stats).toHaveProperty('branches')
    expect(data.stats).toHaveProperty('adrCompliance')
    expect(data.stats).toHaveProperty('unlinkedDocs')
  })
})

describe('upstream snapshot --ci', () => {
  it('exits 0 when no prior snapshot exists', () => {
    const { exitCode, stdout } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/Snapshot saved/)
  })

  it('exits 0 and prints confirmation when no regression', () => {
    runCLI('snapshot', { cwd: repo.dir })
    const { exitCode, stdout } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/No coverage regression detected/)
  })

  it('exits 1 and prints details when PRD coverage regresses', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 2, withPrd: 2, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    repo.git('checkout', '-b', 'feat/no-prd')
    repo.git('checkout', '-')
    const { exitCode, stdout, stderr } = runCLI('snapshot --ci', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stdout + stderr).toMatch(/regression detected/i)
    expect(stdout + stderr).toMatch(/PRD coverage/)
  })

  it('saves a new snapshot even when regression is detected', () => {
    const snapDir = join(repo.dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: {
        branches: { total: 2, withPrd: 2, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
        adrCompliance: { required: 0, present: 0, rate: null },
        unlinkedDocs: 0,
      },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    repo.git('checkout', '-b', 'feat/no-prd')
    repo.git('checkout', '-')
    runCLI('snapshot --ci', { cwd: repo.dir })
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json'))
    expect(files.some(f => f !== '2026-01-01.json')).toBe(true)
  })
})
