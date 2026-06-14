import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { scaffoldInto, GENERATED_FILES, generateConfig, writeCodeowners } from '../../src/lib/scaffold.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-test-scaffold'
const FIXTURES = join(__dirname, '../fixtures/templates')

beforeEach(() => { mkdirSync(TARGET, { recursive: true }) })
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('scaffoldInto', () => {
  it('creates all GENERATED_FILES in the target', async () => {
    await scaffoldInto(TARGET, FIXTURES)
    for (const f of GENERATED_FILES) {
      expect(existsSync(join(TARGET, f)), `${f} should exist`).toBe(true)
    }
  })

  it('creates docs/upstream/.gitkeep', async () => {
    await scaffoldInto(TARGET, FIXTURES)
    expect(existsSync(join(TARGET, 'docs/upstream/.gitkeep'))).toBe(true)
  })

  it('creates upstream.config.yaml when absent', async () => {
    await scaffoldInto(TARGET, FIXTURES)
    expect(existsSync(join(TARGET, 'upstream.config.yaml'))).toBe(true)
  })

  it('preserves existing upstream.config.yaml', async () => {
    const configPath = join(TARGET, 'upstream.config.yaml')
    const original = 'version: 1\ncustom: true\n'
    writeFileSync(configPath, original)
    await scaffoldInto(TARGET, FIXTURES)
    expect(readFileSync(configPath, 'utf8')).toBe(original)
  })

  it('makes the hook executable', async () => {
    await scaffoldInto(TARGET, FIXTURES)
    const { statSync } = await import('fs')
    const mode = statSync(join(TARGET, '.claude/hooks/upstream-check.sh')).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })
})

describe('generateConfig', () => {
  it('generates valid yaml with docs_storage local', () => {
    const answers = {
      docs_storage: 'local',
      providers: [],
      guardian: '',
      bypass_for: ['fix/', 'hotfix/'],
      prd_required_fields: ['problem_statement'],
      adr_triggers: ['database_schema_change'],
    }
    const result = generateConfig(answers)
    const parsed = yaml.load(result)
    expect(parsed.version).toBe(1)
    expect(parsed.docs_storage).toBe('local')
    expect(parsed.bypass_for).toEqual(['fix/', 'hotfix/'])
    expect(parsed.integrations).toBeUndefined()
  })

  it('includes integrations when providers are present', () => {
    const answers = {
      docs_storage: 'link',
      providers: [{ id: 'google-docs', client_id: 'cid', allowed_domain: 'acme.com' }],
      guardian: '',
      bypass_for: ['fix/'],
      prd_required_fields: ['problem_statement'],
      adr_triggers: ['database_schema_change'],
    }
    const result = generateConfig(answers)
    const parsed = yaml.load(result)
    expect(parsed.integrations.google_docs.client_id).toBe('cid')
    expect(parsed.integrations.google_docs.allowed_domain).toBe('acme.com')
  })
})

describe('writeCodeowners', () => {
  it('creates .github/CODEOWNERS with guardian entry', async () => {
    await writeCodeowners(TARGET, '@infra-team')
    const content = readFileSync(join(TARGET, '.github/CODEOWNERS'), 'utf8')
    expect(content).toContain('upstream.config.yaml @infra-team')
  })

  it('appends to existing CODEOWNERS without overwriting', async () => {
    const codeownersPath = join(TARGET, '.github/CODEOWNERS')
    mkdirSync(join(TARGET, '.github'), { recursive: true })
    writeFileSync(codeownersPath, '*.js @frontend-team\n')
    await writeCodeowners(TARGET, '@infra-team')
    const content = readFileSync(codeownersPath, 'utf8')
    expect(content).toContain('*.js @frontend-team')
    expect(content).toContain('upstream.config.yaml @infra-team')
  })

  it('does not duplicate entry if already present', async () => {
    await writeCodeowners(TARGET, '@infra-team')
    await writeCodeowners(TARGET, '@infra-team')
    const content = readFileSync(join(TARGET, '.github/CODEOWNERS'), 'utf8')
    const matches = content.match(/upstream\.config\.yaml/g)
    expect(matches).toHaveLength(1)
  })

  it('skips CODEOWNERS when guardian is empty', async () => {
    await writeCodeowners(TARGET, '')
    expect(existsSync(join(TARGET, '.github/CODEOWNERS'))).toBe(false)
  })
})
