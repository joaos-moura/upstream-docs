import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI, writeMinimalConfig } from '../helpers.js'

let repo

beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream status', () => {
  it('reports bypass for fix/ branch', () => {
    repo.git('checkout', '-b', 'fix/some-bug')
    const { stdout } = runCLI('status', { cwd: repo.dir })
    expect(stdout).toContain('bypass')
    expect(stdout).toContain('fix/')
  })

  it('exits 0 for bypass branch', () => {
    repo.git('checkout', '-b', 'fix/some-bug')
    const { exitCode } = runCLI('status', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('exits 1 for feature branch with no PRD', () => {
    repo.git('checkout', '-b', 'feat/new-feature')
    const { exitCode } = runCLI('status', { cwd: repo.dir })
    expect(exitCode).toBe(1)
  })

  it('shows PRD missing for feature branch with no docs', () => {
    repo.git('checkout', '-b', 'feat/new-feature')
    const { stdout } = runCLI('status', { cwd: repo.dir })
    expect(stdout).toContain('PRD')
    expect(stdout).toContain('not found')
  })

  it('exits 0 when PRD found by filename', () => {
    repo.git('checkout', '-b', 'feat/new-feature')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-new-feature.md'), '# PRD: New Feature\n')
    const { exitCode } = runCLI('status', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('shows PRD as found when matched by filename', () => {
    repo.git('checkout', '-b', 'feat/new-feature')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-new-feature.md'), '# PRD: New Feature\n')
    const { stdout } = runCLI('status', { cwd: repo.dir })
    expect(stdout).toContain('PRD')
    expect(stdout).toContain('PRD-new-feature.md')
  })

  it('finds PRD by content scan when filename does not match', () => {
    repo.git('checkout', '-b', 'feat/new-feature')
    writeFileSync(
      join(repo.dir, 'docs/upstream/PRD-some-unrelated-name.md'),
      '# PRD: Something\n\nBranch: feat/new-feature\n'
    )
    const { stdout } = runCLI('status', { cwd: repo.dir })
    expect(stdout).toContain('PRD')
    expect(stdout).not.toContain('not found')
  })

  it('shows ADR when both PRD and ADR are present', () => {
    repo.git('checkout', '-b', 'feat/new-feature')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-new-feature.md'), '# PRD: New Feature\n')
    writeFileSync(join(repo.dir, 'docs/upstream/ADR-new-feature.md'), '# ADR-001: New Feature\n')
    const { stdout } = runCLI('status', { cwd: repo.dir })
    expect(stdout).toContain('ADR')
    expect(stdout).toContain('ADR-new-feature.md')
  })

  it('exits 1 when not in a git repo', () => {
    const { dir: notGit, cleanup } = makeTmpRepo()
    writeMinimalConfig(notGit)
    try {
      const { exitCode } = runCLI('status', { cwd: notGit })
      expect(exitCode).toBe(1)
    } finally {
      cleanup()
    }
  })
})
