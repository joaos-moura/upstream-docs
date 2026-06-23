import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { makeTmpRepo, writeMinimalConfig, runCLI } from '../helpers.js'

let repo

beforeEach(() => {
  repo = makeTmpRepo()
  writeMinimalConfig(repo.dir)
})
afterEach(() => repo.cleanup())

describe('upstream auth', () => {
  it('shows error when UPSTREAM_GOOGLE_CLIENT_SECRET env var is missing', () => {
    const { stderr } = runCLI('auth google-docs', {
      cwd: repo.dir,
      env: { UPSTREAM_GOOGLE_CLIENT_SECRET: '' },
    })
    expect(stderr).toMatch(/UPSTREAM_GOOGLE_CLIENT_SECRET/i)
  })

  it('shows error when UPSTREAM_CONFLUENCE_CLIENT_SECRET env var is missing', () => {
    const { stderr } = runCLI('auth confluence', {
      cwd: repo.dir,
      env: { UPSTREAM_CONFLUENCE_CLIENT_SECRET: '' },
    })
    expect(stderr).toMatch(/UPSTREAM_CONFLUENCE_CLIENT_SECRET/i)
  })

  it('shows error for unknown provider', () => {
    const { stderr, exitCode } = runCLI('auth foobar', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/unknown provider/i)
  })

  it('auth status exits 0 and lists all providers', () => {
    const tokensPath = join(repo.dir, 'tokens.json')
    const { stdout, exitCode } = runCLI('auth status', {
      cwd: repo.dir,
      env: { UPSTREAM_TOKENS_PATH: tokensPath },
    })
    expect(exitCode).toBe(0)
    expect(stdout).toContain('google-docs')
    expect(stdout).toContain('confluence')
  })

  it('auth status shows not authenticated when no token stored', () => {
    const tokensPath = join(repo.dir, 'tokens.json')
    const { stdout } = runCLI('auth status', {
      cwd: repo.dir,
      env: { UPSTREAM_TOKENS_PATH: tokensPath },
    })
    expect(stdout).toContain('not authenticated')
  })

  it('auth logout removes token for a specific provider', () => {
    const tokensPath = join(repo.dir, 'tokens.json')
    const fakeToken = { access_token: 'tok', refresh_token: null, expiry: null }
    writeFileSync(tokensPath, JSON.stringify({ 'google-docs': fakeToken }))

    const { exitCode } = runCLI('logout google-docs', {
      cwd: repo.dir,
      env: { UPSTREAM_TOKENS_PATH: tokensPath },
    })

    expect(exitCode).toBe(0)
    const stored = JSON.parse(readFileSync(tokensPath, 'utf8'))
    expect(stored['google-docs']).toBeUndefined()
  })

  it('auth logout all removes all provider tokens', () => {
    const tokensPath = join(repo.dir, 'tokens.json')
    const fakeToken = { access_token: 'tok', refresh_token: null, expiry: null }
    writeFileSync(tokensPath, JSON.stringify({ 'google-docs': fakeToken, confluence: fakeToken }))

    const { exitCode } = runCLI('logout all', {
      cwd: repo.dir,
      env: { UPSTREAM_TOKENS_PATH: tokensPath },
    })

    expect(exitCode).toBe(0)
    const stored = JSON.parse(readFileSync(tokensPath, 'utf8'))
    expect(Object.keys(stored)).toHaveLength(0)
  })

  it('auth logout unknown provider exits 1', () => {
    const { exitCode, stderr } = runCLI('logout nope', { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/unknown provider/i)
  })
})
