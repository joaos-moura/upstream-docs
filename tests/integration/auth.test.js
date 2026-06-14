import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const CLI = join(__dirname, '../../bin/upstream.js')
const TMP = '/tmp/upstream-auth-test'

describe('upstream auth', () => {
  it('shows error when UPSTREAM_GOOGLE_CLIENT_SECRET env var is missing', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')
    const saved = process.env.UPSTREAM_GOOGLE_CLIENT_SECRET
    delete process.env.UPSTREAM_GOOGLE_CLIENT_SECRET

    let output = ''
    try {
      execSync(`node ${CLI} auth google-docs`, { cwd: TMP, stdio: 'pipe', env: { ...process.env } })
    } catch (err) {
      output = err.stderr?.toString() || err.stdout?.toString() || ''
    }
    rmSync(TMP, { recursive: true, force: true })
    if (saved !== undefined) process.env.UPSTREAM_GOOGLE_CLIENT_SECRET = saved

    expect(output).toMatch(/UPSTREAM_GOOGLE_CLIENT_SECRET/i)
  })

  it('upstream auth status exits 0 and shows providers', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')
    process.env.UPSTREAM_TOKENS_PATH = join(TMP, 'tokens.json')

    const output = execSync(`node ${CLI} auth status`, { cwd: TMP }).toString()
    rmSync(TMP, { recursive: true, force: true })
    delete process.env.UPSTREAM_TOKENS_PATH

    expect(output).toContain('google-docs')
  })

  it('shows error when confluence credentials missing from config', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')

    let output = ''
    try {
      execSync(`node ${CLI} auth confluence`, { cwd: TMP, stdio: 'pipe' })
    } catch (err) {
      output = err.stderr?.toString() || err.stdout?.toString() || ''
    }
    rmSync(TMP, { recursive: true, force: true })

    expect(output).toMatch(/UPSTREAM_CONFLUENCE_CLIENT_SECRET/i)
  })

  it('shows error for unknown provider', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')

    let output = ''
    try {
      execSync(`node ${CLI} auth foobar`, { cwd: TMP, stdio: 'pipe' })
    } catch (err) {
      output = err.stderr?.toString() || err.stdout?.toString() || ''
    }
    rmSync(TMP, { recursive: true, force: true })

    expect(output).toMatch(/unknown provider/i)
  })

  it('auth status shows confluence', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')
    process.env.UPSTREAM_TOKENS_PATH = join(TMP, 'tokens.json')

    const output = execSync(`node ${CLI} auth status`, { cwd: TMP }).toString()
    rmSync(TMP, { recursive: true, force: true })
    delete process.env.UPSTREAM_TOKENS_PATH

    expect(output).toContain('confluence')
  })
})
