import { select, checkbox, input, confirm } from '@inquirer/prompts'

export const WIZARD_DEFAULTS = {
  bypass_for: ['fix/', 'hotfix/', 'chore/', 'docs/'],
  prd_required_fields: ['problem_statement', 'success_metrics', 'out_of_scope'],
  adr_triggers: [
    'new_external_dependency',
    'database_schema_change',
    'api_breaking_change',
    'infrastructure_change',
    'auth_change',
  ],
}

const PROVIDER_LABELS = { 'google-docs': 'Google Docs', 'confluence': 'Confluence' }

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$/i
export function validateClientId(provider, value) {
  if (!value.trim()) return 'client_id is required'
  if (provider === 'google-docs' && !value.endsWith('.apps.googleusercontent.com'))
    return 'Google client_id must end in .apps.googleusercontent.com'
  return true
}

export function validateDomain(value) {
  if (!value.trim()) return 'allowed_domain is required'
  if (!DOMAIN_RE.test(value.trim())) return 'Enter a valid domain (e.g. acme.com)'
  return true
}

export async function runWizard(prefilled = {}) {
  // Phase 1 — critical

  const docs_storage = prefilled.docs_storage
    ?? await select({
      message: 'How do you store PRDs and ADRs?',
      choices: [
        { value: 'local', name: 'local — full content in this repo' },
        { value: 'link', name: 'link — stub files pointing to Google Docs or Confluence' },
      ],
    })

  const docs_path = prefilled.docs_path
    ?? await input({
      message: 'Path to store PRDs, ADRs, and skip log:',
      default: 'docs/upstream/',
    })

  let providers = prefilled.providers ?? null
  if (docs_storage === 'link' && providers === null) {
    const selectedIds = await checkbox({
      message: 'Which providers will you use?',
      choices: Object.entries(PROVIDER_LABELS).map(([value, name]) => ({ value, name })),
    })
    providers = []
    for (const id of selectedIds) {
      const client_id = await input({
        message: `${PROVIDER_LABELS[id]} client_id:`,
        validate: (v) => validateClientId(id, v),
      })
      const domainHint = id === 'confluence'
        ? 'your Atlassian site domain (e.g. acme.atlassian.net)'
        : 'your org domain (e.g. acme.com)'
      const allowed_domain = await input({
        message: `${PROVIDER_LABELS[id]} allowed domain — ${domainHint}:`,
        validate: validateDomain,
      })
      providers.push({ id, client_id, allowed_domain })
    }
  }
  if (providers === null) providers = []

  const guardian = prefilled.guardian !== undefined
    ? prefilled.guardian
    : await input({
      message: 'Guardian GitHub handle or email (manages upstream config, leave blank to skip):',
      default: '',
    })

  // Phase 2 — org defaults

  let orgDefaults
  if (prefilled.bypass_for !== undefined) {
    orgDefaults = {
      bypass_for: prefilled.bypass_for ?? WIZARD_DEFAULTS.bypass_for,
      prd_required_fields: prefilled.prd_required_fields ?? WIZARD_DEFAULTS.prd_required_fields,
      adr_triggers: prefilled.adr_triggers ?? WIZARD_DEFAULTS.adr_triggers,
    }
  } else if (!process.stdin.isTTY) {
    orgDefaults = {
      bypass_for: WIZARD_DEFAULTS.bypass_for,
      prd_required_fields: WIZARD_DEFAULTS.prd_required_fields,
      adr_triggers: WIZARD_DEFAULTS.adr_triggers,
    }
  } else {
    const configureNow = await confirm({
      message: 'Configure org defaults now? (bypass prefixes, required PRD fields, ADR triggers)',
      default: false,
    })

    if (configureNow) {
      const bypassInput = await input({
        message: 'Branch prefixes that bypass checks (comma-separated):',
        default: WIZARD_DEFAULTS.bypass_for.join(', '),
      })
      const prdInput = await input({
        message: 'Required PRD fields (comma-separated):',
        default: WIZARD_DEFAULTS.prd_required_fields.join(', '),
      })
      const adrInput = await input({
        message: 'ADR triggers (comma-separated):',
        default: WIZARD_DEFAULTS.adr_triggers.join(', '),
      })
      orgDefaults = {
        bypass_for: bypassInput.split(',').map(s => s.trim()).filter(Boolean),
        prd_required_fields: prdInput.split(',').map(s => s.trim()).filter(Boolean),
        adr_triggers: adrInput.split(',').map(s => s.trim()).filter(Boolean),
      }
    } else {
      orgDefaults = {
        bypass_for: WIZARD_DEFAULTS.bypass_for,
        prd_required_fields: WIZARD_DEFAULTS.prd_required_fields,
        adr_triggers: WIZARD_DEFAULTS.adr_triggers,
      }
    }
  }

  return { docs_storage, docs_path, providers, guardian, ...orgDefaults }
}
