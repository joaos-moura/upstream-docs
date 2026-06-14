import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-doctor-test'
const CLI = join(__dirname, '../../bin/upstream.js')

beforeEach(() => {
  mkdirSync(TARGET, { recursive: true })
  execSync('git init -q', { cwd: TARGET })
  execSync(`node ${CLI} init --yes`, { cwd: TARGET })
})
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream doctor', () => {
  it('exits 0 when all checks pass', () => {
    expect(() => execSync(`node ${CLI} doctor`, { cwd: TARGET })).not.toThrow()
  })

  it('shows all checks as passing in output', () => {
    const out = execSync(`node ${CLI} doctor`, { cwd: TARGET }).toString()
    expect(out).toContain('config')
    expect(out).toContain('hook')
    expect(out).toContain('mcp')
    expect(out).toContain('skills')
    expect(out).toContain('templates')
  })

  it('exits 1 when hook is missing', () => {
    unlinkSync(join(TARGET, '.claude/hooks/upstream-check.sh'))
    expect(() => execSync(`node ${CLI} doctor`, { cwd: TARGET, stdio: 'pipe' })).toThrow()
  })

  it('reports missing hook in output', () => {
    unlinkSync(join(TARGET, '.claude/hooks/upstream-check.sh'))
    let output = ''
    try {
      execSync(`node ${CLI} doctor`, { cwd: TARGET, stdio: 'pipe' })
    } catch (err) {
      output = err.stdout?.toString() ?? ''
    }
    expect(output).toMatch(/hook/)
  })

  it('exits 1 when MCP not registered', () => {
    const settingsPath = join(TARGET, '.claude/settings.json')
    writeFileSync(settingsPath, JSON.stringify({ mcpServers: {} }))
    expect(() => execSync(`node ${CLI} doctor`, { cwd: TARGET, stdio: 'pipe' })).toThrow()
  })

  it('exits 1 when a skill file is missing', () => {
    unlinkSync(join(TARGET, '.claude/plugins/upstream/skills/upstream-guard.md'))
    expect(() => execSync(`node ${CLI} doctor`, { cwd: TARGET, stdio: 'pipe' })).toThrow()
  })

  it('--fix repairs missing hook and exits 0', () => {
    unlinkSync(join(TARGET, '.claude/hooks/upstream-check.sh'))
    expect(() => execSync(`node ${CLI} doctor --fix`, { cwd: TARGET, stdio: 'pipe' })).not.toThrow()
  })

  it('--fix repairs missing MCP entry and exits 0', () => {
    const settingsPath = join(TARGET, '.claude/settings.json')
    writeFileSync(settingsPath, JSON.stringify({ mcpServers: {} }))
    expect(() => execSync(`node ${CLI} doctor --fix`, { cwd: TARGET, stdio: 'pipe' })).not.toThrow()
  })
})
