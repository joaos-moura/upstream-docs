# [backlog] Native integration for link mode (Notion, Confluence, Google Docs)

## Summary

When `docs_storage: link`, upstream skills currently accept any URL without validation. This issue tracks OAuth-based integration for Notion, Confluence Cloud, and Google Docs so the CLI can verify links and optionally create documents directly in those tools.

## Motivation

- Link validation: detect broken/private links at PR time instead of silently storing dead URLs
- Richer stub: pull real document title from the API instead of asking the user
- Future: allow skills to create PRD/ADR pages directly in the connected tool

## Proposed design

### Phase 1 — Auth

```bash
npx upstream auth notion        # OAuth2 flow → saves token to ~/.upstream/tokens.json
npx upstream auth confluence    # Confluence Cloud OAuth2
npx upstream auth google-docs   # Google OAuth2 (Drive scope)
npx upstream auth status        # Show connected integrations
```

### Phase 2 — Link validation

When `docs_storage: link` and a URL is provided:

- Skill detects provider from URL pattern (notion.so, atlassian.net, docs.google.com)
- Calls a small helper binary (`upstream-fetch`) to validate via the provider's API
- Pulls real document title, last-edited date
- Stub file gets accurate metadata instead of user-provided title
- Graceful fallback: if provider not authenticated, skip validation and proceed

### Phase 3 — Document creation (optional)

Skill can create a new page/doc from the PRD/ADR template in the connected tool and return the URL, instead of asking the user to create it first.

## Provider notes

| Provider | Auth | URL pattern | API |
| --- | --- | --- | --- |
| Notion | OAuth2 | `notion.so/*` | Notion API v1 |
| Confluence Cloud | OAuth2 | `*.atlassian.net/wiki/*` | Confluence REST API v2 |
| Google Docs | OAuth2 (Drive scope) | `docs.google.com/document/*` | Google Drive API v3 |

## Scope

- `upstream auth` subcommand (3 providers)
- Token storage in `~/.upstream/tokens.json` (gitignored by design)
- URL pattern detection (no config required — auto-detected from URL)
- Helper binary or MCP server for HTTP calls from within skills
- Graceful fallback: if not authenticated, behave exactly like current link mode

## Priority

Backlog — implement after v1 ships with URL-only link mode.
