# Notion & Confluence Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Notion and Confluence Cloud as fully-functional providers alongside the existing Google Docs integration, covering OAuth auth with domain enforcement, link validation, and document creation.

**Architecture:** Extract a shared `oauth2.js` HTTP server flow; refactor each provider (google-docs, notion, confluence) to export `extractId`, `exchangeCode`, `getIdentity`, `validateDomain`, `getMetadata`, `refreshTokenIfNeeded`, and `createDocument`; wire all three through a central `registry.js` so `auth.js`, `validate-link.js`, and the new `create-document.js` MCP tool are provider-agnostic.

**Tech Stack:** Node.js ESM, `https` (stdlib), `vitest` for unit tests, `@modelcontextprotocol/sdk` for MCP tools, Notion API v1, Confluence REST API (v1 for create, v2 for read), Google Drive/Userinfo APIs.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/auth/oauth2.js` | Shared HTTP server, auth URL builder, `runOAuthFlow` |
| Modify | `src/lib/providers/google-docs.js` | Add `exchangeCode`, `getIdentity`, `validateDomain`, `createDocument`; rename `extractDocId→extractId`, `getFileMetadata→getMetadata`; update `refreshTokenIfNeeded` signature |
| Delete | `src/lib/auth/google-docs.js` | Logic moves to `oauth2.js` + `providers/google-docs.js` |
| Create | `src/lib/providers/registry.js` | Central provider definitions |
| Create | `src/lib/providers/notion.js` | Notion API functions |
| Create | `src/lib/providers/confluence.js` | Confluence API functions |
| Modify | `src/commands/auth.js` | Use registry + `runOAuthFlow`, remove hardcoded google-docs |
| Modify | `src/lib/mcp/tools/validate-link.js` | Use registry |
| Create | `src/lib/mcp/tools/create-document.js` | New MCP tool |
| Modify | `src/lib/mcp/server.js` | Register `create_document` tool |
| Modify | `tests/unit/google-docs-provider.test.js` | Update imports (`extractDocId→extractId`) |
| Modify | `tests/unit/validate-link.test.js` | Add Notion/Confluence cases |
| Create | `tests/unit/notion-provider.test.js` | Unit tests for Notion provider |
| Create | `tests/unit/confluence-provider.test.js` | Unit tests for Confluence provider |
| Modify | `tests/integration/auth.test.js` | Add Notion/Confluence missing-config + domain-validation cases |

---

## Task 1: Create shared OAuth2 utilities

**Files:**
- Create: `src/lib/auth/oauth2.js`

- [ ] **Step 1: Write the file**

```js
// src/lib/auth/oauth2.js
import http from 'http'
import { URL } from 'url'
import { randomBytes } from 'crypto'
import open from 'open'
import { setProviderToken } from '../tokens.js'

export async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

export function waitForCallback(port, expectedState) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`)
      const code = u.searchParams.get('code')
      const error = u.searchParams.get('error')
      const state = u.searchParams.get('state')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>upstream: Authentication complete. You can close this tab.</h2></body></html>')
      srv.close()

      if (error) reject(new Error(`OAuth cancelled: ${error}`))
      else if (state !== expectedState) reject(new Error('OAuth state mismatch — possible CSRF attempt'))
      else if (code) resolve(code)
      else reject(new Error('No authorization code received'))
    })

    srv.listen(port)
    srv.on('error', reject)
    setTimeout(
      () => { srv.close(); reject(new Error('Authentication timed out after 5 minutes')) },
      5 * 60 * 1000
    )
  })
}

export async function runOAuthFlow(providerId, providerDef, appConfig) {
  const domainValue = appConfig[providerDef.domainField]
  if (!domainValue) {
    throw new Error(
      `${providerDef.domainField} is not configured in upstream.config.yaml integrations.${providerDef.configKey}`
    )
  }

  const port = await findFreePort()
  const redirectUri = `http://localhost:${port}/callback`
  const state = randomBytes(16).toString('hex')

  const authUrl = new URL(providerDef.authUrl)
  authUrl.searchParams.set('client_id', appConfig.client_id)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)
  if (providerDef.scopes?.length) authUrl.searchParams.set('scope', providerDef.scopes.join(' '))
  for (const [k, v] of Object.entries(providerDef.authParams ?? {})) authUrl.searchParams.set(k, v)

  console.log(`Opening browser for ${providerId} authentication...`)
  console.log(`If browser doesn't open, visit:\n  ${authUrl.toString()}`)
  try { await open(authUrl.toString()) } catch { /* user has URL in console */ }

  const code = await waitForCallback(port, state)
  const tokenResponse = await providerDef.exchangeCode(code, appConfig.client_id, appConfig.client_secret, redirectUri)

  const identity = await providerDef.getIdentity(tokenResponse.access_token, tokenResponse)

  if (!providerDef.validateDomain(identity, appConfig)) {
    throw new Error(
      `Your account does not belong to the ${providerDef.domainField} configured for this org (expected: ${domainValue})`
    )
  }

  let tokenData = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token ?? null,
    expiry: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : null,
  }
  if (providerDef.enrichToken) tokenData = providerDef.enrichToken(tokenData, identity, appConfig)

  setProviderToken(providerId, tokenData)
}
```

- [ ] **Step 2: Run tests to confirm nothing broken yet**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/oauth2.js
git commit -m "feat: add shared OAuth2 flow utilities"
```

