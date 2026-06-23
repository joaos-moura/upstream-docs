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

  it('includes align defaults', () => {
    const cfg = readConfig(join(TMP, 'upstream.config.yaml'))
    expect(cfg.align).toEqual({
      on_violation: 'warn',
      base_branch: 'auto',
      post_pr_comment: true,
    })
  })

  it('merges align section from file', () => {
    writeFileSync(join(TMP, 'upstream.config.yaml'), `
version: 1
align:
  on_violation: block
  base_branch: develop
`)
    const cfg = readConfig(join(TMP, 'upstream.config.yaml'))
    expect(cfg.align.on_violation).toBe('block')
    expect(cfg.align.base_branch).toBe('develop')
    expect(cfg.align.post_pr_comment).toBe(true)
  })
})
