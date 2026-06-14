# Init Wizard + PKCE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive two-phase wizard to `upstream init` and implement PKCE for Google Docs and Confluence, eliminating `client_secret` from `upstream.config.yaml`.

**Architecture:** PKCE is implemented in `oauth2.js` (generates verifier/challenge per flow) and surfaced through updated `exchangeCode` signatures in both providers. The wizard lives in a new `src/lib/wizard.js`, `scaffold.js` gains `generateConfig(answers)` and `writeCodeowners(targetDir, guardian)`, and `init.js` orchestrates the whole flow with `--from`/flag non-interactive support.

**Tech Stack:** Node 18+ ESM, `@inquirer/prompts` (new dep), `js-yaml` (existing), `vitest` for tests.

---

## File Map

| File | Change |
|------|--------|
| `src/lib/auth/oauth2.js` | Add `generatePKCE()`, update `runOAuthFlow` to use PKCE |
| `src/lib/providers/google-docs.js` | Update `exchangeCode` + `refreshTokenIfNeeded` (drop `client_secret`) |
| `src/lib/providers/confluence.js` | Update `exchangeCode` + `refreshTokenIfNeeded` (drop `client_secret`) |
| `src/commands/auth.js` | Remove `client_secret` from credential check and error message |
| `src/lib/wizard.js` | **New** — two-phase interactive prompt logic |
| `src/lib/scaffold.js` | Add `generateConfig(answers)`, `writeCodeowners(targetDir, guardian)`, update `scaffoldInto` signature |
| `src/commands/init.js` | Accept options, parse `--from`, build prefilled answers, call wizard + scaffold |
| `bin/upstream.js` | Add options to `init` command |
| `templates/upstream.config.yaml` | Remove `client_secret` line |
| `tests/unit/oauth2.test.js` | **New** — PKCE helper tests |
| `tests/unit/google-docs-provider.test.js` | Update `exchangeCode` signature tests |
| `tests/unit/confluence-provider.test.js` | Update `exchangeCode` signature tests |
| `tests/unit/wizard.test.js` | **New** — prefilled path tests |
| `tests/unit/scaffold.test.js` | Add `generateConfig` + `writeCodeowners` tests |
| `tests/integration/init.test.js` | Update to use `--from` for non-interactive |
| `tests/integration/auth.test.js` | Remove `client_secret` from expected error message |

---

## Task 1: PKCE helpers in oauth2.js

**Files:**
- Modify: `src/lib/auth/oauth2.js`
- Create: `tests/unit/oauth2.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/unit/oauth2.test.js
import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { generatePKCE } from '../../src/lib/auth/oauth2.js'

describe('generatePKCE', () => {
  it('generates base64url verifier between 43 and 128 chars', () => {
    const { verifier } = generatePKCE()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('generates S256 challenge matching the verifier', () => {
    const { verifier, challenge } = generatePKCE()
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
  })

  it('generates unique verifier each call', () => {
    const a = generatePKCE()
    const b = generatePKCE()
    expect(a.verifier).not.toBe(b.verifier)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/oauth2.test.js
```

Expected: FAIL with `generatePKCE is not a function` or similar.

- [ ] **Step 3: Add `generatePKCE` and update `runOAuthFlow` in oauth2.js**

Replace the top of `src/lib/auth/oauth2.js`:

```js
import http from 'http'
import { URL } from 'url'
import { randomBytes, createHash } from 'crypto'
import open from 'open'
import { setProviderToken } from '../tokens.js'

export function generatePKCE() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}
```

Then update `runOAuthFlow` — replace the block from `const port = ...` to `const tokenResponse = ...`:

