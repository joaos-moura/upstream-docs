import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-status-test'
const CLI = join(__dirname, '../../bin/upstream.js')

function git(cmd) {
  execSync(cmd, { cwd: TARGET, stdio: 'pipe' })
}

beforeEach(() => {
  mkdirSync(TARGET, { recursive: true })
  git('git init -q')
  git('git config user.email "test@test.com"')
  git('git config user.name "Test"')
  git('git commit --allow-empty -m "init"')
  execSync(`node ${CLI} init --yes`, { cwd: TARGET })
})
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream status', () => {
  it('reports bypass for fix/ branch', () => {
    git('git checkout -b fix/some-bug')
    const out = execSync(`node ${CLI} status`, { cwd: TARGET, stdio: 'pipe' }).toString()
    expect(out).toContain('bypass')
    expect(out).toContain('fix/')
  })

  it('exits 0 for bypass branch', () => {
    git('git checkout -b fix/some-bug')
    expect(() => execSync(`node ${CLI} status`, { cwd: TARGET, stdio: 'pipe' })).not.toThrow()
  })

  it('exits 1 for feature branch with no PRD', () => {
    git('git checkout -b feat/new-feature')
    expect(() => execSync(`node ${CLI} status`, { cwd: TARGET, stdio: 'pipe' })).toThrow()
  })

  it('shows PRD missing for feature branch with no docs', () => {
    git('git checkout -b feat/new-feature')
    let output = ''
    try {
      execSync(`node ${CLI} status`, { cwd: TARGET, stdio: 'pipe' })
    } catch (err) {
      output = err.stdout?.toString() || err.stderr?.toString() || ''
    }
    expect(output).toContain('PRD')
    expect(output).toContain('not found')
  })

  it('exits 0 when PRD found by filename', () => {
    git('git checkout -b feat/new-feature')
    writeFileSync(join(TARGET, 'docs/upstream/PRD-new-feature.md'), '# PRD: New Feature\n')
    expect(() => execSync(`node ${CLI} status`, { cwd: TARGET })).not.toThrow()
  })

  it('shows PRD as found when matched by filename', () => {
    git('git checkout -b feat/new-feature')
    const prdPath = join(TARGET, 'docs/upstream/PRD-new-feature.md')
    writeFileSync(prdPath, '# PRD: New Feature\n')
    const out = execSync(`node ${CLI} status`, { cwd: TARGET }).toString()
    expect(out).toContain('PRD')
    expect(out).toContain('PRD-new-feature.md')
  })

  it('finds PRD by content scan when filename does not match', () => {
    git('git checkout -b feat/new-feature')
    writeFileSync(
      join(TARGET, 'docs/upstream/PRD-some-unrelated-name.md'),
      '# PRD: Something\n\nBranch: feat/new-feature\n'
    )
    const out = execSync(`node ${CLI} status`, { cwd: TARGET }).toString()
    expect(out).toContain('PRD')
    expect(out).not.toContain('not found')
  })

  it('shows ADR when both PRD and ADR are present', () => {
    git('git checkout -b feat/new-feature')
    writeFileSync(join(TARGET, 'docs/upstream/PRD-new-feature.md'), '# PRD: New Feature\n')
    writeFileSync(join(TARGET, 'docs/upstream/ADR-new-feature.md'), '# ADR-001: New Feature\n')
    const out = execSync(`node ${CLI} status`, { cwd: TARGET }).toString()
    expect(out).toContain('ADR')
    expect(out).toContain('ADR-new-feature.md')
  })

  it('exits 1 when not in a git repo', () => {
    const notGit = '/tmp/upstream-not-git'
    mkdirSync(notGit, { recursive: true })
    writeFileSync(join(notGit, 'upstream.config.yaml'), 'version: 1\n')
    try {
      expect(() => execSync(`node ${CLI} status`, { cwd: notGit, stdio: 'pipe' })).toThrow()
    } finally {
      rmSync(notGit, { recursive: true, force: true })
    }
  })
})
