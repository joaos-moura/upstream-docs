# upstream Integrations Design Spec

**Date:** 2026-06-11
**Status:** Approved

## Problem

When `docs_storage: link`, upstream skills accept any URL without validation. There is no way to verify a link is real, accessible, or pull its real title. Orgs also have no mechanism to enforce which documentation tools are acceptable.

---

## Scope

**This spec covers (v1.1):**

- `upstream auth google-docs` — OAuth2 flow for Google Docs
- `upstream auth status` — show authenticated integrations
- `upstream mcp` — local MCP server exposing a `validate_link` tool
- Link enforcement policy via `upstream.config.yaml`
- `upstream init` registers the MCP server in `.claude/settings.json`
- Skills updated to call `validate_link` in link mode

**Explicitly out of scope (future):**

- Notion and Confluence providers (same architecture, added later)
- Document creation (Phase 3) — MCP architecture already supports it

---

## Architecture Overview

The MCP server is embedded in the `upstream` CLI binary — same npm package, new subcommand. `upstream mcp` starts a local MCP server using `@modelcontextprotocol/sdk`. The Claude Code process spawns it automatically when the developer opens a repo that has been upstream-enabled.

`upstream init` writes the MCP server registration into `.claude/settings.json` in the org repo. Developers who `git pull` get the MCP server registered automatically — zero per-dev setup beyond `upstream auth`.

OAuth credentials (`client_id` + `client_secret`) are set by the platform engineer in `upstream.config.yaml` and committed to the repo. Per-developer tokens are stored in `~/.upstream/tokens.json` (never committed).

---

## Configuration (`upstream.config.yaml`)

```yaml
# Integrations — set OAuth credentials per provider
# integrations:
#   google_docs:
#     client_id: "xxx.apps.googleusercontent.com"
#     client_secret: "GOCSPX-..."

# Link enforcement policy
# link_policy:
#   allowed_providers:        # if set, only these providers accepted
#     - google-docs
#   require_validation: true  # if true, unvalidated links are blocked (no silent fallback)
```

Both sections are commented out by default. Org opts in by uncommenting and committing.

**Policy behaviour:**

| Config | Dev not authenticated | Non-approved provider URL | API offline |
| --- | --- | --- | --- |
| No policy (default) | Proceeds, asks for title | Proceeds | Proceeds |
| `require_validation: true` | Blocks: "Run `upstream auth google-docs`" | Blocks if not in allowed list | Blocks with error |
| `allowed_providers: [google-docs]` | N/A | Blocks: "This org requires Google Docs links" | N/A |

---

## New CLI Commands

### `upstream auth google-docs`

1. Reads `integrations.google_docs.client_id` + `client_secret` from `upstream.config.yaml` — clear error if missing
2. Picks a random free local port
3. Opens browser to Google OAuth consent screen (`redirect_uri=http://localhost:<port>/callback`)
4. Starts temporary HTTP server on that port
5. Captures `code` from callback, shuts down temp server
6. Exchanges code for `access_token` + `refresh_token` via POST to `oauth2.googleapis.com`
7. Saves to `~/.upstream/tokens.json`
8. Prints: `✓ Google Docs connected.`

**OAuth scope:** `https://www.googleapis.com/auth/drive.metadata.readonly` — reads title and metadata only, no content access, no write permissions.

**Token refresh:** MCP server automatically refreshes expired tokens on 401 response, transparent to the developer.

### `upstream auth status`

Reads `~/.upstream/tokens.json` and `upstream.config.yaml`, prints per-provider status:

```text
google-docs  ✓ authenticated (expires 2026-07-11)
confluence   ✗ not configured
notion       ✗ not configured
```

### `upstream mcp`

Starts the MCP server. Called automatically by Claude Code via `.claude/settings.json` — developers never call this directly.

---

## MCP Server

**Registered in `.claude/settings.json` by `upstream init`:**

```json
{
  "mcpServers": {
    "upstream": {
      "command": "npx",
      "args": ["upstream", "mcp"]
    }
  }
}
```

`init` and `upgrade` both merge this into any existing `.claude/settings.json` without overwriting other entries. Orgs that ran `init` before this feature was added get the MCP registration on their next `upgrade`.

### Tool: `validate_link`