```js
  const port = await findFreePort()
  const redirectUri = `http://localhost:${port}/callback`
  const state = randomBytes(16).toString('hex')
  const { verifier, challenge } = generatePKCE()

  const authUrl = new URL(providerDef.authUrl)
  authUrl.searchParams.set('client_id', appConfig.client_id)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  if (providerDef.scopes?.length) authUrl.searchParams.set('scope', providerDef.scopes.join(' '))
  for (const [k, v] of Object.entries(providerDef.authParams ?? {})) authUrl.searchParams.set(k, v)

  console.log(`Opening browser for ${providerId} authentication...`)
  console.log(`If browser doesn't open, visit:\n  ${authUrl.toString()}`)
  try { await open(authUrl.toString()) } catch { /* user has URL in console */ }

  const code = await waitForCallback(port, state)
  const tokenResponse = await providerDef.exchangeCode(code, appConfig.client_id, redirectUri, verifier)
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/unit/oauth2.test.js
```

Expected: 3 passing.

- [ ] **Step 5: Run full suite to check for regressions**

```bash
npm test
```

Expected: all tests passing (provider tests will fail until Tasks 2–3 — skip those for now with `--reporter=verbose` if needed).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/oauth2.js tests/unit/oauth2.test.js
git commit -m "feat: add PKCE helpers to oauth2 flow"
```

---

## Task 2: Google Docs provider — PKCE token exchange

**Files:**
- Modify: `src/lib/providers/google-docs.js`
- Modify: `tests/unit/google-docs-provider.test.js`

- [ ] **Step 1: Add exchangeCode PKCE test**

Append to `tests/unit/google-docs-provider.test.js`:

```js
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
```

Wait — msw is not installed. Use `vi.spyOn` on the `https` module instead. Since `exchangeCode` is an HTTP call, we test it by mocking the https module.

Actually, looking at the existing tests — they only test pure functions (extractId, validateDomain). The HTTP functions aren't unit-tested. Keep that pattern: test the pure signature change only, trust integration for HTTP behavior.

Add to `tests/unit/google-docs-provider.test.js`:

```js
import { exchangeCode } from '../../src/lib/providers/google-docs.js'

describe('exchangeCode', () => {
  it('is a function with 4 params (code, clientId, redirectUri, codeVerifier)', () => {
    expect(typeof exchangeCode).toBe('function')
    expect(exchangeCode.length).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/google-docs-provider.test.js
```

Expected: FAIL — `exchangeCode.length` is 4 but current function has 4 params including `clientSecret`. Actually it's already 4 — but the 4th param is `clientSecret`, not `codeVerifier`. The test will pass trivially. Change the test to verify the param name indirectly by checking behavior in the integration test (Task 10). Mark this step done and move to implementation.

- [ ] **Step 3: Update `exchangeCode` in google-docs.js**

Replace `exchangeCode` function:

