// tests/unit/wizard.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runWizard, WIZARD_DEFAULTS } from '../../src/lib/wizard.js'

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  checkbox: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
}))

import { select, checkbox, input, confirm } from '@inquirer/prompts'

describe('runWizard with prefilled answers', () => {
  it('returns prefilled answers without prompting when all fields provided', async () => {
    const prefilled = {
      docs_storage: 'local',
      docs_path: 'docs/rfcs/',
      providers: [],
      guardian: '@infra',
      bypass_for: ['fix/', 'hotfix/'],
      prd_required_fields: ['problem_statement'],
      adr_triggers: ['database_schema_change'],
      align: null,
    }
    const result = await runWizard(prefilled)
    expect(result).toEqual(prefilled)
  })

  it('uses WIZARD_DEFAULTS for org fields when not prefilled', async () => {
    const prefilled = {
      docs_storage: 'local',
      docs_path: 'docs/upstream/',
      providers: [],
      guardian: '',
    }
    const result = await runWizard(prefilled)
    expect(result.docs_path).toBe('docs/upstream/')
    expect(result.bypass_for).toEqual(WIZARD_DEFAULTS.bypass_for)
    expect(result.prd_required_fields).toEqual(WIZARD_DEFAULTS.prd_required_fields)
    expect(result.adr_triggers).toEqual(WIZARD_DEFAULTS.adr_triggers)
  })

  it('includes provider config when docs_storage is link', async () => {
    const prefilled = {
      docs_storage: 'link',
      docs_path: 'docs/upstream/',
      providers: [{ id: 'google-docs', client_id: 'cid', allowed_domain: 'acme.com' }],
      guardian: '@infra',
    }
    const result = await runWizard(prefilled)
    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]).toEqual({ id: 'google-docs', client_id: 'cid', allowed_domain: 'acme.com' })
  })
})

describe('WIZARD_DEFAULTS', () => {
  it('exports expected default arrays', () => {
    expect(WIZARD_DEFAULTS.bypass_for).toContain('fix/')
    expect(WIZARD_DEFAULTS.prd_required_fields).toContain('problem_statement')
    expect(WIZARD_DEFAULTS.adr_triggers).toContain('database_schema_change')
  })
})

describe('runWizard align prompts', () => {
  let originalIsTTY

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('includes align section when user enables it', async () => {
    confirm.mockResolvedValueOnce(false) // configure org defaults: no
    confirm.mockResolvedValueOnce(true)  // enable alignment checks: yes
    select.mockResolvedValueOnce('warn') // on_violation: warn
    input.mockResolvedValueOnce('')      // base_branch: accept default (auto)

    const answers = await runWizard({ docs_storage: 'local', docs_path: 'docs/upstream/', providers: [], guardian: '' })
    expect(answers.align).toEqual({ on_violation: 'warn', base_branch: 'auto' })
  })

  it('sets align to null when user disables it', async () => {
    confirm.mockResolvedValueOnce(false) // configure org defaults: no
    confirm.mockResolvedValueOnce(false) // enable alignment checks: no

    const answers = await runWizard({ docs_storage: 'local', docs_path: 'docs/upstream/', providers: [], guardian: '' })
    expect(answers.align).toBeNull()
  })
})
