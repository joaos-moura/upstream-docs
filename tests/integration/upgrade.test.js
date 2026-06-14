import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-test-upgrade'
const CLI = join(__dirname, '../../bin/upstream.js')

beforeEach(() => {
  mkdirSync(TARGET, { recursive: true })
  execSync('git init -q', { cwd: TARGET })
  execSync(`node ${CLI} init --yes`, { cwd: TARGET })
})
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream upgrade', () => {
  it('preserves existing upstream.config.yaml', () => {
    const configPath = join(TARGET, 'upstream.config.yaml')
    const custom = 'version: 1\ncustom_field: preserved\n'
    writeFileSync(configPath, custom)

    execSync(`node ${CLI} upgrade`, { cwd: TARGET })

    expect(readFileSync(configPath, 'utf8')).toBe(custom)
  })

  it('overwrites skill files with latest content', () => {
    const guardPath = join(TARGET, '.claude/plugins/upstream/skills/upstream-guard.md')
    writeFileSync(guardPath, '# stale content')

    execSync(`node ${CLI} upgrade`, { cwd: TARGET })

    const content = readFileSync(guardPath, 'utf8')
    expect(content).not.toBe('# stale content')
    expect(content).toContain('upstream-guard')
  })

  it('exits with code 0', () => {
    expect(() => execSync(`node ${CLI} upgrade`, { cwd: TARGET })).not.toThrow()
  })
})
