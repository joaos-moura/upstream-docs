import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

vi.mock('child_process')
vi.mock('../../src/lib/align/github.js', () => ({ postPrComment: vi.fn(), formatComment: vi.fn(() => '') }))
vi.mock('../../src/lib/report.js', () => ({
  buildReport: vi.fn(() => ({ branch: 'feat/test', verdict: 'aligned', findings: [] })),
  writeReport: vi.fn(),
}))

import { execSync, spawnSync } from 'child_process'
import { validateCommand } from '../../src/commands/validate.js'
import { buildReport, writeReport } from '../../src/lib/report.js'

const TMP = '/tmp/upstream-test-validate'

beforeEach(() => {
  mkdirSync(join(TMP, 'docs/upstream'), { recursive: true })
  execSync.mockReturnValue('feat/user-auth\n')
  writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')
  buildReport.mockClear()
  writeReport.mockClear()
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

  it('does not call writeReport when reportPath is null', async () => {
    await validateCommand({ outputFormat: 'json', reportPath: null }, TMP)
    expect(writeReport).not.toHaveBeenCalled()
  })

  it('does not call writeReport when validate skips (no PRD)', async () => {
    await validateCommand({ outputFormat: 'json', reportPath: 'out.json' }, TMP)
    expect(writeReport).not.toHaveBeenCalled()
  })

  it('calls buildReport and writeReport with default path when reportPath is true', async () => {
    writeFileSync(join(TMP, 'docs/upstream/PRD-user-auth.md'), '## Problem Statement\nAuth\n## Success Metrics\nLogin works\n## Out of Scope\n- billing\n')
    spawnSync.mockReturnValue({ status: 1, error: new Error('not found') })
    execSync.mockImplementation(cmd => {
      if (cmd.includes('rev-parse')) return 'feat/user-auth\n'
      if (cmd.includes('symbolic-ref')) return 'refs/remotes/origin/main\n'
      if (cmd.includes('diff')) return ''
      return ''
    })
    await validateCommand({ outputFormat: 'json', reportPath: true }, TMP)
    expect(buildReport).toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith('upstream-report.json', expect.any(Object))
  })

  it('calls writeReport with custom path when reportPath is a string', async () => {
    writeFileSync(join(TMP, 'docs/upstream/PRD-user-auth.md'), '## Problem Statement\nAuth\n## Success Metrics\nLogin works\n## Out of Scope\n- billing\n')
    spawnSync.mockReturnValue({ status: 1, error: new Error('not found') })
    execSync.mockImplementation(cmd => {
      if (cmd.includes('rev-parse')) return 'feat/user-auth\n'
      if (cmd.includes('symbolic-ref')) return 'refs/remotes/origin/main\n'
      if (cmd.includes('diff')) return ''
      return ''
    })
    await validateCommand({ outputFormat: 'json', reportPath: 'my-report.json' }, TMP)
    expect(writeReport).toHaveBeenCalledWith('my-report.json', expect.any(Object))
  })
})