```text
Input:  { url: string }
Output: {
  valid: boolean,
  title: string | null,
  provider: "google-docs" | "unknown",
  last_edited: string | null,  // ISO 8601
  error: string | null
}
```

**Flow:**

1. Detect provider from URL pattern: `docs.google.com/document/d/<id>` → `google-docs`
2. Unknown pattern → `{ valid: true, title: null, provider: "unknown" }`
3. Known provider, no token → `{ valid: true, title: null, provider: "google-docs", error: "not authenticated" }`
4. Authenticated → call Google Drive API `files.get?fields=name,modifiedTime` with the doc ID extracted from the URL
5. Return `{ valid: true, title: "<real title>", provider: "google-docs", last_edited: "..." }`
6. API error → `{ valid: false, title: null, error: "<message>" }`

---

## Skills Changes

### `upstream-prd` and `upstream-adr` — link mode

After user provides a URL, before saving the stub:

```text
1. Call validate_link tool with the URL.
2. Read link_policy from upstream.config.yaml.

If policy.require_validation is true AND result.error is not null:
  → Block: "This org requires validated links. [error message]. Please resolve before continuing."

If policy.allowed_providers is set AND result.provider not in allowed_providers:
  → Block: "This org only accepts links from: [allowed_providers]. Please provide a valid URL."

If title is returned:
  → Use result.title as the document title (don't ask user)
  → Use result.last_edited to populate the date field

If title is null but no blocking policy:
  → Ask user for title as before (graceful fallback)
```

The stub file (`PRD-link.md` / `ADR-link.md`) is populated with real metadata when available.

---

## File Map

**New files:**

```text
src/
  commands/
    auth.js                        # upstream auth <provider> dispatcher
  lib/
    auth/
      google-docs.js               # OAuth2 flow: browser open, localhost callback, token exchange
    mcp/
      server.js                    # MCP server entry, tool registration
      tools/
        validate-link.js           # validate_link tool implementation
    providers/
      google-docs.js               # Google Drive API: extract doc ID, call files.get, refresh token
    tokens.js                      # read/write ~/.upstream/tokens.json
```

**Modified files:**

```text
bin/upstream.js                    # register auth + mcp commands
src/commands/init.js               # merge MCP entry into .claude/settings.json
src/lib/config.js                  # DEFAULT_CONFIG gets integrations: {}, link_policy: {}
templates/upstream.config.yaml     # add commented integrations + link_policy sections
templates/skills/upstream-prd.md   # link mode: call validate_link, respect policy
templates/skills/upstream-adr.md   # same
```

---

## Error Handling

| Scenario | Behaviour |
| --- | --- |
| `client_id`/`client_secret` missing from config | `upstream auth google-docs` exits with clear instruction to configure them |
| Browser fails to open | Prints OAuth URL for manual copy-paste |
| User cancels consent screen | Auth command exits cleanly: "Authentication cancelled." |
| Token file unreadable/corrupt | MCP server treats as unauthenticated, logs warning |
| Google API rate limit / timeout | `validate_link` returns `{ valid: false, error: "API unavailable" }` |
| `.claude/settings.json` write conflict | `init` merges carefully; warns if `mcpServers.upstream` already set to something different |

---

## Testing

### Unit

- `src/lib/providers/google-docs.js`: doc ID extraction from URLs (valid, invalid, edge cases)
- `src/lib/tokens.js`: read/write/refresh token storage
- `src/lib/config.js`: `integrations` and `link_policy` merge with defaults

### Integration

- `upstream auth google-docs` with missing config → clear error message
- `upstream auth status` with/without tokens
- `upstream init` on repo with existing `.claude/settings.json` → correct merge

### MCP tool (manual)

- `validate_link` with valid Google Docs URL → returns real title
- `validate_link` with unknown URL → graceful unknown response
- `validate_link` unauthenticated → non-blocking error response

### Skills (manual, fixture repos)

- Link mode with `require_validation: true` + no auth → blocked
- Link mode with `allowed_providers` + wrong provider → blocked
- Link mode authenticated → title auto-populated, no question asked
- Link mode no integration configured → behaves like current (asks for title)

---

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework (new)
- `open` — open browser cross-platform (new, small utility package)
- All other auth/API calls use Node.js built-in `https` — no extra HTTP client needed
