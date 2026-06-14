# Contributing to upstream

Thanks for your interest. This document covers how to set up the project, understand the codebase, and ship changes.

---

## Development setup

**Requirements:** Node.js 20+, npm, [bats-core](https://github.com/bats-core/bats-core) for shell tests.

```bash
git clone https://github.com/joaos-moura/upstream
cd upstream
npm install
```

Run the full test suite:

```bash
npm test           # JS unit + integration tests (vitest)
npm run test:hook  # Shell hook tests (bats)
```

All tests must pass before submitting a pull request.

---

## Project structure

```
bin/
  upstream.js               # CLI entry point (Commander.js)
src/
  commands/
    init.js                 # upstream init — wizard + scaffold orchestration
    upgrade.js              # upstream upgrade
    auth.js                 # upstream auth <provider>
  lib/
    config.js               # read upstream.config.yaml
    wizard.js               # interactive two-phase init wizard (@inquirer/prompts)
    scaffold.js             # scaffold files into target repo, generateConfig, writeCodeowners
    settings.js             # write .claude/settings.json MCP entry
    tokens.js               # read/write ~/.upstream/tokens.json; deleteProviderToken for cleanup
    auth/
      oauth2.js             # OAuth2 + PKCE flow (generatePKCE, browser → localhost → token exchange)
    providers/
      registry.js           # PROVIDERS map — all provider definitions; callbackPort for fixed-port providers
      google-docs.js        # Drive API: extractId, exchangeCode (PKCE), getMetadata, refresh
      confluence.js         # Confluence API: extractId, exchangeCode (PKCE), getMetadata, refresh
    mcp/
      server.js             # MCP server entry (stdio transport)
      tools/
        validate-link.js    # validate_link tool: detect provider, call API, return metadata
        create-document.js  # create_document tool: create doc in provider, return URL
templates/
  hooks/
    upstream-check.sh       # UserPromptSubmit hook (bash)
  skills/
    upstream-guard.md       # orchestration skill
    upstream-prd.md         # PRD creation skill
    upstream-adr.md         # ADR creation skill
  templates/
    PRD.md                  # PRD content template
    ADR.md                  # ADR content template
    PRD-link.md             # stub for link mode
    ADR-link.md             # stub for link mode
  upstream.config.yaml      # default config template
tests/
  unit/                     # vitest unit tests
  integration/              # vitest integration tests (run CLI as subprocess)
  hook/                     # bats tests for upstream-check.sh
```

**Key design decisions:**

- **ESM throughout** — the package uses `"type": "module"`. All imports use ESM syntax (`import`/`export`). No CommonJS.
- **PKCE + client_secret for all current providers** — all OAuth flows use PKCE (RFC 7636). `upstream.config.yaml` only stores `client_id` and `allowed_domain`. Both Google Docs and Confluence require a `client_secret` for token exchange (neither supports public clients) — secrets are loaded from `UPSTREAM_GOOGLE_CLIENT_SECRET` / `UPSTREAM_CONFLUENCE_CLIENT_SECRET` env vars and never committed. `upstream init` writes placeholders to `.env`, `.env.local`, and `.env.example`. If a future provider is a true public client, set no `callbackPort` and omit `client_secret` from `exchangeCode`.
- **Config is committed, tokens are not** — `upstream.config.yaml` belongs in the repo (set by platform engineers). `~/.upstream/tokens.json` is per-developer and never committed.
- **Skills are markdown** — `upstream-guard.md`, `upstream-prd.md`, `upstream-adr.md` are instruction files for Claude Code, not code. Changes to them change Claude's behavior.
- **Wizard generates config** — `upstream init` runs an interactive wizard that writes `upstream.config.yaml` from answers rather than copying a static template. Non-interactive mode via `--from file.json` or `--yes`. Provider selection uses a `checkbox` (multiple providers supported); per-provider `client_id` and `allowed_domain` prompts follow each selection. `validateClientId` and `validateDomain` are exported from `wizard.js` for inline format validation. `init` also auto-updates `.gitignore` with `.env`/`.env.local`/`.env.test` to prevent accidental secret commits.
- **OAuth validation during init** — after scaffolding, `upstream init` optionally opens a browser to test the integration immediately (`runOAuthFlow` + `deleteProviderToken`). A braille spinner runs on stderr while waiting for the callback. If validation is skipped or fails, developers can re-run `upstream auth <provider>` later.
- **Session-based hook caching** — `upstream-check.sh` writes `/tmp/upstream-checked-{PPID}-{slug}` on first run. Subsequent prompts in the same Claude Code session exit silently. A new session means a new PPID, which means a fresh check. On each run the hook also purges cache files older than 24 hours using `stat`+`rm` (portable across macOS and Linux — `find -delete` is unreliable via the `/tmp → /private/tmp` symlink on macOS).

---

## Running the CLI locally

```bash
# From the repo root
node bin/upstream.js --help
node bin/upstream.js init --yes
node bin/upstream.js auth status
```

---

## Adding a new provider

upstream currently supports Google Docs and Confluence. To add a new provider:

1. **Create `src/lib/providers/<name>.js`** — implement the following exports:
   - `extractId(url)` — extract the document ID from a URL, return `null` if not matched
   - `exchangeCode(code, clientId, redirectUri, codeVerifier)` — exchange OAuth code for tokens using PKCE (no `clientSecret` param)
   - `getIdentity(accessToken, tokenResponse)` — return identity object used by `validateDomain`
   - `validateDomain(identity, config)` — return `true` if identity belongs to the configured org
   - `getMetadata(docId, accessToken)` — return `{ title, last_edited }` from the provider API
   - `createDocument(title, content, destination, tokenData)` — create a document, return `{ url }`
   - Optionally: `refreshTokenIfNeeded(tokenData, appConfig)`, `enrichToken(tokenData, identity, config)`

2. **Register in `src/lib/providers/registry.js`** — add a `PROVIDERS` entry with:
   - `configKey` — key under `integrations` in `upstream.config.yaml`
   - `urlPattern` — regex to match provider URLs
   - `domainField` — config key for org domain validation (e.g. `allowed_domain`)
   - `authUrl` — OAuth authorization endpoint
   - `scopes` — required OAuth scopes
   - `authParams` — extra query params for the auth URL
   - `supportsRefresh` — whether the provider issues refresh tokens
   - `callbackPort` — fixed port for the local OAuth callback server, if the provider requires an exact registered redirect URI (e.g. Confluence uses `27182`). Omit for providers that accept any localhost port (e.g. Google Desktop app).

3. **Update `templates/upstream.config.yaml`** — add a commented example for the new provider's credentials.

4. **Write tests** — unit tests for `extractId`, `validateDomain` (pure functions, no network). Integration test for the auth command error path (missing credentials).

5. **Update wizard if needed** — if the provider needs special config fields beyond `client_id` + `allowed_domain`, update `src/lib/wizard.js` to collect them in Phase 1.

**Note on secrets and PKCE:** All providers use PKCE. Both current providers also require a `client_secret` in `exchangeCode` — read it from `process.env.UPSTREAM_<PROVIDER>_CLIENT_SECRET` and throw if unset (see `google-docs.js` or `confluence.js` for the pattern). If you're adding a true public client (no secret), omit that check. If the provider requires a registered redirect URI, set `callbackPort` in the registry entry and document the URL developers must register.

---

## Modifying skill files

The files in `templates/skills/` are instruction documents that Claude Code reads at runtime. They are not parsed programmatically. When editing them:

- Keep the YAML frontmatter (`name`, `description`) — Claude Code uses it for skill registration.
- Be precise about conditions and fallbacks. Vague instructions produce inconsistent behavior.
- Reference `<docs_path>` (read from `upstream.config.yaml`) rather than hardcoding `docs/upstream/`.
- Test by running `upstream init --yes` into a scratch repo and exercising the skill manually in Claude Code.

---

## Code style

- No comments unless the *why* is non-obvious — well-named identifiers are self-documenting.
- Error messages that users see go to `stderr` (`console.error`), not `stdout`.
- Validate at system boundaries (user input, external APIs). Trust internal function contracts.
- Keep functions small and named for what they do. Avoid abstraction before it's needed.

---

## Test conventions

- **Unit tests** (`tests/unit/`) — test pure functions directly. Mock external I/O (network, filesystem via `UPSTREAM_TOKENS_PATH` env). Use `vitest` mocks for modules.
- **Integration tests** (`tests/integration/`) — run the CLI as a child process with `execSync`. Pass `--yes` or `--from answers.json` to `upstream init` so tests are non-interactive. Use real temp directories under `/tmp/`, cleaned up in `afterEach`.
- **Hook tests** (`tests/hook/`) — bats scripts that exercise `upstream-check.sh` directly with mock git state.

New tests go in the right category. Integration tests are slower but catch wiring bugs that unit tests miss — prefer them for command-level behavior.

---

## Submitting changes

1. Fork the repo and create a branch from `main`.
2. Make your changes with tests.
3. Run `npm test && npm run test:hook` — all must pass.
4. Open a pull request with a clear description of what changed and why.

For larger changes (new providers, new commands, changes to the skill behavior), open an issue first to discuss the design.
