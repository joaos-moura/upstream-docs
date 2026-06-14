import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-settings-test'
const CLI = join(__dirname, '../../bin/upstream.js')

beforeEach(() => { mkdirSync(TARGET, { recursive: true }); execSync('git init -q', { cwd: TARGET }) })
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream init — .claude/settings.json', () => {
  it('creates .claude/settings.json with MCP entry', () => {
    execSync(`node ${CLI} init --yes`, { cwd: TARGET })
    const settings = JSON.parse(readFileSync(join(TARGET, '.claude/settings.json'), 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
  })

  it('merges MCP entry into existing settings.json without losing other keys', () => {
    mkdirSync(join(TARGET, '.claude'), { recursive: true })
    writeFileSync(join(TARGET, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash'] } }))

    execSync(`node ${CLI} init --yes`, { cwd: TARGET })

    const settings = JSON.parse(readFileSync(join(TARGET, '.claude/settings.json'), 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
    expect(settings.permissions.allow).toContain('Bash')
  })

  it('upstream upgrade also writes MCP entry', () => {
    execSync(`node ${CLI} init --yes`, { cwd: TARGET })

    // Simulate old settings without MCP entry
    const settingsPath = join(TARGET, '.claude/settings.json')
    writeFileSync(settingsPath, JSON.stringify({ permissions: {} }))

    execSync(`node ${CLI} upgrade`, { cwd: TARGET })

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
    expect(settings.permissions).toBeDefined()
  })
})