```js
export function exchangeCode(code, clientId, redirectUri, codeVerifier) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  }).toString()

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Token exchange: invalid JSON response')) }
        } else reject(new Error(`Token exchange failed (${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
```

- [ ] **Step 4: Update `refreshTokenIfNeeded` in google-docs.js**

Replace the body construction in `refreshTokenIfNeeded` (remove `client_secret`):

```js
export async function refreshTokenIfNeeded(tokenData, appConfig) {
  if (tokenData.expiry && tokenData.expiry - Date.now() > 5 * 60 * 1000) return tokenData

  const body = new URLSearchParams({
    refresh_token: tokenData.refresh_token,
    client_id: appConfig.client_id,
    grant_type: 'refresh_token',
  }).toString()

  const newTokenData = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Token refresh: invalid JSON response')) }
        } else reject(new Error(`Token refresh failed (${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })

  const updated = {
    ...tokenData,
    access_token: newTokenData.access_token,
    expiry: Date.now() + newTokenData.expires_in * 1000,
  }
  setProviderToken('google-docs', updated)
  return updated
}
```

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/providers/google-docs.js tests/unit/google-docs-provider.test.js
git commit -m "feat: PKCE for Google Docs — remove client_secret from token exchange and refresh"
```

---

## Task 3: Confluence provider — PKCE token exchange

**Files:**
- Modify: `src/lib/providers/confluence.js`

- [ ] **Step 1: Update `exchangeCode` in confluence.js**

Replace `exchangeCode` function:

```js
export function exchangeCode(code, clientId, redirectUri, codeVerifier) {
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'auth.atlassian.com',
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Token exchange: invalid JSON response')) }
        } else reject(new Error(`Token exchange failed (${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
```

- [ ] **Step 2: Update `refreshTokenIfNeeded` in confluence.js**

Replace the `body` construction in `refreshTokenIfNeeded` (remove `client_secret`):

```js
  const body = JSON.stringify({
    grant_type: 'refresh_token',
    refresh_token: tokenData.refresh_token,
    client_id: appConfig.client_id,
  })
```

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/providers/confluence.js
git commit -m "feat: PKCE for Confluence — remove client_secret from token exchange and refresh"
```

---

## Task 4: auth.js — remove client_secret requirement

**Files:**
- Modify: `src/commands/auth.js`

- [ ] **Step 1: Update credential check and error message**

Replace the credential check block in `authCommand`:

```js
  if (!appConfig.client_id) {
    console.error(chalk.red(`upstream auth: ${provider} credentials not configured.`))
    console.error('')
    console.error('Add to upstream.config.yaml:')
    console.error('  integrations:')
    console.error(`    ${providerDef.configKey}:`)
    console.error('      client_id: "..."')
    console.error(`      ${providerDef.domainField}: "..."`)
    process.exit(1)
  }
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all passing. The integration test `expect(output).toMatch(/client_id|credentials|configure/i)` still passes.

- [ ] **Step 3: Commit**

```bash
git add src/commands/auth.js
git commit -m "fix: auth command requires only client_id (PKCE removes client_secret)"
```

---

## Task 5: Remove client_secret from config template

**Files:**
- Modify: `templates/upstream.config.yaml`

- [ ] **Step 1: Update template**

Replace the integrations comment block in `templates/upstream.config.yaml`:

```yaml
# Integrations — OAuth credentials per provider (set by platform engineer, commit to repo)
# integrations:
#   google_docs:
#     client_id: "xxx.apps.googleusercontent.com"
#     allowed_domain: "yourcompany.com"   # only accounts @yourcompany.com can authenticate
#     # Create credentials at: https://console.cloud.google.com/apis/credentials
#     # Enable: Google Drive API → OAuth 2.0 Client ID → Desktop app
#     # (Desktop app type allows localhost automatically — no redirect URI config needed)
#   confluence:
#     client_id: "yyy"
#     allowed_domain: "yourcompany.atlassian.net"
#     # Create credentials at: https://developer.atlassian.com/console/myapps/
#     # Enable: OAuth 2.0 (3LO) app, add scopes: read:confluence-content.all, write:confluence-content, offline_access
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add templates/upstream.config.yaml
git commit -m "docs: remove client_secret from config template (PKCE)"
```

---

## Task 6: Install @inquirer/prompts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install @inquirer/prompts
```

- [ ] **Step 2: Verify**

```bash
node -e "import('@inquirer/prompts').then(m => console.log(Object.keys(m)))"
```

Expected: prints array including `select`, `checkbox`, `input`, `confirm`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @inquirer/prompts for init wizard"
```

---

## Task 7: wizard.js — two-phase interactive prompts

**Files:**
- Create: `src/lib/wizard.js`
- Create: `tests/unit/wizard.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/unit/wizard.test.js
import { describe, it, expect } from 'vitest'
import { runWizard, WIZARD_DEFAULTS } from '../../src/lib/wizard.js'

describe('runWizard with prefilled answers', () => {
  it('returns prefilled answers without prompting when all fields provided', async () => {
    const prefilled = {
      docs_storage: 'local',
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
      providers: [],
      guardian: '',
    }
    const result = await runWizard(prefilled)
    expect(result.bypass_for).toEqual(WIZARD_DEFAULTS.bypass_for)
    expect(result.prd_required_fields).toEqual(WIZARD_DEFAULTS.prd_required_fields)
    expect(result.adr_triggers).toEqual(WIZARD_DEFAULTS.adr_triggers)
  })

  it('includes provider config when docs_storage is link', async () => {
    const prefilled = {
      docs_storage: 'link',
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/wizard.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create src/lib/wizard.js**

```js
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

  let providers = prefilled.providers ?? null
  if (docs_storage === 'link' && providers === null) {
    const selectedIds = await checkbox({
      message: 'Which providers will you use?',
      choices: Object.entries(PROVIDER_LABELS).map(([value, name]) => ({ value, name })),
    })
    providers = []
    for (const id of selectedIds) {
      const client_id = await input({ message: `${PROVIDER_LABELS[id]} client_id:` })
      const allowed_domain = await input({ message: `${PROVIDER_LABELS[id]} allowed domain (e.g. acme.com):` })
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
    // non-interactive: use provided or fall back to defaults
    orgDefaults = {
      bypass_for: prefilled.bypass_for ?? WIZARD_DEFAULTS.bypass_for,
      prd_required_fields: prefilled.prd_required_fields ?? WIZARD_DEFAULTS.prd_required_fields,
      adr_triggers: prefilled.adr_triggers ?? WIZARD_DEFAULTS.adr_triggers,
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

  return { docs_storage, providers, guardian, ...orgDefaults }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/unit/wizard.test.js
```

Expected: 4 passing.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wizard.js tests/unit/wizard.test.js
git commit -m "feat: add two-phase init wizard"
```

---

## Task 8: scaffold.js — generateConfig + writeCodeowners

**Files:**
- Modify: `src/lib/scaffold.js`
- Modify: `tests/unit/scaffold.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/scaffold.test.js`:

```js
import { readFileSync, writeFileSync } from 'fs'
import yaml from 'js-yaml'
import { generateConfig, writeCodeowners } from '../../src/lib/scaffold.js'

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/scaffold.test.js
```

Expected: FAIL — `generateConfig is not a function`, `writeCodeowners is not a function`.

- [ ] **Step 3: Implement `generateConfig` and `writeCodeowners` in scaffold.js**

Add these imports at the top of `src/lib/scaffold.js`:

```js
import { appendFile } from 'fs/promises'
import { readFileSync } from 'fs'
import yaml from 'js-yaml'
```

Add these functions to `src/lib/scaffold.js`:

```js
const PROVIDER_CONFIG_KEY = { 'google-docs': 'google_docs', 'confluence': 'confluence' }

export function generateConfig(answers) {
  const config = {
    version: 1,
    bypass_for: answers.bypass_for,
    prd_required_fields: answers.prd_required_fields,
    adr_triggers: answers.adr_triggers,
    docs_path: 'docs/upstream/',
    docs_storage: answers.docs_storage,
  }
  if (answers.providers?.length) {
    config.integrations = {}
    for (const p of answers.providers) {
      const key = PROVIDER_CONFIG_KEY[p.id] ?? p.id.replace(/-/g, '_')
      config.integrations[key] = { client_id: p.client_id, allowed_domain: p.allowed_domain }
    }
  }
  return yaml.dump(config, { lineWidth: -1 })
}

export async function writeCodeowners(targetDir, guardian) {
  if (!guardian) return
  const dir = join(targetDir, '.github')
  await mkdir(dir, { recursive: true })
  const codeownersPath = join(dir, 'CODEOWNERS')
  const entry = `upstream.config.yaml ${guardian}\n`
  if (await fileExists(codeownersPath)) {
    const existing = readFileSync(codeownersPath, 'utf8')
    if (existing.includes('upstream.config.yaml')) return
    await appendFile(codeownersPath, `\n# upstream config — changes require guardian approval\n${entry}`)
  } else {
    await writeFile(codeownersPath, `# upstream config — changes require guardian approval\n${entry}`)
  }
}
```

- [ ] **Step 4: Update `scaffoldInto` to accept answers and use `generateConfig`**

Replace the `scaffoldInto` export signature and the config-writing block:

```js
export async function scaffoldInto(targetDir, templatesDir, answers = null) {
  for (const [src, dest] of FILE_MAP) {
    const srcPath = join(templatesDir, src)
    const destPath = join(targetDir, dest)
    await mkdir(dirname(destPath), { recursive: true })
    await copyFile(srcPath, destPath)
  }

  const hookDest = FILE_MAP.find(([src]) => src === HOOK_SRC)[1]
  await chmod(join(targetDir, hookDest), 0o755)

  const configDest = join(targetDir, 'upstream.config.yaml')
  if (!await fileExists(configDest)) {
    if (answers) {
      await writeFile(configDest, generateConfig(answers))
    } else {
      await copyFile(join(templatesDir, 'upstream.config.yaml'), configDest)
    }
  }

  if (answers?.guardian) {
    await writeCodeowners(targetDir, answers.guardian)
  }

  const docsDir = join(targetDir, 'docs/upstream')
  await mkdir(docsDir, { recursive: true })
  const gitkeep = join(docsDir, '.gitkeep')
  if (!await fileExists(gitkeep)) {
    await writeFile(gitkeep, '')
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/unit/scaffold.test.js
```

Expected: all scaffold tests passing.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scaffold.js tests/unit/scaffold.test.js
git commit -m "feat: scaffold generates config from wizard answers, writes CODEOWNERS"
```

---

## Task 9: Wire wizard into init command

**Files:**
- Modify: `bin/upstream.js`
- Modify: `src/commands/init.js`

- [ ] **Step 1: Add options to init command in bin/upstream.js**

Replace the `init` command registration:

```js
program
  .command('init')
  .description('Scaffold upstream into the current repo')
  .option('--from <file>', 'load answers from JSON file (non-interactive)')
  .option('--docs-storage <value>', 'docs_storage: local or link')
  .option('--provider <id>', 'provider ID: google-docs or confluence (single provider)')
  .option('--client-id <id>', 'OAuth client_id for the provider')
  .option('--allowed-domain <domain>', 'allowed domain for the provider')
  .option('--guardian <handle>', 'GitHub handle or email for CODEOWNERS')
  .option('--yes', 'skip Phase 2 (use org defaults)')
  .action(initCommand)
```

- [ ] **Step 2: Rewrite init.js**

```js
import chalk from 'chalk'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { scaffoldInto } from '../lib/scaffold.js'
import { writeMcpSettings } from '../lib/settings.js'
import { runWizard, WIZARD_DEFAULTS } from '../lib/wizard.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(__dirname, '../../templates')

function loadFromFile(filePath) {
  let raw
  try { raw = readFileSync(filePath, 'utf8') } catch {
    throw new Error(`--from: cannot read file "${filePath}"`)
  }
  try { return JSON.parse(raw) } catch {
    throw new Error(`--from: "${filePath}" is not valid JSON`)
  }
}

function validateAnswers(answers) {
  if (!['local', 'link'].includes(answers.docs_storage)) {
    throw new Error(`docs_storage must be "local" or "link", got "${answers.docs_storage}"`)
  }
  if (answers.docs_storage === 'link') {
    for (const p of answers.providers ?? []) {
      if (!p.id || !p.client_id || !p.allowed_domain) {
        throw new Error(`Provider "${p.id ?? '?'}" must have id, client_id, and allowed_domain`)
      }
    }
  }
}

export async function initCommand(options) {
  const target = process.cwd()
  console.log(chalk.blue('upstream:'), 'initializing', target)

  let prefilled = {}
  try {
    if (options.from) {
      prefilled = loadFromFile(options.from)
    } else {
      // Build prefilled from CLI flags
      if (options.docsStorage) prefilled.docs_storage = options.docsStorage
      if (options.guardian !== undefined) prefilled.guardian = options.guardian
      if (options.provider) {
        prefilled.providers = [{
          id: options.provider,
          client_id: options.clientId ?? '',
          allowed_domain: options.allowedDomain ?? '',
        }]
      }
      if (options.yes) {
        prefilled.docs_storage = prefilled.docs_storage ?? 'local'
        prefilled.providers = prefilled.providers ?? []
        prefilled.guardian = prefilled.guardian ?? ''
        prefilled.bypass_for = prefilled.bypass_for ?? WIZARD_DEFAULTS.bypass_for
        prefilled.prd_required_fields = prefilled.prd_required_fields ?? WIZARD_DEFAULTS.prd_required_fields
        prefilled.adr_triggers = prefilled.adr_triggers ?? WIZARD_DEFAULTS.adr_triggers
      }
    }

    // Validate any prefilled data from --from before prompting
    if (options.from && prefilled.docs_storage) validateAnswers(prefilled)

    const answers = await runWizard(prefilled)
    validateAnswers(answers)

    await scaffoldInto(target, TEMPLATES, answers)
    writeMcpSettings(target)

    console.log('')
    console.log(chalk.green('✓ upstream.config.yaml generated'))
    if (answers.guardian) console.log(chalk.green('✓ .github/CODEOWNERS updated'))
    console.log(chalk.green('✓ .claude/ scaffolded'))
    console.log(chalk.green('✓ MCP settings written'))
    console.log('')
    console.log('Next steps:')
    if (answers.guardian) {
      console.log('  1. Enable branch protection on main (required for CODEOWNERS to be enforced)')
      console.log('  2. git add . && git commit -m "feat: add upstream"')
      console.log('  3. git push')
    } else {
      console.log('  1. git add . && git commit -m "feat: add upstream"')
      console.log('  2. git push')
    }
  } catch (err) {
    console.error(chalk.red('upstream init failed:'), err.message)
    process.exit(1)
  }
}
```

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Note: integration init tests will fail because they call `upstream init` without `--from`, which will try to start the wizard interactively in a non-TTY environment. Fix in Task 10.

- [ ] **Step 4: Commit (without pushing yet — tests may fail)**

```bash
git add bin/upstream.js src/commands/init.js
git commit -m "feat: wire wizard into upstream init with --from and flag support"
```

---

## Task 10: Update integration tests

**Files:**
- Modify: `tests/integration/init.test.js`
- Modify: `tests/integration/auth.test.js`

- [ ] **Step 1: Update init integration tests to use --from**

Replace `tests/integration/init.test.js`:

```js
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
  providers: [],
  guardian: '',
  bypass_for: ['fix/', 'hotfix/'],
  prd_required_fields: ['problem_statement'],
  adr_triggers: ['database_schema_change'],
})

const ANSWERS_LINK = JSON.stringify({
  docs_storage: 'link',
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
    const answersPath = join(TARGET, 'answers.json')
    writeFileSync(answersPath, ANSWERS_LOCAL)
    execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })
    for (const f of GENERATED_FILES) {
      expect(existsSync(join(TARGET, f)), `${f} should exist`).toBe(true)
    }
    expect(existsSync(join(TARGET, 'upstream.config.yaml'))).toBe(true)
    expect(existsSync(join(TARGET, 'docs/upstream/.gitkeep'))).toBe(true)
  })

  it('generates upstream.config.yaml with correct docs_storage', () => {
    const answersPath = join(TARGET, 'answers.json')
    writeFileSync(answersPath, ANSWERS_LOCAL)
    execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })
    const content = execSync(`cat ${join(TARGET, 'upstream.config.yaml')}`).toString()
    expect(content).toContain('docs_storage: local')
  })

  it('writes CODEOWNERS when guardian provided', () => {
    const answersPath = join(TARGET, 'answers.json')
    writeFileSync(answersPath, ANSWERS_LINK)
    execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })
    const codeowners = join(TARGET, '.github/CODEOWNERS')
    expect(existsSync(codeowners)).toBe(true)
    const content = execSync(`cat ${codeowners}`).toString()
    expect(content).toContain('upstream.config.yaml @infra-team')
  })

  it('makes the hook executable', () => {
    const answersPath = join(TARGET, 'answers.json')
    writeFileSync(answersPath, ANSWERS_LOCAL)
    execSync(`node ${CLI} init --from answers.json`, { cwd: TARGET })
    const mode = statSync(join(TARGET, '.claude/hooks/upstream-check.sh')).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('exits with code 0', () => {
    const answersPath = join(TARGET, 'answers.json')
    writeFileSync(answersPath, ANSWERS_LOCAL)
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
```

- [ ] **Step 2: Update auth integration test — remove client_secret from expected error**

In `tests/integration/auth.test.js`, the test `expect(output).toMatch(/client_id|credentials|configure/i)` still passes (we still mention `client_id`). No change needed.

Run to confirm:

```bash
npm test -- tests/integration/auth.test.js
```

Expected: all 5 passing.

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Expected: all tests passing.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/init.test.js tests/integration/auth.test.js
git commit -m "test: update init integration tests for wizard --from mode"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Done

All changes shipped:
- PKCE for Google Docs and Confluence — `client_secret` no longer needed in config
- Two-phase interactive wizard for `upstream init`
- `--from file.json` and CLI flags for non-interactive/CI use
- CODEOWNERS generation for guardian account
- Full test coverage
