import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// Override home dir for tests
const TEST_HOME = '/tmp/upstream-test-home'
process.env.UPSTREAM_TOKENS_PATH = join(TEST_HOME, '.upstream', 'tokens.json')

// Import AFTER setting env
const { readTokens, writeTokens, getProviderToken, setProviderToken } = await import('../../src/lib/tokens.js')

beforeEach(() => { mkdirSync(join(TEST_HOME, '.upstream'), { recursive: true }) })
afterEach(() => { rmSync(TEST_HOME, { recursive: true, force: true }) })

describe('tokens', () => {
  it('readTokens returns {} when file absent', () => {
    expect(readTokens()).toEqual({})
  })

  it('readTokens returns parsed JSON', () => {
    writeFileSync(process.env.UPSTREAM_TOKENS_PATH, JSON.stringify({ 'google-docs': { access_token: 'ya29' } }))
    expect(readTokens()).toEqual({ 'google-docs': { access_token: 'ya29' } })
  })

  it('readTokens returns {} on corrupt file', () => {
    writeFileSync(process.env.UPSTREAM_TOKENS_PATH, 'not json')
    expect(readTokens()).toEqual({})
  })

  it('writeTokens creates file and directories', () => {
    writeTokens({ 'google-docs': { access_token: 'tok' } })
    expect(readTokens()).toEqual({ 'google-docs': { access_token: 'tok' } })
  })

  it('getProviderToken returns null when absent', () => {
    expect(getProviderToken('google-docs')).toBeNull()
  })

  it('setProviderToken and getProviderToken round-trip', () => {
    setProviderToken('google-docs', { access_token: 'abc', refresh_token: 'def', expiry: 9999999999999 })
    expect(getProviderToken('google-docs')).toEqual({ access_token: 'abc', refresh_token: 'def', expiry: 9999999999999 })
  })

  it('setProviderToken merges with existing providers', () => {
    setProviderToken('confluence', { access_token: 'confluence-tok' })
    setProviderToken('google-docs', { access_token: 'google-tok' })
    expect(getProviderToken('confluence')).toEqual({ access_token: 'confluence-tok' })
    expect(getProviderToken('google-docs')).toEqual({ access_token: 'google-tok' })
  })
})
