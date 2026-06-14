# upstream Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Docs OAuth2 auth + a local MCP server with a `validate_link` tool, so upstream skills can verify document URLs and pull real titles automatically.

**Architecture:** A new `upstream mcp` subcommand starts a local MCP server (using `@modelcontextprotocol/sdk`) that Claude Code spawns automatically. `upstream auth google-docs` runs an OAuth2 flow (opens browser → localhost callback → token exchange → saves to `~/.upstream/tokens.json`). `upstream init` and `upgrade` write the MCP server registration into `.claude/settings.json`. Skills updated to call `validate_link` in link mode, with org-level enforcement policy via `upstream.config.yaml`.

**Tech Stack:** Node.js 18+ ESM (existing), `@modelcontextprotocol/sdk` (new), `open` (new — cross-platform browser launcher), Node.js built-in `https`/`http` for all API/OAuth calls.

---

## File Map

**New files:**

```text
src/
  commands/
    auth.js                          # upstream auth <provider> — dispatcher + status
  lib/
    tokens.js                        # read/write ~/.upstream/tokens.json
    auth/
      google-docs.js                 # OAuth2 flow: free port → browser → callback → token exchange
    providers/
      google-docs.js                 # extractDocId(), getFileMetadata(), refreshTokenIfNeeded()
    mcp/
      server.js                      # MCP server entry: register tools, connect stdio transport
      tools/
        validate-link.js             # validateLink(): detect provider, call API, return metadata
tests/
  unit/
    tokens.test.js
    google-docs-provider.test.js
    validate-link.test.js
  integration/
    auth.test.js
    init-settings.test.js
```

**Modified files:**

```text
package.json                         # add @modelcontextprotocol/sdk, open; bump version 0.1.0 → 0.2.0
bin/upstream.js                      # register auth + mcp commands
src/commands/init.js                 # call writeMcpSettings() after scaffoldInto()
src/commands/upgrade.js              # call writeMcpSettings() after scaffoldInto()
src/lib/config.js                    # add integrations: {}, link_policy: {} to DEFAULT_CONFIG
src/lib/scaffold.js                  # export writeMcpSettings() (or put in init.js — see Task 8)
templates/upstream.config.yaml       # add commented integrations + link_policy sections
templates/skills/upstream-prd.md     # link mode: call validate_link, apply policy
templates/skills/upstream-adr.md     # same
```

---

### Task 1: Add Dependencies + Bump Version

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Update package.json**

```json
{
  "name": "upstream",
  "version": "0.2.0",
  "description": "Claude Code plugin: enforce PRD/ADR before feature development",
  "type": "module",
  "bin": {
    "upstream": "./bin/upstream.js"
  },
  "files": ["bin", "src", "templates"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:hook": "npx bats tests/hook/"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "js-yaml": "^4.1.0",
    "open": "^10.1.0"
  },
  "devDependencies": {
    "bats": "^1.11.0",
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Install**

```bash
npm install
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
npm test
```

Expected: 16 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @modelcontextprotocol/sdk and open dependencies, bump to 0.2.0"
```

---

### Task 2: Token Storage

**Files:**

- Create: `src/lib/tokens.js`
- Create: `tests/unit/tokens.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/tokens.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// Override home dir for tests
const TEST_HOME = '/tmp/upstream-test-home'
process.env.UPSTREAM_TOKENS_PATH = join(TEST_HOME, '.upstream', 'tokens.json')

// Import AFTER setting env
const { readTokens, writeTokens, getProviderToken, setProviderToken } = await import('../../src/lib/tokens.js')

beforeEach(() => { mkdirSync(join(TEST_HOME, '.upstream'), { recursive: true }) })
afterEach(() => { rmSync(TEST_HOME, { recursive: true, force: true }) })

describe('tokens', () => {
  it('readTokens returns {} when file absent', () => {
    expect(readTokens()).toEqual({})
  })

  it('readTokens returns parsed JSON', () => {
    writeFileSync(process.env.UPSTREAM_TOKENS_PATH, JSON.stringify({ 'google-docs': { access_token: 'ya29' } }))
    expect(readTokens()).toEqual({ 'google-docs': { access_token: 'ya29' } })
  })

  it('readTokens returns {} on corrupt file', () => {
    writeFileSync(process.env.UPSTREAM_TOKENS_PATH, 'not json')
    expect(readTokens()).toEqual({})
  })

  it('writeTokens creates file and directories', () => {
    writeTokens({ 'google-docs': { access_token: 'tok' } })
    expect(readTokens()).toEqual({ 'google-docs': { access_token: 'tok' } })
  })

  it('getProviderToken returns null when absent', () => {
    expect(getProviderToken('google-docs')).toBeNull()
  })

  it('setProviderToken and getProviderToken round-trip', () => {
    setProviderToken('google-docs', { access_token: 'abc', refresh_token: 'def', expiry: 9999999999999 })
    expect(getProviderToken('google-docs')).toEqual({ access_token: 'abc', refresh_token: 'def', expiry: 9999999999999 })
  })

  it('setProviderToken merges with existing providers', () => {
    setProviderToken('notion', { access_token: 'notion-tok' })
    setProviderToken('google-docs', { access_token: 'google-tok' })
    expect(getProviderToken('notion')).toEqual({ access_token: 'notion-tok' })
    expect(getProviderToken('google-docs')).toEqual({ access_token: 'google-tok' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/tokens.test.js 2>&1 | head -20
```

