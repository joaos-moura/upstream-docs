import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo

beforeEach(() => { repo = makeTmpRepo({ git: true }) })
afterEach(() => repo.cleanup())

describe('upstream init — .claude/settings.json', () => {
  it('creates .claude/settings.json with MCP entry', () => {
    runCLI('init --yes', { cwd: repo.dir })
    const settings = JSON.parse(readFileSync(join(repo.dir, '.claude/settings.json'), 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
  })

  it('merges MCP entry into existing settings.json without losing other keys', () => {
    mkdirSync(join(repo.dir, '.claude'), { recursive: true })
    writeFileSync(join(repo.dir, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash'] } }))

    runCLI('init --yes', { cwd: repo.dir })

    const settings = JSON.parse(readFileSync(join(repo.dir, '.claude/settings.json'), 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
    expect(settings.permissions.allow).toContain('Bash')
  })

  it('upstream upgrade also writes MCP entry', () => {
    runCLI('init --yes', { cwd: repo.dir })

    const settingsPath = join(repo.dir, '.claude/settings.json')
    writeFileSync(settingsPath, JSON.stringify({ permissions: {} }))

    runCLI('upgrade', { cwd: repo.dir })

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
    expect(settings.permissions).toBeDefined()
  })
})
