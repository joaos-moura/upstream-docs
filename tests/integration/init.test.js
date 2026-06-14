import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, statSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { GENERATED_FILES } from '../../src/lib/scaffold.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-test-init'
const CLI = join(__dirname, '../../bin/upstream.js')

const ANSWERS_LOCAL = JSON.stringify({
  docs_storage: 'local',
  docs_path: 'docs/upstream/',
  providers: [],
  guardian: '',
  bypass_for: ['fix/', 'hotfix/'],
  prd_required_fields: ['problem_statement'],
  adr_triggers: ['database_schema_change'],
})

const ANSWERS_LINK = JSON.stringify({
  docs_storage: 'link',
  docs_path: 'docs/upstream/',
  providers: [{ id: 'google-docs', client_id: 'cid', allowed_domain: 'acme.com' }],
  guardian: '@infra-team',
  bypass_for: ['fix/'],
  prd_required_fields: ['problem_statement'],
  adr_triggers: ['database_schema_change'],
})

beforeEach(() => {
  mkdirSync(TARGET, { recursive: true })
  execSync('git init -q', { cwd: TARGET })
})
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream init', () => {
  it('creates all expected files with --from answers', () => {
    writeFileSync(join(TARGET, 'answers.json'), ANSWERS_LOCAL)
    execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })
    for (const f of GENERATED_FILES) {
      expect(existsSync(join(TARGET, f)), `${f} should exist`).toBe(true)
    }
    expect(existsSync(join(TARGET, 'upstream.config.yaml'))).toBe(true)
    expect(existsSync(join(TARGET, 'docs/upstream/.gitkeep'))).toBe(true)
  })

  it('generates upstream.config.yaml with correct docs_storage', () => {
    writeFileSync(join(TARGET, 'answers.json'), ANSWERS_LOCAL)
    execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })
    const content = execSync(`cat ${join(TARGET, 'upstream.config.yaml')}`).toString()
    expect(content).toContain('docs_storage: local')
  })

  it('writes CODEOWNERS when guardian provided', () => {
    writeFileSync(join(TARGET, 'answers.json'), ANSWERS_LINK)
    execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })
    const codeowners = join(TARGET, '.github/CODEOWNERS')
    expect(existsSync(codeowners)).toBe(true)
    const content = execSync(`cat ${codeowners}`).toString()
    expect(content).toContain('upstream.config.yaml @infra-team')
  })

  it('makes the hook executable', () => {
    writeFileSync(join(TARGET, 'answers.json'), ANSWERS_LOCAL)
    execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })
    const mode = statSync(join(TARGET, '.claude/hooks/upstream-check.sh')).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('exits with code 0', () => {
    writeFileSync(join(TARGET, 'answers.json'), ANSWERS_LOCAL)
    expect(() => execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })).not.toThrow()
  })

  it('accepts --docs-storage and --yes flags', () => {
    expect(() =>
      execSync(`node ${CLI} init --docs-storage local --yes`, { cwd: TARGET })
    ).not.toThrow()
    expect(existsSync(join(TARGET, 'upstream.config.yaml'))).toBe(true)
  })

  it('fails gracefully on invalid --from JSON', () => {
    writeFileSync(join(TARGET, 'bad.json'), 'not json')
    let output = ''
    try {
      execSync(`node ${CLI} init --from bad.json`, { cwd: TARGET, stdio: 'pipe' })
    } catch (err) {
      output = err.stderr?.toString() || err.stdout?.toString() || ''
    }
    expect(output).toMatch(/not valid JSON/i)
  })
})
