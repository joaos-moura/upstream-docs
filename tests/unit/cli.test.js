import { execSync } from 'child_process'
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'url'
import { join } from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const CLI = join(__dirname, '../../bin/upstream.js')

describe('CLI entry point', () => {
  it('shows help with init and upgrade commands', () => {
    const out = execSync(`node ${CLI} --help`).toString()
    expect(out).toContain('upstream')
    expect(out).toContain('init')
    expect(out).toContain('upgrade')
  })

  it('shows version', () => {
    const out = execSync(`node ${CLI} --version`).toString()
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
