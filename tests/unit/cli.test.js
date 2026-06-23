import { describe, it, expect } from 'vitest'
import { runCLI } from '../helpers.js'

describe('CLI entry point', () => {
  it('shows all commands in --help', () => {
    const { stdout } = runCLI('--help')
    expect(stdout).toContain('upstream')
    for (const cmd of ['init', 'upgrade', 'doctor', 'status', 'auth', 'mcp']) {
      expect(stdout).toContain(cmd)
    }
  })

  it('shows version as semver', () => {
    const { stdout } = runCLI('--version')
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('exits 1 and prints error for unknown command', () => {
    const { exitCode, stderr } = runCLI('no-such-command')
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/unknown command/i)
  })
})
