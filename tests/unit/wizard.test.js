// tests/unit/wizard.test.js
import { describe, it, expect } from 'vitest'
import { runWizard, WIZARD_DEFAULTS } from '../../src/lib/wizard.js'

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
