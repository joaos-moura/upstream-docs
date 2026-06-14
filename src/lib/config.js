import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'

export const DEFAULT_CONFIG = {
  version: 1,
  bypass_for: ['fix/', 'hotfix/', 'chore/', 'docs/'],
  prd_required_fields: ['problem_statement', 'success_metrics', 'out_of_scope'],
  adr_triggers: [
    'new_external_dependency',
    'database_schema_change',
    'api_breaking_change',
    'infrastructure_change',
    'auth_change',
  ],
  docs_path: 'docs/upstream/',
  docs_storage: 'local',
  integrations: {},
  link_policy: {},
}

export function readConfig(configPath) {
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }
  const raw = readFileSync(configPath, 'utf8')
  const parsed = yaml.load(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_CONFIG }
  return { ...DEFAULT_CONFIG, ...parsed }
}
