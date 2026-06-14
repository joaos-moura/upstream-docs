# Design: `upstream init` Wizard + PKCE

**Date:** 2026-06-12
**Status:** Approved

## Overview

Two related improvements shipped together:

1. **Interactive wizard** for `upstream init` — guides platform engineers through configuration instead of dropping a template yaml.
2. **PKCE for Google Docs and Confluence** — eliminates `client_secret` from `upstream.config.yaml` entirely.

These ship together because the wizard defines what credentials are collected, and PKCE changes the answer from `(client_id, client_secret, allowed_domain)` to `(client_id, allowed_domain)`.

---

## Part 1: PKCE

### Problem

`client_secret` for Desktop-type OAuth apps is a pseudo-secret (RFC 8252 §8.6). Committing it to the repo, even an internal one, is poor hygiene. The correct solution for native/CLI apps is PKCE (Proof Key for Code Exchange), which replaces the `client_secret` with a per-flow `code_verifier`/`code_challenge` pair generated at runtime.

### Supported providers

| Provider   | PKCE support | Action                        |
|------------|--------------|-------------------------------|
| Google Docs | Yes         | Implement PKCE, drop secret   |
| Confluence  | Yes         | Implement PKCE, drop secret   |
| Notion      | No          | Removed (tracked in issue #1) |

### Changes

**`src/lib/auth/oauth2.js`**
- Generate `code_verifier` (43–128 random bytes, base64url-encoded) per flow
- Derive `code_challenge = BASE64URL(SHA256(code_verifier))`
- Add `code_challenge` and `code_challenge_method=S256` to auth URL params
- Pass `code_verifier` to `exchangeCode` for use in token request

**`src/lib/providers/google-docs.js`**
- `exchangeCode(code, clientId, redirectUri, codeVerifier)` — removes `clientSecret` param, adds `code_verifier` to token request body

**`src/lib/providers/confluence.js`**
- Same signature change as Google Docs

**`src/lib/providers/registry.js`**
- Remove `client_secret` from provider definitions
- `exchangeCode` signature updated across all providers

**`upstream.config.yaml` template**
- Remove `client_secret` field from all provider examples

### Config after PKCE

```yaml
integrations:
  google_docs:
    client_id: "xxx.apps.googleusercontent.com"
    allowed_domain: "yourcompany.com"
  confluence:
    client_id: "yyy"
    allowed_domain: "yourcompany.atlassian.net"
```

---

## Part 2: Init Wizard

### Architecture

Three files change:

| File | Change |
|------|--------|
| `src/commands/init.js` | Orchestrates wizard, resolves non-interactive inputs, calls scaffold |
| `src/lib/wizard.js` | New — interactive two-phase prompt logic |
| `src/lib/scaffold.js` | Accepts `answers` object, generates `upstream.config.yaml` dynamically instead of copying template |

**Dependency:** `@inquirer/prompts` for interactive prompts.

### Input precedence

```
--from file.json  >  CLI flags  >  interactive prompts
```

### Phase 1 — Critical (always collected)

1. `docs_storage` — `local` or `link`?
2. If `link`: which providers? (multi-select: google-docs, confluence)
3. Per provider: `client_id`, `allowed_domain`
4. Guardian account: GitHub handle or email responsible for config changes (generates CODEOWNERS)

### Phase 2 — Org defaults (optional)

After Phase 1, prompt:
> "Configure org defaults now? You can edit upstream.config.yaml later. (y/N)"

If yes:
- `bypass_for` — branch prefixes that skip upstream checks (default: `fix/, hotfix/, chore/, docs/`)
- `prd_required_fields` — required fields in PRDs (default: `problem_statement, success_metrics, out_of_scope`)
- `adr_triggers` — changes that require an ADR (default list shown, user can add/remove)

If no: defaults written to yaml as commented-out examples.

### Non-interactive mode

**CLI flags:**
```bash
upstream init \
  --docs-storage link \
  --provider google-docs \
  --client-id xxx \
  --allowed-domain acme.com \
  --guardian "@infra-team" \
  --yes
```

`--yes` skips Phase 2 and accepts all defaults.

**Input file:**
```bash
upstream init --from answers.json
```

```json
{
  "docs_storage": "link",
  "providers": [
    { "id": "google-docs", "client_id": "xxx", "allowed_domain": "acme.com" }
  ],
  "guardian": "@infra-team",
  "bypass_for": ["fix/", "hotfix/"],
  "prd_required_fields": ["problem_statement", "success_metrics"],
  "adr_triggers": ["database_schema_change", "api_breaking_change"]
}
```

### CODEOWNERS generation

Wizard appends to `.github/CODEOWNERS` (creates if absent):

```
# upstream config — changes require guardian approval
upstream.config.yaml @infra-team
```

Output includes reminder: "Enable branch protection on main for CODEOWNERS to be enforced."

### Error handling

| Scenario | Behavior |
|----------|----------|
| `--from` with invalid JSON | Fail with clear error before touching any file |
| Provider selected, missing `client_id` | Phase 1 does not advance |
| `upstream.config.yaml` already exists | Prompt: "Config exists. Overwrite? (y/N)" — default no |
| CODEOWNERS already exists | Append guardian entry, do not overwrite |

### Success output

```
✓ upstream.config.yaml generated
✓ .github/CODEOWNERS updated
✓ .claude/ scaffolded
✓ MCP settings written

Next steps:
  1. Enable branch protection on main (required for CODEOWNERS)
  2. git add . && git commit -m "feat: add upstream"
  3. git push
```

---

## Testing

### Unit tests

- `wizard.js`: prompts with injected answers → correct `answers` object
- `scaffold.js`: `answers` → generated yaml snapshot
- `scaffold.js`: CODEOWNERS entry generation and append logic
- `oauth2.js`: PKCE verifier/challenge generation (format, length, encoding)
- `google-docs.js` / `confluence.js`: `exchangeCode` without `client_secret`

### Integration tests

- `upstream init --from answers.json` — verify all files generated correctly
- `upstream init --docs-storage local --yes` — verify minimal config
- `upstream init` with existing config — verify no overwrite on N
- `upstream auth google-docs` end-to-end with PKCE flow (mocked HTTP)

---

## Files changed summary

- `src/commands/init.js` — updated
- `src/lib/wizard.js` — new
- `src/lib/scaffold.js` — updated
- `src/lib/auth/oauth2.js` — PKCE support
- `src/lib/providers/google-docs.js` — PKCE exchange
- `src/lib/providers/confluence.js` — PKCE exchange
- `src/lib/providers/registry.js` — remove client_secret refs
- `templates/upstream.config.yaml` — remove client_secret
- Tests: unit + integration for all above