---

## Task 2: Refactor google-docs provider

Renames two functions and adds five new ones. `auth/google-docs.js` becomes redundant and is deleted.

**Files:**
- Modify: `src/lib/providers/google-docs.js`
- Delete: `src/lib/auth/google-docs.js`
- Modify: `tests/unit/google-docs-provider.test.js`

- [ ] **Step 1: Write the updated provider file**

```js
// src/lib/providers/google-docs.js
import https from 'https'
import { setProviderToken } from '../tokens.js'

export function extractId(url) {
  const match = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

export function exchangeCode(code, clientId, clientSecret, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
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

export async function getIdentity(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo?fields=email',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed) resolve(parsed)
        else reject(new Error(`Failed to get Google identity (${res.statusCode})`))
      })
    })
    req.on('error', reject)
  })
}

export function validateDomain(identity, config) {
  if (!config.allowed_domain) return false
  return identity.email?.endsWith(`@${config.allowed_domain}`) ?? false
}

export async function getMetadata(docId, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${docId}?fields=name,modifiedTime`,
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed) resolve(parsed)
        else {
          const msg = parsed?.error?.message || `Drive API error ${res.statusCode}`
          const err = new Error(msg)
          err.status = res.statusCode
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

export async function refreshTokenIfNeeded(tokenData, appConfig) {
  if (tokenData.expiry - Date.now() > 5 * 60 * 1000) return tokenData

  const body = new URLSearchParams({
    refresh_token: tokenData.refresh_token,
    client_id: appConfig.client_id,
    client_secret: appConfig.client_secret,
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

export async function createDocument(title, content, destination, tokenData) {
  const boundary = 'upstream_multipart_boundary'
  const metadata = JSON.stringify({
    name: title,
    mimeType: 'application/vnd.google-apps.document',
    ...(destination ? { parents: [destination] } : {}),
  })
  const multipart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/html',
    '',
    content || '',
    `--${boundary}--`,
  ].join('\r\n')

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/upload/drive/v3/files?uploadType=multipart',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(multipart),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed?.id) {
          resolve({ url: `https://docs.google.com/document/d/${parsed.id}/edit` })
        } else {
          const msg = parsed?.error?.message || `Drive API error ${res.statusCode}`
          reject(new Error(msg))
        }
      })
    })
    req.on('error', reject)
    req.write(multipart)
    req.end()
  })
}
```

- [ ] **Step 2: Update google-docs provider test**

```js
// tests/unit/google-docs-provider.test.js
import { describe, it, expect } from 'vitest'
import { extractId, validateDomain } from '../../src/lib/providers/google-docs.js'

describe('extractId', () => {
  it('extracts ID from standard Google Docs URL', () => {
    const url = 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit'
    expect(extractId(url)).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms')
  })

  it('extracts ID from URL without trailing path', () => {
    const url = 'https://docs.google.com/document/d/abc123def456'
    expect(extractId(url)).toBe('abc123def456')
  })

  it('extracts ID with underscores and hyphens', () => {
    const url = 'https://docs.google.com/document/d/1a-b_C2/edit?usp=sharing'
    expect(extractId(url)).toBe('1a-b_C2')
  })

  it('returns null for non-Google Docs URL', () => {
    expect(extractId('https://notion.so/some-page')).toBeNull()
  })

  it('returns null for malformed URL', () => {
    expect(extractId('not a url')).toBeNull()
  })

  it('returns null for Google Docs URL without document ID', () => {
    expect(extractId('https://docs.google.com/document/')).toBeNull()
  })
})

describe('validateDomain', () => {
  it('returns true when email matches allowed_domain', () => {
    expect(validateDomain({ email: 'dev@acme.com' }, { allowed_domain: 'acme.com' })).toBe(true)
  })

  it('returns false when email does not match allowed_domain', () => {
    expect(validateDomain({ email: 'dev@other.com' }, { allowed_domain: 'acme.com' })).toBe(false)
  })

  it('returns false when allowed_domain is not configured', () => {
    expect(validateDomain({ email: 'dev@acme.com' }, {})).toBe(false)
  })

  it('returns false when email is missing', () => {
    expect(validateDomain({}, { allowed_domain: 'acme.com' })).toBe(false)
  })
})
```

- [ ] **Step 3: Delete the now-redundant auth/google-docs.js**

```bash
rm src/lib/auth/google-docs.js
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all existing tests pass except `validate-link.test.js` which will fail because it imports `extractDocId` — fix that in Task 7.

> Note: if `validate-link.test.js` breaks, that is expected and will be fixed in Task 7. All other tests should pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/google-docs.js tests/unit/google-docs-provider.test.js
git rm src/lib/auth/google-docs.js
git commit -m "refactor: expand google-docs provider, remove redundant auth file"
```

---

## Task 3: Create provider registry

**Files:**
- Create: `src/lib/providers/registry.js`

- [ ] **Step 1: Write the registry** (notion.js and confluence.js don't exist yet — that's OK, they'll be added in Tasks 5–6 and the registry will be wired up then; for now write the google-docs entry only)

```js
// src/lib/providers/registry.js
import {
  extractId as googleDocsExtractId,
  exchangeCode as googleDocsExchangeCode,
  getIdentity as googleDocsGetIdentity,
  getMetadata as googleDocsGetMetadata,
  validateDomain as googleDocsValidateDomain,
  refreshTokenIfNeeded as googleDocsRefreshTokenIfNeeded,
  createDocument as googleDocsCreateDocument,
} from './google-docs.js'

