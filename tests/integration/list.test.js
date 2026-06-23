import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo

beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream list', () => {
  it('exits 0 with no feature branches', () => {
    const { exitCode } = runCLI('list', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('shows feature branch with missing PRD', () => {
    repo.git('checkout', '-b', 'feat/search')
    repo.git('checkout', '-')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toContain('feat/search')
    expect(stdout).toMatch(/missing|✗/)
  })

  it('shows ✅ PRD when doc matched by filename', () => {
    repo.git('checkout', '-b', 'feat/search')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-search.md'), '# PRD: Search\n\nsome content')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toContain('PRD-search.md')
  })

  it('shows ADR as required+missing when trigger in PRD', () => {
    repo.git('checkout', '-b', 'feat/payments')
    repo.git('checkout', '-')
    writeFileSync(
      join(repo.dir, 'docs/upstream/PRD-payments.md'),
      '# PRD: Payments\n\nThis adds a new_external_dependency for Stripe.'
    )
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toMatch(/required.*missing|⚠/)
  })

  it('shows ADR as — when PRD has no triggers', () => {
    repo.git('checkout', '-b', 'feat/ui-refresh')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-ui-refresh.md'), '# PRD: UI Refresh\n\nChanges button colours.')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toContain('—')
  })

  it('shows ✅ ADR when both PRD and ADR present', () => {
    repo.git('checkout', '-b', 'feat/auth')
    repo.git('checkout', '-')
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-auth.md'), '# PRD: Auth\n\nauth_change involved.')
    writeFileSync(join(repo.dir, 'docs/upstream/ADR-auth.md'), '# ADR-001: Auth')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toContain('ADR-auth.md')
  })

  it('shows orphaned doc in Unlinked section', () => {
    writeFileSync(join(repo.dir, 'docs/upstream/PRD-old-feature.md'), '# PRD: Old Feature\n')
    const { stdout } = runCLI('list', { cwd: repo.dir })
    expect(stdout).toMatch(/[Uu]nlinked|orphan/i)
    expect(stdout).toContain('PRD-old-feature.md')
  })

  it('--format json returns valid JSON with expected shape', () => {
    const { stdout, exitCode } = runCLI('list --format json', { cwd: repo.dir })
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('branches')
    expect(parsed).toHaveProperty('unlinked')
    expect(Array.isArray(parsed.branches)).toBe(true)
    expect(Array.isArray(parsed.unlinked)).toBe(true)
  })

  it('--format json branch entry has correct keys', () => {
    repo.git('checkout', '-b', 'feat/search')
    repo.git('checkout', '-')
    const { stdout } = runCLI('list --format json', { cwd: repo.dir })
    const { branches } = JSON.parse(stdout)
    const entry = branches.find(b => b.branch === 'feat/search')
    expect(entry).toBeDefined()
    expect(entry).toHaveProperty('prd')
    expect(entry).toHaveProperty('adr')
    expect(entry).toHaveProperty('adrRequired')
  })
})
