import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeTmpRepo, runCLI } from '../helpers.js'

let repo

beforeEach(() => { repo = makeTmpRepo({ init: true }) })
afterEach(() => repo.cleanup())

describe('upstream upgrade', () => {
  it('preserves existing upstream.config.yaml', () => {
    const configPath = join(repo.dir, 'upstream.config.yaml')
    const custom = 'version: 1\ncustom_field: preserved\n'
    writeFileSync(configPath, custom)

    runCLI('upgrade', { cwd: repo.dir })

    expect(readFileSync(configPath, 'utf8')).toBe(custom)
  })

  it('overwrites skill files with latest content', () => {
    const guardPath = join(repo.dir, '.claude/plugins/upstream/skills/upstream-guard.md')
    writeFileSync(guardPath, '# stale content')

    runCLI('upgrade', { cwd: repo.dir })

    const content = readFileSync(guardPath, 'utf8')
    expect(content).not.toBe('# stale content')
    expect(content).toContain('upstream-guard')
  })

  it('exits with code 0', () => {
    const { exitCode } = runCLI('upgrade', { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })
})