export const PROVIDERS = {
  'google-docs': {
    configKey: 'google_docs',
    urlPattern: /docs\.google\.com\/document\/d\//,
    supportsRefresh: true,
    domainField: 'allowed_domain',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: [
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    authParams: { access_type: 'offline', prompt: 'consent' },
    enrichToken: null,
    extractId: googleDocsExtractId,
    exchangeCode: googleDocsExchangeCode,
    getIdentity: googleDocsGetIdentity,
    getMetadata: googleDocsGetMetadata,
    validateDomain: googleDocsValidateDomain,
    refreshTokenIfNeeded: googleDocsRefreshTokenIfNeeded,
    createDocument: googleDocsCreateDocument,
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/providers/registry.js
git commit -m "feat: add provider registry (google-docs only for now)"
```

---

## Task 4: Refactor auth.js to use registry

**Files:**
- Modify: `src/commands/auth.js`

- [ ] **Step 1: Rewrite auth.js**

```js
// src/commands/auth.js
import chalk from 'chalk'
import { join } from 'path'
import { readConfig } from '../lib/config.js'
import { PROVIDERS } from '../lib/providers/registry.js'
import { runOAuthFlow } from '../lib/auth/oauth2.js'
import { getProviderToken } from '../lib/tokens.js'

export async function authCommand(provider) {
  if (provider === 'status') return statusCommand()

  const providerDef = PROVIDERS[provider]
  if (!providerDef) {
    console.error(chalk.red(`Unknown provider: ${provider}`))
    console.error(`Known providers: ${Object.keys(PROVIDERS).join(', ')}`)
    process.exit(1)
  }

  const config = readConfig(join(process.cwd(), 'upstream.config.yaml'))
  const appConfig = config.integrations?.[providerDef.configKey] ?? {}

  if (!appConfig.client_id || !appConfig.client_secret) {
    console.error(chalk.red(`upstream auth: ${provider} credentials not configured.`))
    console.error('')
    console.error('Add to upstream.config.yaml:')
    console.error('  integrations:')
    console.error(`    ${providerDef.configKey}:`)
    console.error('      client_id: "..."')
    console.error('      client_secret: "..."')
    console.error(`      ${providerDef.domainField}: "..."`)
    process.exit(1)
  }

  try {
    await runOAuthFlow(provider, providerDef, appConfig)
    console.log(chalk.green(`✓ ${provider} connected.`))
  } catch (err) {
    console.error(chalk.red('upstream auth failed:'), err.message)
    process.exit(1)
  }
}

async function statusCommand() {
  console.log('')
  for (const [providerId] of Object.entries(PROVIDERS)) {
    const token = getProviderToken(providerId)
    if (!token) {
      console.log(`  ${providerId.padEnd(14)} ${chalk.red('✗')} not authenticated`)
    } else if (token.expiry) {
      const expires = new Date(token.expiry).toISOString().slice(0, 10)
      console.log(`  ${providerId.padEnd(14)} ${chalk.green('✓')} authenticated (expires ${expires})`)
    } else {
      console.log(`  ${providerId.padEnd(14)} ${chalk.green('✓')} authenticated`)
    }
  }
  console.log('')
}
```

- [ ] **Step 2: Run integration tests**

```bash
npm test -- tests/integration/auth.test.js
```

Expected: both existing tests pass (`google-docs credentials missing` and `auth status`).

- [ ] **Step 3: Commit**

```bash
git add src/commands/auth.js
git commit -m "refactor: auth command uses provider registry"
```

---

## Task 5: Create Notion provider

**Files:**
- Create: `src/lib/providers/notion.js`
- Create: `tests/unit/notion-provider.test.js`

- [ ] **Step 1: Write the provider**

```js
// src/lib/providers/notion.js
import https from 'https'
import { setProviderToken } from '../tokens.js'

export function extractId(url) {
  const segment = url.split('/').pop()?.split('?')[0]
  if (!segment) return null
  const clean = segment.replace(/-/g, '')
  const match = clean.match(/([a-f0-9]{32})$/i)
  return match ? match[1] : null
}

export function exchangeCode(code, clientId, clientSecret, redirectUri) {
  const body = JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com',
      path: '/v1/oauth/token',
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
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

// Notion embeds workspace info in the token exchange response — no extra API call needed.
export async function getIdentity(_accessToken, tokenResponse) {
  return {
    workspace_name: tokenResponse?.workspace_name ?? null,
    workspace_id: tokenResponse?.workspace_id ?? null,
  }
}

export function validateDomain(identity, config) {
  if (!config.allowed_workspace) return false
  return (
    identity.workspace_name === config.allowed_workspace ||
    identity.workspace_id === config.allowed_workspace
  )
}

export async function getMetadata(pageId, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.notion.com',
      path: `/v1/pages/${pageId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28',
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed) {
          const titleArr =
            parsed.properties?.title?.title ??
            parsed.properties?.Name?.title ??
            []
          const title = titleArr.map(t => t.plain_text).join('') || null
          resolve({ title, last_edited: parsed.last_edited_time ?? null })
        } else {
          const msg = parsed?.message || `Notion API error ${res.statusCode}`
          const err = new Error(msg)
          err.status = res.statusCode
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

export async function createDocument(title, content, destination, tokenData) {
  const body = JSON.stringify({
    parent: { type: 'page_id', page_id: destination },
    properties: {
      title: { title: [{ type: 'text', text: { content: title } }] },
    },
    children: content
      ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }]
      : [],
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com',
      path: '/v1/pages',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed?.url) {
          resolve({ url: parsed.url })
        } else {
          const msg = parsed?.message || `Notion API error ${res.statusCode}`
          reject(new Error(msg))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
```

- [ ] **Step 2: Write the unit test**

```js
// tests/unit/notion-provider.test.js
// HTTP-calling functions (getMetadata, createDocument) are covered via mocks in validate-link.test.js.
// This file tests only the pure functions.
import { describe, it, expect } from 'vitest'
import { extractId, validateDomain, getIdentity } from '../../src/lib/providers/notion.js'

describe('extractId', () => {
  it('extracts 32-char page ID from standard notion.so URL', () => {
    expect(extractId('https://www.notion.so/My-Page-abc123def456abc123def456abc12345'))
      .toBe('abc123def456abc123def456abc12345')
  })

  it('extracts ID from workspace-prefixed URL', () => {
    expect(extractId('https://notion.so/acme/PRD-Authentication-abc123def456abc123def456abc12345'))
      .toBe('abc123def456abc123def456abc12345')
  })

  it('handles UUID format with dashes', () => {
    expect(extractId('https://www.notion.so/abc123de-f456-abc1-23de-f456abc12345'))
      .toBe('abc123def456abc123def456abc12345')
  })

  it('returns null for URL without 32-char hex suffix', () => {
    expect(extractId('https://notion.so/workspace/')).toBeNull()
  })

  it('returns null for non-Notion URL', () => {
    expect(extractId('https://docs.google.com/document/d/abc')).toBeNull()
  })
})

describe('validateDomain', () => {
  it('returns true when workspace_name matches', () => {
    expect(validateDomain({ workspace_name: 'acme-corp', workspace_id: 'wid1' }, { allowed_workspace: 'acme-corp' }))
      .toBe(true)
  })

  it('returns true when workspace_id matches', () => {
    expect(validateDomain({ workspace_name: 'Acme Corp', workspace_id: 'wid1' }, { allowed_workspace: 'wid1' }))
      .toBe(true)
  })

  it('returns false when neither name nor id matches', () => {
    expect(validateDomain({ workspace_name: 'other', workspace_id: 'other-id' }, { allowed_workspace: 'acme-corp' }))
      .toBe(false)
  })

  it('returns false when allowed_workspace is not configured', () => {
    expect(validateDomain({ workspace_name: 'acme-corp', workspace_id: 'wid1' }, {})).toBe(false)
  })
})

describe('getIdentity', () => {
  it('extracts workspace info from token response', async () => {
    const tokenResponse = { access_token: 'tok', workspace_name: 'Acme', workspace_id: 'wid-123' }
    const identity = await getIdentity('tok', tokenResponse)
    expect(identity).toEqual({ workspace_name: 'Acme', workspace_id: 'wid-123' })
  })

  it('returns nulls when token response lacks workspace fields', async () => {
    const identity = await getIdentity('tok', {})
    expect(identity).toEqual({ workspace_name: null, workspace_id: null })
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/unit/notion-provider.test.js
```

Expected: all pass.

- [ ] **Step 4: Add Notion to registry**

Add to `src/lib/providers/registry.js`, after the google-docs entry:

```js
// At the top of registry.js, add:
import {
  extractId as notionExtractId,
  exchangeCode as notionExchangeCode,
  getIdentity as notionGetIdentity,
  getMetadata as notionGetMetadata,
  validateDomain as notionValidateDomain,
  createDocument as notionCreateDocument,
} from './notion.js'

// In PROVIDERS, add:
  'notion': {
    configKey: 'notion',
    urlPattern: /notion\.so\//,
    supportsRefresh: false,
    domainField: 'allowed_workspace',
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    scopes: [],
    authParams: { owner: 'user' },
    enrichToken: null,
    extractId: notionExtractId,
    exchangeCode: notionExchangeCode,
    getIdentity: notionGetIdentity,
    getMetadata: notionGetMetadata,
    validateDomain: notionValidateDomain,
    refreshTokenIfNeeded: null,
    createDocument: notionCreateDocument,
  },
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/providers/notion.js src/lib/providers/registry.js tests/unit/notion-provider.test.js
git commit -m "feat: add Notion provider"
```

---

## Task 6: Create Confluence provider

**Files:**
- Create: `src/lib/providers/confluence.js`
- Create: `tests/unit/confluence-provider.test.js`

- [ ] **Step 1: Write the provider**

```js
// src/lib/providers/confluence.js
import https from 'https'
import { URL } from 'url'
import { setProviderToken } from '../tokens.js'

export function extractId(url) {
  const baseUrl = url.match(/(https?:\/\/[^/]+)/)?.[1] ?? null
  const pathMatch = url.match(/\/pages\/(\d+)/)
  if (pathMatch) return { id: pathMatch[1], baseUrl }
  const queryMatch = url.match(/[?&]pageId=(\d+)/)
  if (queryMatch) return { id: queryMatch[1], baseUrl }
  return null
}

export function exchangeCode(code, clientId, clientSecret, redirectUri) {
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
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

export async function getIdentity(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.atlassian.com',
      path: '/oauth/token/accessible-resources',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && Array.isArray(parsed)) {
          resolve({ sites: parsed.map(s => ({ url: s.url, name: s.name, id: s.id })) })
        } else {
          reject(new Error(`Failed to get Atlassian accessible resources (${res.statusCode})`))
        }
      })
    })
    req.on('error', reject)
  })
}

export function validateDomain(identity, config) {
  if (!config.allowed_domain) return false
  return identity.sites?.some(s => s.url.includes(config.allowed_domain)) ?? false
}

// Store the matched site's URL in the token so createDocument knows the base URL.
export function enrichToken(tokenData, identity, config) {
  const site = identity.sites?.find(s => s.url.includes(config.allowed_domain))
  return { ...tokenData, base_url: site?.url ?? null }
}

export async function getMetadata({ id, baseUrl }, accessToken) {
  const host = new URL(baseUrl).hostname
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: host,
      path: `/wiki/api/v2/pages/${id}?fields=title,version`,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed) {
          resolve({ title: parsed.title ?? null, last_edited: parsed.version?.createdAt ?? null })
        } else {
          const msg = parsed?.message || `Confluence API error ${res.statusCode}`
          const err = new Error(msg)
          err.status = res.statusCode
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

export async function refreshTokenIfNeeded(tokenData, appConfig) {
  if (tokenData.expiry && tokenData.expiry - Date.now() > 5 * 60 * 1000) return tokenData

  const body = JSON.stringify({
    grant_type: 'refresh_token',
    refresh_token: tokenData.refresh_token,
    client_id: appConfig.client_id,
    client_secret: appConfig.client_secret,
  })

  const newTokenData = await new Promise((resolve, reject) => {
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
  setProviderToken('confluence', updated)
  return updated
}

// destination format: "SPACE_KEY" or "SPACE_KEY:parent_page_id"
export async function createDocument(title, content, destination, tokenData) {
  const [spaceKey, ancestorId] = destination.split(':')
  const host = new URL(tokenData.base_url).hostname

  const pageBody = {
    type: 'page',
    title,
    space: { key: spaceKey },
    body: { storage: { value: content || '', representation: 'storage' } },
    ...(ancestorId ? { ancestors: [{ id: ancestorId }] } : {}),
  }
  const bodyStr = JSON.stringify(pageBody)

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path: '/wiki/rest/api/content',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if ((res.statusCode === 200 || res.statusCode === 201) && parsed?._links?.webui) {
          resolve({ url: `${tokenData.base_url}${parsed._links.webui}` })
        } else {
          const msg = parsed?.message || `Confluence API error ${res.statusCode}`
          reject(new Error(msg))
        }
      })
    })
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}
```

- [ ] **Step 2: Write unit tests**

```js
// tests/unit/confluence-provider.test.js
import { describe, it, expect } from 'vitest'
import { extractId, validateDomain, enrichToken } from '../../src/lib/providers/confluence.js'

describe('extractId', () => {
  it('extracts page ID from standard /pages/ URL', () => {
    const result = extractId('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/My-Page')
    expect(result).toEqual({ id: '12345', baseUrl: 'https://acme.atlassian.net' })
  })

  it('extracts page ID from ?pageId= query param', () => {
    const result = extractId('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=67890')
    expect(result).toEqual({ id: '67890', baseUrl: 'https://acme.atlassian.net' })
  })

  it('returns null for URL without a numeric page ID', () => {
    expect(extractId('https://acme.atlassian.net/wiki/spaces/ENG/overview')).toBeNull()
  })

  it('returns null for non-Confluence URL', () => {
    expect(extractId('https://notion.so/My-Page-abc123')).toBeNull()
  })
})

describe('validateDomain', () => {
  it('returns true when a site URL includes allowed_domain', () => {
    const identity = { sites: [{ url: 'https://acme.atlassian.net', name: 'Acme', id: 's1' }] }
    expect(validateDomain(identity, { allowed_domain: 'acme.atlassian.net' })).toBe(true)
  })

  it('returns false when no site matches', () => {
    const identity = { sites: [{ url: 'https://other.atlassian.net', name: 'Other', id: 's2' }] }
    expect(validateDomain(identity, { allowed_domain: 'acme.atlassian.net' })).toBe(false)
  })

  it('returns false when allowed_domain is not configured', () => {
    const identity = { sites: [{ url: 'https://acme.atlassian.net', name: 'Acme', id: 's1' }] }
    expect(validateDomain(identity, {})).toBe(false)
  })
})

describe('enrichToken', () => {
  it('adds base_url of the matching site to token data', () => {
    const identity = { sites: [{ url: 'https://acme.atlassian.net', name: 'Acme', id: 's1' }] }
    const tokenData = { access_token: 'tok', refresh_token: 'rtok', expiry: 9999 }
    const result = enrichToken(tokenData, identity, { allowed_domain: 'acme.atlassian.net' })
    expect(result).toEqual({ ...tokenData, base_url: 'https://acme.atlassian.net' })
  })

  it('sets base_url to null when no site matches', () => {
    const identity = { sites: [] }
    const tokenData = { access_token: 'tok', refresh_token: 'rtok', expiry: 9999 }
    const result = enrichToken(tokenData, identity, { allowed_domain: 'acme.atlassian.net' })
    expect(result.base_url).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/unit/confluence-provider.test.js
```

Expected: all pass.

- [ ] **Step 4: Add Confluence to registry**

Add to `src/lib/providers/registry.js`:

```js
// At the top, add:
import {
  extractId as confluenceExtractId,
  exchangeCode as confluenceExchangeCode,
  getIdentity as confluenceGetIdentity,
  getMetadata as confluenceGetMetadata,
  validateDomain as confluenceValidateDomain,
  enrichToken as confluenceEnrichToken,
  refreshTokenIfNeeded as confluenceRefreshTokenIfNeeded,
  createDocument as confluenceCreateDocument,
} from './confluence.js'

// In PROVIDERS, add:
  'confluence': {
    configKey: 'confluence',
    urlPattern: /\.atlassian\.net\/wiki\//,
    supportsRefresh: true,
    domainField: 'allowed_domain',
    authUrl: 'https://auth.atlassian.com/authorize',
    scopes: ['read:confluence-content.all', 'write:confluence-content', 'offline_access'],
    authParams: { audience: 'api.atlassian.com', prompt: 'consent' },
    enrichToken: confluenceEnrichToken,
    extractId: confluenceExtractId,
    exchangeCode: confluenceExchangeCode,
    getIdentity: confluenceGetIdentity,
    getMetadata: confluenceGetMetadata,
    validateDomain: confluenceValidateDomain,
    refreshTokenIfNeeded: confluenceRefreshTokenIfNeeded,
    createDocument: confluenceCreateDocument,
  },
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/providers/confluence.js src/lib/providers/registry.js tests/unit/confluence-provider.test.js
git commit -m "feat: add Confluence provider"
```

---

## Task 7: Refactor validate-link.js to use registry

**Files:**
- Modify: `src/lib/mcp/tools/validate-link.js`
- Modify: `tests/unit/validate-link.test.js`

- [ ] **Step 1: Rewrite validate-link.js**

```js
// src/lib/mcp/tools/validate-link.js
import { PROVIDERS } from '../../providers/registry.js'
import { getProviderToken } from '../../tokens.js'
import { readConfig } from '../../config.js'
import { join } from 'path'

export async function validateLink(url) {
  const entry = Object.entries(PROVIDERS).find(([, def]) => def.urlPattern.test(url))
  if (!entry) return { valid: true, provider: 'unknown', title: null, last_edited: null, error: null }

  const [providerId, def] = entry
  const tokenData = getProviderToken(providerId)
  if (!tokenData) return { valid: true, provider: providerId, title: null, last_edited: null, error: 'not authenticated' }

  try {
    const config = readConfig(join(process.cwd(), 'upstream.config.yaml'))
    const appConfig = config.integrations?.[def.configKey] ?? {}

    const freshToken = def.supportsRefresh && def.refreshTokenIfNeeded
      ? await def.refreshTokenIfNeeded(tokenData, appConfig)
      : tokenData

    const idResult = def.extractId(url)
    if (!idResult) return { valid: false, provider: providerId, title: null, last_edited: null, error: 'Invalid URL format' }

    const metadata = await def.getMetadata(idResult, freshToken.access_token)
    return { valid: true, provider: providerId, title: metadata.title, last_edited: metadata.last_edited, error: null }
  } catch (err) {
    return { valid: false, provider: providerId, title: null, last_edited: null, error: err.message }
  }
}
```

- [ ] **Step 2: Rewrite validate-link.test.js**

```js
// tests/unit/validate-link.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/tokens.js', () => ({
  getProviderToken: vi.fn(),
}))

vi.mock('../../src/lib/config.js', () => ({
  readConfig: vi.fn(() => ({
    integrations: {
      google_docs: { client_id: 'cid', client_secret: 'csec', allowed_domain: 'acme.com' },
      notion: { client_id: 'ncid', client_secret: 'ncsec', allowed_workspace: 'acme' },
      confluence: { client_id: 'ccid', client_secret: 'ccsec', allowed_domain: 'acme.atlassian.net' },
    },
  })),
}))

vi.mock('../../src/lib/providers/google-docs.js', () => ({
  extractId: vi.fn(),
  getMetadata: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
  exchangeCode: vi.fn(),
  getIdentity: vi.fn(),
  validateDomain: vi.fn(),
  createDocument: vi.fn(),
}))

vi.mock('../../src/lib/providers/notion.js', () => ({
  extractId: vi.fn(),
  getMetadata: vi.fn(),
  exchangeCode: vi.fn(),
  getIdentity: vi.fn(),
  validateDomain: vi.fn(),
  createDocument: vi.fn(),
}))

vi.mock('../../src/lib/providers/confluence.js', () => ({
  extractId: vi.fn(),
  getMetadata: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
  exchangeCode: vi.fn(),
  getIdentity: vi.fn(),
  validateDomain: vi.fn(),
  enrichToken: vi.fn(),
  createDocument: vi.fn(),
}))

import { getProviderToken } from '../../src/lib/tokens.js'
import { extractId as googleExtractId, getMetadata as googleGetMetadata, refreshTokenIfNeeded as googleRefresh } from '../../src/lib/providers/google-docs.js'
import { extractId as notionExtractId, getMetadata as notionGetMetadata } from '../../src/lib/providers/notion.js'
import { extractId as confluenceExtractId, getMetadata as confluenceGetMetadata, refreshTokenIfNeeded as confluenceRefresh } from '../../src/lib/providers/confluence.js'
import { validateLink } from '../../src/lib/mcp/tools/validate-link.js'

beforeEach(() => vi.clearAllMocks())

describe('validateLink — unknown URL', () => {
  it('returns unknown provider for unrecognized URL', async () => {
    const result = await validateLink('https://example.com/doc')
    expect(result).toEqual({ valid: true, title: null, provider: 'unknown', last_edited: null, error: null })
  })
})

describe('validateLink — Google Docs', () => {
  it('returns not-authenticated when no token', async () => {
    getProviderToken.mockReturnValue(null)
    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result.provider).toBe('google-docs')
    expect(result.error).toBe('not authenticated')
    expect(result.valid).toBe(true)
  })

  it('returns title and last_edited when authenticated', async () => {
    const token = { access_token: 'tok', refresh_token: 'rtok', expiry: 9999999999999 }
    getProviderToken.mockReturnValue(token)
    googleRefresh.mockResolvedValue(token)
    googleExtractId.mockReturnValue('doc123')
    googleGetMetadata.mockResolvedValue({ title: 'My PRD', last_edited: '2026-06-11T10:00:00.000Z' })

    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result).toEqual({ valid: true, title: 'My PRD', provider: 'google-docs', last_edited: '2026-06-11T10:00:00.000Z', error: null })
  })

  it('returns valid=false on Drive API error', async () => {
    const token = { access_token: 'tok', refresh_token: 'rtok', expiry: 9999999999999 }
    getProviderToken.mockReturnValue(token)
    googleRefresh.mockResolvedValue(token)
    googleExtractId.mockReturnValue('doc123')
    googleGetMetadata.mockRejectedValue(new Error('File not found'))

    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('File not found')
  })
})

describe('validateLink — Notion', () => {
  it('returns not-authenticated when no token', async () => {
    getProviderToken.mockReturnValue(null)
    const result = await validateLink('https://www.notion.so/My-Page-abc123def456abc123def456abc12345')
    expect(result.provider).toBe('notion')
    expect(result.error).toBe('not authenticated')
    expect(result.valid).toBe(true)
  })

  it('returns title and last_edited when authenticated', async () => {
    const token = { access_token: 'ntok', refresh_token: null, expiry: null }
    getProviderToken.mockReturnValue(token)
    notionExtractId.mockReturnValue('abc123def456abc123def456abc12345')
    notionGetMetadata.mockResolvedValue({ title: 'PRD Auth', last_edited: '2026-06-10T08:00:00.000Z' })

    const result = await validateLink('https://www.notion.so/My-Page-abc123def456abc123def456abc12345')
    expect(result).toEqual({ valid: true, title: 'PRD Auth', provider: 'notion', last_edited: '2026-06-10T08:00:00.000Z', error: null })
  })
})

describe('validateLink — Confluence', () => {
  it('returns not-authenticated when no token', async () => {
    getProviderToken.mockReturnValue(null)
    const result = await validateLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Title')
    expect(result.provider).toBe('confluence')
    expect(result.error).toBe('not authenticated')
    expect(result.valid).toBe(true)
  })

  it('returns title and last_edited when authenticated', async () => {
    const token = { access_token: 'ctok', refresh_token: 'crtok', expiry: 9999999999999, base_url: 'https://acme.atlassian.net' }
    getProviderToken.mockReturnValue(token)
    confluenceRefresh.mockResolvedValue(token)
    confluenceExtractId.mockReturnValue({ id: '12345', baseUrl: 'https://acme.atlassian.net' })
    confluenceGetMetadata.mockResolvedValue({ title: 'ADR-0042', last_edited: '2026-06-09T14:00:00.000Z' })

    const result = await validateLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/ADR-0042')
    expect(result).toEqual({ valid: true, title: 'ADR-0042', provider: 'confluence', last_edited: '2026-06-09T14:00:00.000Z', error: null })
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/unit/validate-link.test.js
```

Expected: all pass.

- [ ] **Step 4: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/validate-link.js tests/unit/validate-link.test.js
git commit -m "refactor: validate-link uses provider registry"
```

---

## Task 8: Add create_document MCP tool

**Files:**
- Create: `src/lib/mcp/tools/create-document.js`
- Modify: `src/lib/mcp/server.js`

- [ ] **Step 1: Write the tool**

```js
// src/lib/mcp/tools/create-document.js
import { PROVIDERS } from '../../providers/registry.js'
import { getProviderToken } from '../../tokens.js'
import { readConfig } from '../../config.js'
import { join } from 'path'

export async function createDocument({ provider, title, content, destination }) {
  const def = PROVIDERS[provider]
  if (!def) throw new Error(`Unknown provider: ${provider}. Known: ${Object.keys(PROVIDERS).join(', ')}`)

  const tokenData = getProviderToken(provider)
  if (!tokenData) throw new Error(`Not authenticated with ${provider}. Run: upstream auth ${provider}`)

  try {
    const config = readConfig(join(process.cwd(), 'upstream.config.yaml'))
    const appConfig = config.integrations?.[def.configKey] ?? {}

    const freshToken = def.supportsRefresh && def.refreshTokenIfNeeded
      ? await def.refreshTokenIfNeeded(tokenData, appConfig)
      : tokenData

    return await def.createDocument(title, content, destination, freshToken)
  } catch (err) {
    throw new Error(`create_document failed (${provider}): ${err.message}`)
  }
}
```

- [ ] **Step 2: Register the tool in server.js**

```js
// src/lib/mcp/server.js
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { validateLink } from './tools/validate-link.js'
import { createDocument } from './tools/create-document.js'

const TOOLS = [
  {
    name: 'validate_link',
    description: 'Validate a document URL and retrieve its title and metadata. Returns provider, title, last_edited date, and any error.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The document URL to validate' },
      },
      required: ['url'],
    },
  },
  {
    name: 'create_document',
    description: 'Create a new document in the connected provider (notion, confluence, google-docs) and return its URL.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider name: notion, confluence, or google-docs' },
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Initial document content (HTML for Google Docs/Confluence, plain text for Notion)' },
        destination: {
          type: 'string',
          description: 'Parent location. Notion: parent page ID. Confluence: "SPACE_KEY" or "SPACE_KEY:parent_page_id". Google Docs: parent folder ID (optional).',
        },
      },
      required: ['provider', 'title', 'destination'],
    },
  },
]

