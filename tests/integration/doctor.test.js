import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo

beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream doctor', () => {
  it('exits 0 when all checks pass', () => {
    const { exitCode } = runCLI('doctor', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('shows all checks as passing in output', () => {
    const { stdout } = runCLI('doctor', { cwd: repo.dir })
    for (const label of ['config', 'hook', 'mcp', 'skills', 'templates']) {
      expect(stdout).toContain(label)
    }
  })

  it('exits 1 when hook is missing', () => {
    unlinkSync(join(repo.dir, '.claude/hooks/upstream-check.sh'))
    const { exitCode } = runCLI('doctor', { cwd: repo.dir })
    expect(exitCode).toBe(1)
  })

  it('reports missing hook in output', () => {
    unlinkSync(join(repo.dir, '.claude/hooks/upstream-check.sh'))
    const { stdout } = runCLI('doctor', { cwd: repo.dir })
    expect(stdout).toMatch(/hook/)
  })

  it('exits 1 when MCP not registered', () => {
    writeFileSync(join(repo.dir, '.claude/settings.json'), JSON.stringify({ mcpServers: {} }))
    const { exitCode } = runCLI('doctor', { cwd: repo.dir })
    expect(exitCode).toBe(1)
  })

  it('exits 1 when a skill file is missing', () => {
    unlinkSync(join(repo.dir, '.claude/plugins/upstream/skills/upstream-guard.md'))
    const { exitCode } = runCLI('doctor', { cwd: repo.dir })
    expect(exitCode).toBe(1)
  })

  it('--fix repairs missing hook and exits 0', () => {
    unlinkSync(join(repo.dir, '.claude/hooks/upstream-check.sh'))
    const { exitCode } = runCLI('doctor --fix', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('--fix repairs missing MCP entry and exits 0', () => {
    writeFileSync(join(repo.dir, '.claude/settings.json'), JSON.stringify({ mcpServers: {} }))
    const { exitCode } = runCLI('doctor --fix', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })
})
