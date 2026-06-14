# Design: Notion & Confluence Integrations

**Date:** 2026-06-12
**Status:** Approved
**Scope:** Phase 1 (auth) + Phase 2 (link validation) + Phase 3 (document creation)

---

## Overview

Adds Notion and Confluence Cloud as first-class providers alongside the existing Google Docs integration. Follows the same OAuth2 credential model: DevOps configures app credentials and domain constraints in `upstream.config.yaml` once per org; each dev authenticates individually via `upstream auth <provider>`.

---

## Architecture

```
src/lib/
  auth/
    oauth2.js            # shared: findFreePort, waitForCallback, exchangeCode, runOAuthFlow
  providers/
    registry.js          # all provider definitions (config + function references)
    google-docs.js       # refactored: extractId, getIdentity, getMetadata, createDocument
    notion.js            # new: same interface
    confluence.js        # new: same interface
  mcp/
    tools/
      validate-link.js   # updated: uses registry to detect provider
      create-document.js # new: MCP tool for document creation
src/commands/
  auth.js                # updated: uses registry + runOAuthFlow
```

---

## Provider Registry

`src/lib/providers/registry.js` defines each provider as a config object:

```js
export const PROVIDERS = {
  'google-docs': {
    configKey: 'google_docs',
    urlPattern: /docs\.google\.com\/document\/d\//,
    supportsRefresh: true,
    domainField: 'allowed_domain',
    validateDomain: (identity, config) =>
      identity.email?.endsWith(`@${config.allowed_domain}`),
  },
  'notion': {
    configKey: 'notion',
    urlPattern: /notion\.so\//,
    supportsRefresh: false,           // Notion tokens do not expire
    domainField: 'allowed_workspace',
    validateDomain: (identity, config) =>
      identity.workspace_name === config.allowed_workspace ||
      identity.workspace_id === config.allowed_workspace,
  },
  'confluence': {
    configKey: 'confluence',
    urlPattern: /\.atlassian\.net\/wiki\//,
    supportsRefresh: true,
    domainField: 'allowed_domain',
    validateDomain: (identity, config) =>
      identity.site_url?.includes(config.allowed_domain),
  },
}
```

Each provider's `extractId`, `getIdentity`, `getMetadata`, and `createDocument` functions live in `src/lib/providers/<name>.js` and are imported into the registry entry.

---

## Domain Enforcement

DevOps configures domain/workspace constraints in `upstream.config.yaml`:

```yaml
integrations:
  notion:
    client_id: "..."
    client_secret: "..."
    allowed_workspace: "acme-corp"       # workspace name or ID

  confluence:
    client_id: "..."
    client_secret: "..."
    allowed_domain: "acme.atlassian.net" # Atlassian subdomain

  google_docs:
    client_id: "..."
    client_secret: "..."
    allowed_domain: "acme.com"           # email domain
```

After the OAuth code exchange, `runOAuthFlow` calls `provider.getIdentity(accessToken)` and then `provider.validateDomain(identity, appConfig)`. If validation fails, the token is **not saved** and the CLI exits with a clear error:

```
upstream auth: your account does not belong to the workspace/domain configured for this org.
```

Missing `allowed_domain`/`allowed_workspace` in config is also a hard error — auth aborts with setup instructions.

---

## Auth Flow

`src/lib/auth/oauth2.js` exports `runOAuthFlow(providerId, providerDef, appConfig)`:

```
1. findFreePort()
2. Build auth URL (authUrl, clientId, redirectUri, scopes, state)
3. open(authUrl) + waitForCallback(port, state)
4. exchangeCode(code, tokenUrl, clientId, clientSecret, redirectUri)
5. providerDef.getIdentity(accessToken)
6. providerDef.validateDomain(identity, appConfig) → error if fails
7. setProviderToken(providerId, { access_token, refresh_token, expiry })
   - Notion: refresh_token: null, expiry: null
```

`src/commands/auth.js` becomes provider-agnostic:

```js
const def = PROVIDERS[provider]
if (!def) { /* error: unknown provider */ }
const appConfig = config.integrations?.[def.configKey]
await runOAuthFlow(provider, def, appConfig)
```

---

## Link Validation

`validate-link.js` iterates the registry to detect provider by URL pattern:

```js
export async function validateLink(url) {
  const entry = Object.entries(PROVIDERS).find(([, def]) => def.urlPattern.test(url))
  if (!entry) return { valid: true, provider: 'unknown', title: null, last_edited: null, error: null }

  const [providerId, def] = entry
  const tokenData = getProviderToken(providerId)
  if (!tokenData) return { valid: true, provider: providerId, title: null, last_edited: null, error: 'not authenticated' }

  const config = readConfig(...)
  const appConfig = config.integrations?.[def.configKey]
  const token = def.supportsRefresh
    ? await def.refreshTokenIfNeeded(tokenData, appConfig)
    : tokenData

  const id = def.extractId(url)
  const metadata = await def.getMetadata(id, token.access_token)
  return { valid: true, provider: providerId, title: metadata.title, last_edited: metadata.last_edited, error: null }
}
```

Graceful fallback preserved: unauthenticated → `valid: true`, `error: 'not authenticated'`, no block.

---

## Document Creation

New MCP tool `create_document` in `src/lib/mcp/tools/create-document.js`.

**Input:** `{ provider, title, content, destination }`
- `destination` is dev-provided: Notion page/database ID, or Confluence `SPACE/parentId`
- DevOps controls the workspace/domain boundary via auth; devs choose the specific location within it

**Output:** `{ url }`

Each provider's `createDocument(title, content, destination, accessToken)` handles the API call. Skills use the returned URL to populate the stub file.

---

## Provider API Details

| Provider | Auth URL | Token URL | Scopes | Identity endpoint |
|---|---|---|---|---|
| Notion | `https://api.notion.com/v1/oauth/authorize` | `https://api.notion.com/v1/oauth/token` | (none — Notion uses integration-level access) | token response includes `workspace_name`, `workspace_id` |
| Confluence | `https://auth.atlassian.com/authorize` | `https://auth.atlassian.com/oauth/token` | `read:confluence-content.all`, `write:confluence-content`, `offline_access` | `https://api.atlassian.com/me` |

Notion token exchange uses HTTP Basic auth (`clientId:clientSecret`) instead of body params — handled in `notion.js`.

---

## Error Handling

| Situation | Behavior |
|---|---|
| Provider not authenticated | `valid: true`, `error: 'not authenticated'` — no block |
| Token expired + refresh fails | `valid: false`, `error: <API message>` |
| Doc inaccessible (private/deleted) | `valid: false`, `error: 'not found or no access'` |
| Domain validation fails at auth | Abort, token not saved, clear error message |
| `allowed_domain`/`allowed_workspace` missing | Auth aborts with setup instructions |
| Unknown URL pattern | `valid: true`, `provider: 'unknown'` — passthrough |

---

## Testing

- `tests/unit/notion-provider.test.js` — `extractId`, `getIdentity`, `getMetadata`, `validateDomain` (fetch mocked)
- `tests/unit/confluence-provider.test.js` — same interface
- `tests/unit/validate-link.test.js` — expand with Notion and Confluence URLs (authenticated + unauthenticated)
- `tests/integration/auth.test.js` — expand: domain validation pass/fail for new providers

`oauth2.js` shared flow tested indirectly via existing integration tests.