export async function startMcpServer() {
  const server = new Server(
    { name: 'upstream', version: '0.2.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    if (name === 'validate_link') {
      if (typeof args?.url !== 'string') throw new Error('validate_link requires a string url argument')
      const result = await validateLink(args.url)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }

    if (name === 'create_document') {
      if (typeof args?.provider !== 'string') throw new Error('create_document requires a string provider argument')
      if (typeof args?.title !== 'string') throw new Error('create_document requires a string title argument')
      if (typeof args?.destination !== 'string') throw new Error('create_document requires a string destination argument')
      const result = await createDocument({
        provider: args.provider,
        title: args.title,
        content: args.content ?? '',
        destination: args.destination,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }

    throw new Error(`Unknown tool: ${name}`)
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mcp/tools/create-document.js src/lib/mcp/server.js
git commit -m "feat: add create_document MCP tool"
```

---

## Task 9: Expand integration tests

**Files:**
- Modify: `tests/integration/auth.test.js`

- [ ] **Step 1: Add Notion and Confluence missing-config tests**

Add to `tests/integration/auth.test.js`, inside the `describe('upstream auth')` block:

```js
  it('shows error when notion credentials missing from config', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')

    let output = ''
    try {
      execSync(`node ${CLI} auth notion`, { cwd: TMP, stdio: 'pipe' })
    } catch (err) {
      output = err.stderr?.toString() || err.stdout?.toString() || ''
    }
    rmSync(TMP, { recursive: true, force: true })

    expect(output).toMatch(/client_id|credentials|configure/i)
  })

  it('shows error when confluence credentials missing from config', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')

    let output = ''
    try {
      execSync(`node ${CLI} auth confluence`, { cwd: TMP, stdio: 'pipe' })
    } catch (err) {
      output = err.stderr?.toString() || err.stdout?.toString() || ''
    }
    rmSync(TMP, { recursive: true, force: true })

    expect(output).toMatch(/client_id|credentials|configure/i)
  })

  it('shows error for unknown provider', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')

    let output = ''
    try {
      execSync(`node ${CLI} auth foobar`, { cwd: TMP, stdio: 'pipe' })
    } catch (err) {
      output = err.stderr?.toString() || err.stdout?.toString() || ''
    }
    rmSync(TMP, { recursive: true, force: true })

    expect(output).toMatch(/unknown provider/i)
  })

  it('auth status shows notion and confluence', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')
    process.env.UPSTREAM_TOKENS_PATH = join(TMP, 'tokens.json')

    const output = execSync(`node ${CLI} auth status`, { cwd: TMP }).toString()
    rmSync(TMP, { recursive: true, force: true })
    delete process.env.UPSTREAM_TOKENS_PATH

    expect(output).toContain('notion')
    expect(output).toContain('confluence')
  })
```

- [ ] **Step 2: Run integration tests**

```bash
npm test -- tests/integration/auth.test.js
```

Expected: all pass.

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/auth.test.js
git commit -m "test: add Notion and Confluence auth integration tests"
```

---

## Done

All three providers (Google Docs, Notion, Confluence) are now fully wired through the registry. Adding a fourth provider requires only:
1. Create `src/lib/providers/<name>.js` with the standard interface
2. Add an entry in `src/lib/providers/registry.js`