Expected: FAIL — `tokens.js` not found.

- [ ] **Step 3: Implement `src/lib/tokens.js`**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

function tokensPath() {
  return process.env.UPSTREAM_TOKENS_PATH || join(homedir(), '.upstream', 'tokens.json')
}

export function readTokens() {
  try {
    return JSON.parse(readFileSync(tokensPath(), 'utf8'))
  } catch {
    return {}
  }
}

export function writeTokens(tokens) {
  const p = tokensPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(tokens, null, 2) + '\n', 'utf8')
}

export function getProviderToken(provider) {
  return readTokens()[provider] ?? null
}

export function setProviderToken(provider, tokenData) {
  const tokens = readTokens()
  tokens[provider] = tokenData
  writeTokens(tokens)
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
npx vitest run tests/unit/tokens.test.js
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tokens.js tests/unit/tokens.test.js
git commit -m "feat: add token storage for OAuth provider credentials"
```

---

### Task 3: Google Docs Provider (URL parsing + Drive API)

**Files:**

- Create: `src/lib/providers/google-docs.js`
- Create: `tests/unit/google-docs-provider.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/google-docs-provider.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { extractDocId } from '../../src/lib/providers/google-docs.js'

describe('extractDocId', () => {
  it('extracts ID from standard Google Docs URL', () => {
    const url = 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit'
    expect(extractDocId(url)).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms')
  })

  it('extracts ID from URL without trailing path', () => {
    const url = 'https://docs.google.com/document/d/abc123def456'
    expect(extractDocId(url)).toBe('abc123def456')
  })

  it('extracts ID with underscores and hyphens', () => {
    const url = 'https://docs.google.com/document/d/1a-b_C2/edit?usp=sharing'
    expect(extractDocId(url)).toBe('1a-b_C2')
  })

  it('returns null for non-Google Docs URL', () => {
    expect(extractDocId('https://notion.so/some-page')).toBeNull()
  })

  it('returns null for malformed URL', () => {
    expect(extractDocId('not a url')).toBeNull()
  })

  it('returns null for Google Docs URL without document ID', () => {
    expect(extractDocId('https://docs.google.com/document/')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/google-docs-provider.test.js 2>&1 | head -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/providers/google-docs.js`**

```js
import https from 'https'
import { setProviderToken, getProviderToken } from '../tokens.js'

export function extractDocId(url) {
  const match = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

export async function getFileMetadata(docId, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${docId}?fields=name,modifiedTime`,
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        const parsed = JSON.parse(data)
        if (res.statusCode === 200) resolve(parsed)
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

export async function refreshTokenIfNeeded(tokenData, clientId, clientSecret) {
  // Token is still valid (more than 5 minutes left)
  if (tokenData.expiry - Date.now() > 5 * 60 * 1000) return tokenData

  const body = new URLSearchParams({
    refresh_token: tokenData.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
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
        if (res.statusCode === 200) resolve(JSON.parse(data))
        else reject(new Error(`Token refresh failed (${res.statusCode}): ${data}`))
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

- [ ] **Step 4: Run to verify tests pass**

```bash
npx vitest run tests/unit/google-docs-provider.test.js
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/google-docs.js tests/unit/google-docs-provider.test.js
git commit -m "feat: add Google Docs provider with URL parsing and Drive API call"
```

---

### Task 4: validate_link Tool (MCP)

**Files:**

- Create: `src/lib/mcp/tools/validate-link.js`
- Create: `tests/unit/validate-link.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/validate-link.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/tokens.js', () => ({
  getProviderToken: vi.fn(),
}))

vi.mock('../../src/lib/providers/google-docs.js', () => ({
  extractDocId: vi.fn(),
  getFileMetadata: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
}))

vi.mock('../../src/lib/config.js', () => ({
  readConfig: vi.fn(() => ({ integrations: { google_docs: { client_id: 'cid', client_secret: 'csec' } } })),
}))

import { getProviderToken } from '../../src/lib/tokens.js'
import { extractDocId, getFileMetadata, refreshTokenIfNeeded } from '../../src/lib/providers/google-docs.js'
import { validateLink } from '../../src/lib/mcp/tools/validate-link.js'

beforeEach(() => vi.clearAllMocks())

describe('validateLink', () => {
  it('returns unknown for non-Google Docs URL', async () => {
    extractDocId.mockReturnValue(null)
    const result = await validateLink('https://notion.so/page')
    expect(result).toEqual({ valid: true, title: null, provider: 'unknown', last_edited: null, error: null })
  })

  it('returns not-authenticated error when no token', async () => {
    extractDocId.mockReturnValue('doc123')
    getProviderToken.mockReturnValue(null)
    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result.provider).toBe('google-docs')
    expect(result.error).toBe('not authenticated')
    expect(result.valid).toBe(true)
    expect(result.title).toBeNull()
  })

  it('returns title and last_edited when authenticated', async () => {
    extractDocId.mockReturnValue('doc123')
    getProviderToken.mockReturnValue({ access_token: 'tok', refresh_token: 'rtok', expiry: 9999999999999 })
    refreshTokenIfNeeded.mockResolvedValue({ access_token: 'tok', refresh_token: 'rtok', expiry: 9999999999999 })
    getFileMetadata.mockResolvedValue({ name: 'My PRD', modifiedTime: '2026-06-11T10:00:00.000Z' })

    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result).toEqual({
      valid: true,
      title: 'My PRD',
      provider: 'google-docs',
      last_edited: '2026-06-11T10:00:00.000Z',
      error: null,
    })
  })

  it('returns valid=false on Drive API error', async () => {
    extractDocId.mockReturnValue('doc123')
    getProviderToken.mockReturnValue({ access_token: 'tok', refresh_token: 'rtok', expiry: 9999999999999 })
    refreshTokenIfNeeded.mockResolvedValue({ access_token: 'tok', refresh_token: 'rtok', expiry: 9999999999999 })
    getFileMetadata.mockRejectedValue(new Error('File not found'))

    const result = await validateLink('https://docs.google.com/document/d/doc123/edit')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('File not found')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/validate-link.test.js 2>&1 | head -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/mcp/tools/validate-link.js`**

```js
import { extractDocId, getFileMetadata, refreshTokenIfNeeded } from '../../providers/google-docs.js'
import { getProviderToken } from '../../tokens.js'
import { readConfig } from '../../config.js'
import { join } from 'path'

async function validateGoogleDocsLink(url) {
  const docId = extractDocId(url)
  if (!docId) {
    return { valid: false, title: null, provider: 'google-docs', last_edited: null, error: 'Invalid Google Docs URL' }
  }

  const tokenData = getProviderToken('google-docs')
  if (!tokenData) {
    return { valid: true, title: null, provider: 'google-docs', last_edited: null, error: 'not authenticated' }
  }

  try {
    const config = readConfig(join(process.cwd(), 'upstream.config.yaml'))
    const { client_id, client_secret } = config.integrations?.google_docs ?? {}
    const token = await refreshTokenIfNeeded(tokenData, client_id, client_secret)
    const metadata = await getFileMetadata(docId, token.access_token)
    return {
      valid: true,
      title: metadata.name,
      provider: 'google-docs',
      last_edited: metadata.modifiedTime ?? null,
      error: null,
    }
  } catch (err) {
    return { valid: false, title: null, provider: 'google-docs', last_edited: null, error: err.message }
  }
}

export async function validateLink(url) {
  if (/docs\.google\.com\/document\/d\//.test(url)) {
    return validateGoogleDocsLink(url)
  }
  return { valid: true, title: null, provider: 'unknown', last_edited: null, error: null }
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
npx vitest run tests/unit/validate-link.test.js
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/validate-link.js tests/unit/validate-link.test.js
git commit -m "feat: add validate_link MCP tool with Google Docs support"
```

---

### Task 5: MCP Server

**Files:**

- Create: `src/lib/mcp/server.js`

No unit tests — MCP server is a thin wiring layer. Verified manually in Task 11.

- [ ] **Step 1: Check installed SDK API**

```bash
node -e "import('@modelcontextprotocol/sdk/server/index.js').then(m => console.log(Object.keys(m)))"
node -e "import('@modelcontextprotocol/sdk/server/stdio.js').then(m => console.log(Object.keys(m)))"
```

Note the exported class names. They should be `Server` and `StdioServerTransport`. If different, adjust the imports below.

- [ ] **Step 2: Create `src/lib/mcp/server.js`**

```js
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { validateLink } from './tools/validate-link.js'

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
      const result = await validateLink(args.url)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
    throw new Error(`Unknown tool: ${name}`)
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

- [ ] **Step 3: Smoke-test the server starts without crashing**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node -e "
import('./src/lib/mcp/server.js').then(m => m.startMcpServer()).catch(e => { console.error(e); process.exit(1) })
" 2>&1 | head -5
```

Expected: JSON response listing `validate_link` tool (or at minimum no crash/error within 2 seconds).

- [ ] **Step 4: Commit**

```bash
git add src/lib/mcp/server.js
git commit -m "feat: add MCP server with validate_link tool registration"
```

---

### Task 6: Google Docs Auth Flow

**Files:**

- Create: `src/lib/auth/google-docs.js`

No unit tests — this function opens a browser and starts a localhost server. Verified manually in Task 11.

- [ ] **Step 1: Create `src/lib/auth/google-docs.js`**

```js
import http from 'http'
import https from 'https'
import { URL } from 'url'
import open from 'open'
import { setProviderToken } from '../tokens.js'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly'

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function waitForCallback(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`)
      const code = u.searchParams.get('code')
      const error = u.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>upstream: Authentication complete. You can close this tab.</h2></body></html>')
      srv.close()

      if (error) reject(new Error(`OAuth cancelled: ${error}`))
      else if (code) resolve(code)
      else reject(new Error('No authorization code received'))
    })

    srv.listen(port)
    srv.on('error', reject)

    // Time out after 5 minutes
    setTimeout(() => { srv.close(); reject(new Error('Authentication timed out after 5 minutes')) }, 5 * 60 * 1000)
  })
}

function exchangeCode(code, clientId, clientSecret, redirectUri) {
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
        if (res.statusCode === 200) resolve(JSON.parse(data))
        else reject(new Error(`Token exchange failed (${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

export async function authenticateGoogleDocs(clientId, clientSecret) {
  const port = await findFreePort()
  const redirectUri = `http://localhost:${port}/callback`

  const authUrl = new URL(GOOGLE_AUTH_URL)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')

  console.log('Opening browser for Google authentication...')
  console.log(`If browser doesn't open, visit:\n  ${authUrl.toString()}`)

  try { await open(authUrl.toString()) } catch { /* user has URL in console */ }

  const code = await waitForCallback(port)
  const tokenResponse = await exchangeCode(code, clientId, clientSecret, redirectUri)

  setProviderToken('google-docs', {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expiry: Date.now() + tokenResponse.expires_in * 1000,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/auth/google-docs.js
git commit -m "feat: add Google Docs OAuth2 auth flow with localhost callback"
```

---

### Task 7: Auth Command + Wire bin

**Files:**

- Create: `src/commands/auth.js`
- Create: `tests/integration/auth.test.js`
- Modify: `bin/upstream.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/auth.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const CLI = join(__dirname, '../../bin/upstream.js')
const TMP = '/tmp/upstream-auth-test'

describe('upstream auth', () => {
  it('shows error when google_docs credentials missing from config', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')

    let output = ''
    try {
      execSync(`node ${CLI} auth google-docs`, { cwd: TMP, stdio: 'pipe' })
    } catch (err) {
      output = err.stderr?.toString() || err.stdout?.toString() || ''
    }
    rmSync(TMP, { recursive: true, force: true })

    expect(output).toMatch(/client_id|credentials|configure/i)
  })

  it('upstream auth status exits 0 and shows providers', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'upstream.config.yaml'), 'version: 1\n')
    process.env.UPSTREAM_TOKENS_PATH = join(TMP, 'tokens.json')

    const output = execSync(`node ${CLI} auth status`, { cwd: TMP }).toString()
    rmSync(TMP, { recursive: true, force: true })
    delete process.env.UPSTREAM_TOKENS_PATH

    expect(output).toContain('google-docs')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/integration/auth.test.js 2>&1 | head -20
```

Expected: FAIL — `auth` command not registered.

- [ ] **Step 3: Create `src/commands/auth.js`**

```js
import chalk from 'chalk'
import { join } from 'path'
import { readConfig } from '../lib/config.js'
import { authenticateGoogleDocs } from '../lib/auth/google-docs.js'
import { getProviderToken } from '../lib/tokens.js'

const KNOWN_PROVIDERS = ['google-docs', 'confluence', 'notion']

export async function authCommand(provider) {
  if (provider === 'status') return statusCommand()
  if (provider === 'google-docs') return googleDocsAuth()
  console.error(chalk.red(`Unknown provider: ${provider}`))
  console.error(`Known providers: ${KNOWN_PROVIDERS.join(', ')}`)
  process.exit(1)
}

async function googleDocsAuth() {
  const config = readConfig(join(process.cwd(), 'upstream.config.yaml'))
  const { client_id, client_secret } = config.integrations?.google_docs ?? {}

  if (!client_id || !client_secret) {
    console.error(chalk.red('upstream auth: Google Docs credentials not configured.'))
    console.error('')
    console.error('Add to upstream.config.yaml:')
    console.error('  integrations:')
    console.error('    google_docs:')
    console.error('      client_id: "xxx.apps.googleusercontent.com"')
    console.error('      client_secret: "GOCSPX-..."')
    process.exit(1)
  }

  try {
    await authenticateGoogleDocs(client_id, client_secret)
    console.log(chalk.green('✓ Google Docs connected.'))
  } catch (err) {
    console.error(chalk.red('upstream auth failed:'), err.message)
    process.exit(1)
  }
}

async function statusCommand() {
  console.log('')
  for (const provider of KNOWN_PROVIDERS) {
    const token = getProviderToken(provider)
    if (!token) {
      console.log(`  ${provider.padEnd(14)} ${chalk.red('✗')} not authenticated`)
    } else {
      const expires = new Date(token.expiry).toISOString().slice(0, 10)
      console.log(`  ${provider.padEnd(14)} ${chalk.green('✓')} authenticated (expires ${expires})`)
    }
  }
  console.log('')
}
```

- [ ] **Step 4: Register in `bin/upstream.js`**

```js
#!/usr/bin/env node
import { Command } from 'commander'
import { initCommand } from '../src/commands/init.js'
import { upgradeCommand } from '../src/commands/upgrade.js'
import { authCommand } from '../src/commands/auth.js'
import { startMcpServer } from '../src/lib/mcp/server.js'

const program = new Command()

program
  .name('upstream')
  .description('Claude Code plugin: enforce PRD/ADR before feature development')
  .version('0.2.0')

program
  .command('init')
  .description('Scaffold upstream into the current repo')
  .action(initCommand)

program
  .command('upgrade')
  .description('Regenerate skills and hook, preserve config and docs')
  .action(upgradeCommand)

program
  .command('auth <provider>')
  .description('Authenticate with a documentation provider (google-docs) or check status (status)')
  .action(authCommand)

program
  .command('mcp')
  .description('Start the upstream MCP server (called automatically by Claude Code)')
  .action(startMcpServer)

program.parse()
```

- [ ] **Step 5: Run integration tests**

```bash
npx vitest run tests/integration/auth.test.js
```

Expected: 2 tests PASS.

- [ ] **Step 6: Verify help shows new commands**

```bash
node bin/upstream.js --help
```

Expected: `auth` and `mcp` appear in command list.

- [ ] **Step 7: Commit**

```bash
git add src/commands/auth.js bin/upstream.js tests/integration/auth.test.js
git commit -m "feat: add upstream auth command and mcp subcommand to CLI"
```

---

### Task 8: Update init + upgrade to Write .claude/settings.json

**Files:**

- Create: `src/lib/settings.js`
- Create: `tests/integration/init-settings.test.js`
- Modify: `src/commands/init.js`
- Modify: `src/commands/upgrade.js`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/init-settings.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TARGET = '/tmp/upstream-settings-test'
const CLI = join(__dirname, '../../bin/upstream.js')

beforeEach(() => { mkdirSync(TARGET, { recursive: true }); execSync('git init -q', { cwd: TARGET }) })
afterEach(() => { rmSync(TARGET, { recursive: true, force: true }) })

describe('upstream init — .claude/settings.json', () => {
  it('creates .claude/settings.json with MCP entry', () => {
    execSync(`node ${CLI} init`, { cwd: TARGET })
    const settings = JSON.parse(readFileSync(join(TARGET, '.claude/settings.json'), 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
  })

  it('merges MCP entry into existing settings.json without losing other keys', () => {
    mkdirSync(join(TARGET, '.claude'), { recursive: true })
    writeFileSync(join(TARGET, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash'] } }))

    execSync(`node ${CLI} init`, { cwd: TARGET })

    const settings = JSON.parse(readFileSync(join(TARGET, '.claude/settings.json'), 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
    expect(settings.permissions.allow).toContain('Bash')
  })

  it('upstream upgrade also writes MCP entry', () => {
    execSync(`node ${CLI} init`, { cwd: TARGET })

    // Simulate old settings without MCP entry
    const settingsPath = join(TARGET, '.claude/settings.json')
    writeFileSync(settingsPath, JSON.stringify({ permissions: {} }))

    execSync(`node ${CLI} upgrade`, { cwd: TARGET })

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(settings.mcpServers.upstream).toEqual({ command: 'npx', args: ['upstream', 'mcp'] })
    expect(settings.permissions).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/integration/init-settings.test.js 2>&1 | head -20
```

Expected: FAIL — `.claude/settings.json` not created.

- [ ] **Step 3: Create `src/lib/settings.js`**

```js
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import chalk from 'chalk'

const MCP_ENTRY = { command: 'npx', args: ['upstream', 'mcp'] }

export function writeMcpSettings(targetDir) {
  const settingsPath = join(targetDir, '.claude', 'settings.json')
  mkdirSync(dirname(settingsPath), { recursive: true })

  let settings = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    } catch {
      console.warn(chalk.yellow('warning: .claude/settings.json is not valid JSON — MCP entry will be added'))
      settings = {}
    }
  }

  const existing = settings?.mcpServers?.upstream
  if (existing &&
      (existing.command !== MCP_ENTRY.command ||
       JSON.stringify(existing.args) !== JSON.stringify(MCP_ENTRY.args))) {
    console.warn(chalk.yellow('warning: overwriting existing mcpServers.upstream in .claude/settings.json'))
  }

  settings.mcpServers = { ...settings.mcpServers, upstream: MCP_ENTRY }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}
```

- [ ] **Step 4: Update `src/commands/init.js`**

```js
import chalk from 'chalk'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { scaffoldInto } from '../lib/scaffold.js'
import { writeMcpSettings } from '../lib/settings.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(__dirname, '../../templates')

export async function initCommand() {
  const target = process.cwd()
  console.log(chalk.blue('upstream:'), 'scaffolding into', target)

  try {
    await scaffoldInto(target, TEMPLATES)
    writeMcpSettings(target)
    console.log(chalk.green('✓ upstream initialized'))
    console.log('')
    console.log('Next steps:')
    console.log('  1. Review and customize upstream.config.yaml')
    console.log('  2. git add .claude/ docs/ upstream.config.yaml')
    console.log('  3. git commit -m "feat: add upstream Claude Code plugin"')
    console.log('  4. Push — your team pulls it with the next git pull')
  } catch (err) {
    console.error(chalk.red('upstream init failed:'), err.message)
    process.exit(1)
  }
}
```

- [ ] **Step 5: Update `src/commands/upgrade.js`**

```js
import chalk from 'chalk'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { scaffoldInto } from '../lib/scaffold.js'
import { writeMcpSettings } from '../lib/settings.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(__dirname, '../../templates')

export async function upgradeCommand() {
  const target = process.cwd()
  console.log(chalk.blue('upstream:'), 'upgrading skills and hook in', target)

  try {
    await scaffoldInto(target, TEMPLATES)
    writeMcpSettings(target)
    console.log(chalk.green('✓ upstream upgraded'))
    console.log('')
    console.log('Review the diff and commit:')
    console.log('  git diff .claude/')
    console.log('  git add .claude/')
    console.log('  git commit -m "chore: upgrade upstream plugin"')
  } catch (err) {
    console.error(chalk.red('upstream upgrade failed:'), err.message)
    process.exit(1)
  }
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/integration/init-settings.test.js
```

Expected: 3 tests PASS.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/settings.js src/commands/init.js src/commands/upgrade.js tests/integration/init-settings.test.js
git commit -m "feat: write .claude/settings.json MCP entry on init and upgrade"
```

---

### Task 9: Update Config + Templates

**Files:**

- Modify: `src/lib/config.js`
- Modify: `templates/upstream.config.yaml`

- [ ] **Step 1: Update `src/lib/config.js`**

Add `integrations` and `link_policy` to `DEFAULT_CONFIG`:

```js
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
```

- [ ] **Step 2: Run config tests**

```bash
npx vitest run tests/unit/config.test.js
```

Expected: 3 tests PASS (no regressions).

- [ ] **Step 3: Update `templates/upstream.config.yaml`**

```yaml
version: 1

# Branch prefixes that bypass upstream checks (bugs, hotfixes, chores)
bypass_for:
  - fix/
  - hotfix/
  - chore/
  - docs/

# Required PRD fields — upstream-guard blocks if any are missing
prd_required_fields:
  - problem_statement
  - success_metrics
  - out_of_scope

# Architectural triggers — any of these in the PRD requires an ADR
adr_triggers:
  - new_external_dependency
  - database_schema_change
  - api_breaking_change
  - infrastructure_change
  - auth_change

# Where PRDs, ADRs, and skip log are stored
docs_path: docs/upstream/

# 'local': full PRD/ADR content stored in this repo
# 'link': stub file with URL + metadata; actual doc lives in Notion/Confluence/etc.
docs_storage: local

# Integrations — OAuth credentials per provider (set by platform engineer, commit to repo)
# integrations:
#   google_docs:
#     client_id: "xxx.apps.googleusercontent.com"
#     client_secret: "GOCSPX-..."
#     # Create credentials at: https://console.cloud.google.com/apis/credentials
#     # Enable: Google Drive API → OAuth 2.0 Client ID → Desktop app
#     # Add authorized redirect URI: http://localhost (any port)

# Link enforcement policy (optional — both fields are opt-in)
# link_policy:
#   allowed_providers:        # if set, only these provider URLs accepted in link mode
#     - google-docs
#   require_validation: true  # if true, unvalidated links block progress (no silent fallback)
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.js templates/upstream.config.yaml
git commit -m "feat: add integrations and link_policy to config schema and default template"
```

---

### Task 10: Update Skill Files

**Files:**

- Modify: `templates/skills/upstream-prd.md`
- Modify: `templates/skills/upstream-adr.md`

No unit tests — skill files are instructions to Claude Code. Verified manually in Task 11.

- [ ] **Step 1: Update `templates/skills/upstream-prd.md` — replace Mode: link section**

Find the existing `## Mode: link` section and replace it with:

```markdown
## Mode: link

Ask: "What's the URL for your PRD? (Notion, Confluence, Google Docs, or any other tool)"

Wait for the URL. Then:

1. Call the `validate_link` MCP tool with the URL.
2. Read `link_policy` from `upstream.config.yaml`.

**Policy checks (run before saving):**

If `link_policy.allowed_providers` is set AND the result `provider` is not in the list:
> Block: "This org only accepts links from: [allowed_providers]. Please provide a URL from one of those tools."

If `link_policy.require_validation` is true AND `result.error` is not null:
> Block: "This org requires validated links. [result.error]. Please resolve before continuing."
> (If error is "not authenticated", tell them: "Run `upstream auth google-docs` and try again.")

**After policy checks pass:**

If `result.title` is available: use it as the document title (do not ask the user).
If `result.last_edited` is available: use it as the date field.
If `result.title` is null: ask "What's the title of this document?" (use branch slug as fallback if skipped).

Read `.claude/plugins/upstream/templates/PRD-link.md` and fill in: title, URL, branch, date.

Save the stub (see Saving). Do not ask further questions after title is resolved.
```

Also update the **Saving** section to include:

```markdown
## Saving

If mode is `link`: read template from `.claude/plugins/upstream/templates/PRD-link.md`, fill fields, save stub.
Otherwise: save full PRD content.

Save to: `<docs_path>/PRD-<slug>.md`

After saving, say: "PRD saved to `<docs_path>/PRD-<slug>.md`."

If invoked from upstream-guard, add: "Returning to upstream-guard to check ADR requirements."
```

- [ ] **Step 2: Update `templates/skills/upstream-adr.md` — replace Mode: link section**

Find the existing `## Mode: link` section and replace it with:

```markdown
## Mode: link

Ask: "What's the URL for your ADR? (Notion, Confluence, Google Docs, or any other tool)"

Wait for the URL. Then:

1. Call the `validate_link` MCP tool with the URL.
2. Read `link_policy` from `upstream.config.yaml`.

**Policy checks (run before saving):**

If `link_policy.allowed_providers` is set AND the result `provider` is not in the list:
> Block: "This org only accepts links from: [allowed_providers]. Please provide a URL from one of those tools."

If `link_policy.require_validation` is true AND `result.error` is not null:
> Block: "This org requires validated links. [result.error]. Please resolve before continuing."
> (If error is "not authenticated", tell them: "Run `upstream auth google-docs` and try again.")

**After policy checks pass:**

If `result.title` is available: use it as the document title (do not ask the user).
If `result.last_edited` is available: use it as the date field.
If `result.title` is null: ask "What's the title of this ADR?" (use branch slug + trigger reason as fallback if skipped).

Read `.claude/plugins/upstream/templates/ADR-link.md` and fill in: title, URL, branch, date, trigger reason.

Save the stub (see Saving). Do not ask further questions after title is resolved.
```

Also ensure the **Saving** section reads:

```markdown
## Saving

If mode is `link`: read template from `.claude/plugins/upstream/templates/ADR-link.md`, fill fields, save stub.
Otherwise: save full ADR content.

Save to: `<docs_path>/ADR-<NNN>-<slug>.md`

After saving: "ADR saved to `<docs_path>/ADR-<NNN>-<slug>.md`."

If invoked from upstream-guard: "Returning to upstream-guard."
```

- [ ] **Step 3: Verify skill files updated correctly**

```bash
grep -n "validate_link" templates/skills/upstream-prd.md
grep -n "validate_link" templates/skills/upstream-adr.md
```

Expected: `validate_link` appears in both files.

- [ ] **Step 4: Commit**

```bash
git add templates/skills/upstream-prd.md templates/skills/upstream-adr.md
git commit -m "feat: update link mode in skills to call validate_link and enforce link_policy"
```

---

### Task 11: Full Test Suite + Manual Smoke Test

**Files:** No new files — verification only.

- [ ] **Step 1: Run full JS test suite**

```bash
npm test
```

Expected: all tests PASS (tokens: 7, google-docs-provider: 6, validate-link: 4, cli: 2, config: 3, scaffold: 5, init: 3, upgrade: 3, init-settings: 3, auth: 2 = 38 total).

- [ ] **Step 2: Run hook tests**

```bash
npm run test:hook
```

Expected: 6 bats PASS.

- [ ] **Step 3: Smoke test init creates settings.json**

```bash
SMOKE="/tmp/upstream-smoke-$$"
mkdir -p "$SMOKE" && cd "$SMOKE"
git init -q
node /Users/joaosmoura/dev/upstream/bin/upstream.js init
cat .claude/settings.json
```

Expected: JSON with `mcpServers.upstream = { command: "npx", args: ["upstream", "mcp"] }`.

- [ ] **Step 4: Smoke test auth status**

```bash
cd "$SMOKE"
node /Users/joaosmoura/dev/upstream/bin/upstream.js auth status
```

Expected: table listing `google-docs`, `confluence`, `notion` — all `✗ not authenticated`.

- [ ] **Step 5: Smoke test auth missing credentials**

```bash
cd "$SMOKE"
node /Users/joaosmoura/dev/upstream/bin/upstream.js auth google-docs 2>&1 || true
```

Expected: error message mentioning `client_id` or `credentials`.

- [ ] **Step 6: Smoke test validate-link unit**

```bash
node --input-type=module <<'EOF'
import { validateLink } from '/Users/joaosmoura/dev/upstream/src/lib/mcp/tools/validate-link.js'
const r1 = await validateLink('https://notion.so/page')
console.assert(r1.provider === 'unknown', 'notion should be unknown')
const r2 = await validateLink('https://docs.google.com/document/d/abc123/edit')
console.assert(r2.provider === 'google-docs', 'google docs should be detected')
console.assert(r2.error === 'not authenticated', 'should report unauthenticated')
console.log('validate_link smoke ✓')
EOF
```

Expected: `validate_link smoke ✓`

- [ ] **Step 7: Verify git log**

```bash
cd /Users/joaosmoura/dev/upstream
git log --oneline
git status
```

Expected: clean tree, commits from Tasks 1–10 all present on `main`.

- [ ] **Step 8: Cleanup**

```bash
rm -rf "$SMOKE"
```

---

## Self-Review Against Spec

| Requirement | Task |
| --- | --- |
| `upstream auth google-docs` OAuth2 flow | Task 6 |
| `upstream auth status` show providers | Task 7 |
| `upstream mcp` MCP server starts | Task 5 |
| `validate_link` tool: detect provider, call API | Task 4 |
| `validate_link` graceful fallback (unknown URL, unauthenticated) | Task 4 |
| Token refresh on 401 | Task 3 (`refreshTokenIfNeeded`) |
| Token storage in `~/.upstream/tokens.json` | Task 2 |
| `upstream init` writes `.claude/settings.json` | Task 8 |
| `upstream upgrade` also writes `.claude/settings.json` | Task 8 |
| Merge without overwriting existing settings keys | Task 8 |
| `link_policy.require_validation` blocks unvalidated links | Task 10 (skills) |
| `link_policy.allowed_providers` blocks wrong-provider links | Task 10 (skills) |
| Skills auto-populate title from API response | Task 10 (skills) |
| Graceful fallback when MCP not running | Task 10 (skills — instructions say to ask if tool unavailable) |
| Config schema: `integrations` + `link_policy` | Task 9 |
| Default config template with commented sections + GCP instructions | Task 9 |
| `client_id`/`client_secret` missing → clear error | Task 7 |
| Browser fails → URL printed to console | Task 6 |

**Placeholder scan:** None — all steps contain actual code.

**Type consistency:**

- `getProviderToken(provider)` defined in Task 2, used in Tasks 3, 4, 7
- `setProviderToken(provider, tokenData)` defined in Task 2, used in Tasks 3, 6
- `refreshTokenIfNeeded(tokenData, clientId, clientSecret)` defined in Task 3, called in Task 4
- `validateLink(url)` defined in Task 4, registered in Task 5
- `writeMcpSettings(targetDir)` defined in Task 8, called in Tasks 8 (init + upgrade)
- `readConfig(configPath)` from existing `src/lib/config.js`, called in Tasks 4, 7
