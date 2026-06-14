import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { readConfig, DEFAULT_CONFIG } from '../../src/lib/config.js'

const TMP = '/tmp/upstream-test-config'

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('readConfig', () => {
  it('returns default config when file absent', () => {
    const cfg = readConfig(join(TMP, 'upstream.config.yaml'))
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  it('merges file values with defaults', () => {
    writeFileSync(join(TMP, 'upstream.config.yaml'), `
version: 1
bypass_for:
  - fix/
  - hotfix/
docs_path: docs/my-upstream/
`)
    const cfg = readConfig(join(TMP, 'upstream.config.yaml'))
    expect(cfg.bypass_for).toEqual(['fix/', 'hotfix/'])
    expect(cfg.docs_path).toBe('docs/my-upstream/')
    expect(cfg.prd_required_fields).toEqual(DEFAULT_CONFIG.prd_required_fields)
  })

  it('throws on invalid YAML', () => {
    writeFileSync(join(TMP, 'upstream.config.yaml'), '{ bad yaml: [unclosed')
    expect(() => readConfig(join(TMP, 'upstream.config.yaml'))).toThrow()
  })
})
