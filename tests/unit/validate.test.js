import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

vi.mock('child_process')
vi.mock('../../src/lib/align/github.js', () => ({ postPrComment: vi.fn(), formatComment: vi.fn(() => '') }))

import { execSync, spawnSync } from 'child_process'
import { validateCommand } from '../../src/commands/validate.js'

const TMP = '/tmp/upstream-test-validate'

beforeEach(() => {
  mkdirSync(join(TMP, 'docs/upstream'), { recursive: true })
  execSync.mockReturnValue('feat/user-auth\n')
  writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')
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
})
