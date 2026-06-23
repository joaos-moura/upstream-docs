import { describe, it, expect, vi } from 'vitest'
import { execSync } from 'child_process'

vi.mock('child_process')

import { resolveBaseBranch } from '../../src/lib/git.js'

describe('resolveBaseBranch', () => {
  it('returns config value when not auto', () => {
    expect(resolveBaseBranch('develop')).toBe('develop')
    expect(resolveBaseBranch('trunk')).toBe('trunk')
  })

  it('reads symbolic-ref when auto', () => {
    execSync.mockReturnValue('refs/remotes/origin/main\n')
    expect(resolveBaseBranch('auto')).toBe('main')
  })

  it('falls back to main when symbolic-ref fails', () => {
    execSync.mockImplementation(() => { throw new Error('not a git repo') })
    expect(resolveBaseBranch('auto')).toBe('main')
  })

  it('falls back to main when auto not set', () => {
    execSync.mockImplementation(() => { throw new Error() })
    expect(resolveBaseBranch(undefined)).toBe('main')
  })
})
