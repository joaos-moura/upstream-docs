import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { saveSnapshot, loadLatest, compareForCI } from '../../src/lib/snapshots.js'

const STATS = {
  branches: { total: 4, withPrd: 3, withAdr: 1, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 1 },
  adrCompliance: { required: 1, present: 1, rate: 1 },
  unlinkedDocs: 0,
}

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'upstream-snap-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('saveSnapshot', () => {
  it('creates snapshot file at correct path', () => {
    const path = saveSnapshot(dir, STATS, '0.3.1')
    expect(existsSync(path)).toBe(true)
    const data = JSON.parse(readFileSync(path, 'utf8'))
    expect(data.upstream_version).toBe('0.3.1')
    expect(data.stats).toEqual(STATS)
    expect(data.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('creates .gitignore in snapshots dir', () => {
    saveSnapshot(dir, STATS, '0.3.1')
    const gitignorePath = join(dir, '.upstream', 'snapshots', '.gitignore')
    expect(existsSync(gitignorePath)).toBe(true)
    expect(readFileSync(gitignorePath, 'utf8')).toBe('*\n!.gitignore\n')
  })

  it('does not overwrite .gitignore on second call', () => {
    saveSnapshot(dir, STATS, '0.3.1')
    const gitignorePath = join(dir, '.upstream', 'snapshots', '.gitignore')
    writeFileSync(gitignorePath, 'custom\n')
    saveSnapshot(dir, STATS, '0.3.1')
    expect(readFileSync(gitignorePath, 'utf8')).toBe('custom\n')
  })

  it('overwrites snapshot when called again on same date', () => {
    saveSnapshot(dir, STATS, '0.3.1')
    saveSnapshot(dir, { ...STATS, unlinkedDocs: 5 }, '0.3.1')
    const snapDir = join(dir, '.upstream', 'snapshots')
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
    const data = JSON.parse(readFileSync(join(snapDir, files[0]), 'utf8'))
    expect(data.stats.unlinkedDocs).toBe(5)
  })

  it('returns absolute path to the saved file', () => {
    const path = saveSnapshot(dir, STATS, '0.3.1')
    expect(path).toMatch(/\.upstream[\\/]snapshots[\\/]\d{4}-\d{2}-\d{2}\.json$/)
  })
})

describe('loadLatest', () => {
  it('returns null when .upstream/snapshots dir does not exist', () => {
    expect(loadLatest(dir)).toBeNull()
  })

  it('returns null when snapshots dir exists but has no json files', () => {
    mkdirSync(join(dir, '.upstream', 'snapshots'), { recursive: true })
    expect(loadLatest(dir)).toBeNull()
  })

  it('returns parsed snapshot when one exists', () => {
    saveSnapshot(dir, STATS, '0.3.1')
    const snap = loadLatest(dir)
    expect(snap).not.toBeNull()
    expect(snap.stats).toEqual(STATS)
    expect(snap.upstream_version).toBe('0.3.1')
  })

  it('returns the most recent snapshot by filename when multiple exist', () => {
    const snapDir = join(dir, '.upstream', 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, '2026-01-01.json'), JSON.stringify({
      upstream_version: '0.3.0',
      saved_at: '2026-01-01T00:00:00.000Z',
      stats: { ...STATS, unlinkedDocs: 10 },
    }))
    writeFileSync(join(snapDir, '2026-06-30.json'), JSON.stringify({
      upstream_version: '0.3.1',
      saved_at: '2026-06-30T00:00:00.000Z',
      stats: { ...STATS, unlinkedDocs: 0 },
    }))
    writeFileSync(join(snapDir, '.gitignore'), '*\n!.gitignore\n')
    const snap = loadLatest(dir)
    expect(snap.stats.unlinkedDocs).toBe(0)
  })
})

describe('compareForCI', () => {
  const BASE_SNAPSHOT = {
    upstream_version: '0.3.1',
    saved_at: '2026-01-01T00:00:00.000Z',
    stats: {
      branches: { total: 4, withPrd: 4, withAdr: 2, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
      adrCompliance: { required: 2, present: 2, rate: 1 },
      unlinkedDocs: 0,
    },
  }

  it('returns regressed: false when coverage stays the same', () => {
    const { regressed } = compareForCI(BASE_SNAPSHOT, BASE_SNAPSHOT.stats)
    expect(regressed).toBe(false)
  })

  it('returns regressed: false when coverage improves', () => {
    const curr = {
      branches: { total: 4, withPrd: 4, withAdr: 2, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 0 },
      adrCompliance: { required: 2, present: 2, rate: 1 },
      unlinkedDocs: 0,
    }
    const { regressed } = compareForCI(BASE_SNAPSHOT, curr)
    expect(regressed).toBe(false)
  })

  it('returns regressed: true with detail when PRD coverage drops', () => {
    const curr = {
      branches: { total: 4, withPrd: 1, withAdr: 2, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 3 },
      adrCompliance: { required: 2, present: 2, rate: 1 },
      unlinkedDocs: 0,
    }
    const { regressed, details } = compareForCI(BASE_SNAPSHOT, curr)
    expect(regressed).toBe(true)
    expect(details.some(d => d.includes('PRD coverage'))).toBe(true)
  })

  it('returns regressed: true with detail when ADR compliance drops', () => {
    const curr = {
      branches: BASE_SNAPSHOT.stats.branches,
      adrCompliance: { required: 2, present: 0, rate: 0 },
      unlinkedDocs: 0,
    }
    const { regressed, details } = compareForCI(BASE_SNAPSHOT, curr)
    expect(regressed).toBe(true)
    expect(details.some(d => d.includes('ADR compliance'))).toBe(true)
  })

  it('skips ADR check when prev rate was null', () => {
    const prevWithNullAdr = {
      ...BASE_SNAPSHOT,
      stats: { ...BASE_SNAPSHOT.stats, adrCompliance: { required: 0, present: 0, rate: null } },
    }
    const curr = {
      branches: BASE_SNAPSHOT.stats.branches,
      adrCompliance: { required: 0, present: 0, rate: null },
      unlinkedDocs: 0,
    }
    const { regressed } = compareForCI(prevWithNullAdr, curr)
    expect(regressed).toBe(false)
  })

  it('includes both PRD and ADR details when both regress', () => {
    const curr = {
      branches: { total: 4, withPrd: 1, withAdr: 0, skipped: 0, skippedPrd: 0, skippedAdr: 0, noDocs: 3 },
      adrCompliance: { required: 2, present: 0, rate: 0 },
      unlinkedDocs: 0,
    }
    const { regressed, details } = compareForCI(BASE_SNAPSHOT, curr)
    expect(regressed).toBe(true)
    expect(details).toHaveLength(2)
  })
})
