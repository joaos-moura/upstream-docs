import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, statSync, writeFileSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { GENERATED_FILES } from '../../src/lib/scaffold.js'
import { makeTmpRepo, CLI, runCLI } from '../helpers.js'

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

let repo

beforeEach(() => { repo = makeTmpRepo({ git: true }) })
afterEach(() => repo.cleanup())

describe('upstream init', () => {
  it('creates all expected files with --from answers', () => {
    writeFileSync(join(repo.dir, 'answers.json'), ANSWERS_LOCAL)
    execFileSync(process.execPath, [CLI, 'init', '--from', 'answers.json'], { cwd: repo.dir, stdio: 'pipe' })
    for (const f of GENERATED_FILES) {
      expect(existsSync(join(repo.dir, f)), `${f} should exist`).toBe(true)
    }
    expect(existsSync(join(repo.dir, 'upstream.config.yaml'))).toBe(true)
    expect(existsSync(join(repo.dir, 'docs/upstream/.gitkeep'))).toBe(true)
  })

  it('generates upstream.config.yaml with correct docs_storage', () => {
    writeFileSync(join(repo.dir, 'answers.json'), ANSWERS_LOCAL)
    execFileSync(process.execPath, [CLI, 'init', '--from', 'answers.json'], { cwd: repo.dir, stdio: 'pipe' })
    const content = readFileSync(join(repo.dir, 'upstream.config.yaml'), 'utf8')
    expect(content).toContain('docs_storage: local')
  })

  it('writes CODEOWNERS when guardian provided', () => {
    writeFileSync(join(repo.dir, 'answers.json'), ANSWERS_LINK)
    execFileSync(process.execPath, [CLI, 'init', '--from', 'answers.json'], { cwd: repo.dir, stdio: 'pipe' })
    const codeowners = join(repo.dir, '.github/CODEOWNERS')
    expect(existsSync(codeowners)).toBe(true)
    expect(readFileSync(codeowners, 'utf8')).toContain('upstream.config.yaml @infra-team')
  })

  it('makes the hook executable', () => {
    writeFileSync(join(repo.dir, 'answers.json'), ANSWERS_LOCAL)
    execFileSync(process.execPath, [CLI, 'init', '--from', 'answers.json'], { cwd: repo.dir, stdio: 'pipe' })
    const mode = statSync(join(repo.dir, '.claude/hooks/upstream-check.sh')).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('exits with code 0', () => {
    writeFileSync(join(repo.dir, 'answers.json'), ANSWERS_LOCAL)
    const { exitCode } = runCLI(['init', '--from', 'answers.json'], { cwd: repo.dir })
    expect(exitCode).toBe(0)
  })

  it('accepts --docs-storage and --yes flags', () => {
    const { exitCode } = runCLI(['init', '--docs-storage', 'local', '--yes'], { cwd: repo.dir })
    expect(exitCode).toBe(0)
    expect(existsSync(join(repo.dir, 'upstream.config.yaml'))).toBe(true)
  })

  it('fails gracefully on invalid --from JSON', () => {
    writeFileSync(join(repo.dir, 'bad.json'), 'not json')
    const { stderr, stdout, exitCode } = runCLI(['init', '--from', 'bad.json'], { cwd: repo.dir })
    expect(exitCode).toBe(1)
    expect(stderr + stdout).toMatch(/not valid JSON/i)
  })
})
