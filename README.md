# upstream

[![npm version](https://img.shields.io/npm/v/upstream-docs.svg)](https://www.npmjs.com/package/upstream-docs)
[![CI](https://github.com/joaos-moura/upstream-docs/actions/workflows/ci.yml/badge.svg)](https://github.com/joaos-moura/upstream-docs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> A Claude Code plugin that enforces PRD and ADR documentation before feature development begins.

**upstream** installs a hook into Claude Code that detects feature work and blocks it until a Product Requirements Document (PRD) exists. If the feature introduces architectural decisions — a new external dependency, a database migration, an API contract change — it also requires an Architecture Decision Record (ADR).

This keeps your team's reasoning in the repository, not scattered across memory.

---

## How it works

After `upstream init`, the first prompt on a feature branch in each Claude Code session gets a context injection:

```text
UPSTREAM: feature detected without PRD. Invoke upstream-guard before continuing.
```

The hook fires at most once per session (tracked via a PPID-based cache file in `/tmp`). Subsequent prompts in the same session are silent.

Claude then runs the `upstream-guard` skill, which:

1. **Classifies the work** — feature, bug, fix, chore, or incident
2. **Checks for a PRD** — by filename or content match in `<docs_path>/`
3. **Checks for an ADR** — if the PRD describes architectural decisions
4. **Releases to development** once docs are in place

PRDs and ADRs can be created in four ways: imported from an existing document, generated through a short interview, auto-drafted from git context, or linked to an external tool (Confluence, Google Docs).

Bypass branches (`fix/`, `hotfix/`, `chore/`, `docs/`) are skipped automatically.

---

## Quick start

```bash
# Install globally
npm install -g upstream-docs

# In your repo (platform engineer runs this once)
cd my-project
upstream init
git add .
git commit -m "feat: add upstream Claude Code plugin"
git push
```

`upstream init` runs an interactive wizard that configures `upstream.config.yaml`, scaffolds `.claude/`, optionally sets up a CODEOWNERS guardian, and automatically updates `.gitignore` to exclude `.env`/`.env.local`/`.env.test`.

Your team gets the plugin on their next `git pull`. No global install required on their machines — Claude Code picks up `.claude/` automatically.

---

## CLI reference

| Command | Description |
| --- | --- |
| `upstream init` | Interactive wizard: scaffold upstream into the current repo |
| `upstream init --yes` | Non-interactive: scaffold with all defaults |
| `upstream init --from answers.json` | Non-interactive: load all answers from a JSON file |
| `upstream upgrade` | Regenerate skills and hook, preserve config and docs |
| `upstream auth google-docs` | Connect Google Docs via OAuth (PKCE) |
| `upstream auth confluence` | Connect Confluence via OAuth (PKCE) |
| `upstream auth status` | Show authentication status for all providers |
| `upstream logout <provider>` | Remove stored token for a provider (or `all`) |
| `upstream doctor` | Check upstream installation health in the current repo |
| `upstream doctor --fix` | Repair missing or misconfigured files automatically |
| `upstream status` | Show PRD/ADR state for the current git branch |
| `upstream mcp` | Start the upstream MCP server (called automatically by Claude Code) |

### `upstream init` flags

| Flag | Description |
| --- | --- |
| `--from <file>` | Load answers from a JSON file (non-interactive, for CI/scripts) |
| `--docs-storage <value>` | `local` or `link` |
| `--provider <id>` | `google-docs` or `confluence` |
| `--client-id <id>` | OAuth client_id for the provider |
| `--allowed-domain <domain>` | Allowed domain (e.g. `acme.com`) |
| `--guardian <handle>` | GitHub handle or email written to `.github/CODEOWNERS` |
| `--yes` | Skip interactive Phase 2 (use org defaults) |

---

## Configuration

`upstream.config.yaml` is created in your repo root on `init`. All fields have defaults.

```yaml
version: 1

# Branch prefixes that bypass all checks
bypass_for:
  - fix/
  - hotfix/
  - chore/
  - docs/

# Fields that must be present in every PRD
prd_required_fields:
  - problem_statement
  - success_metrics
  - out_of_scope

# Conditions that require an ADR
adr_triggers:
  - new_external_dependency
  - database_schema_change
  - api_breaking_change
  - infrastructure_change
  - auth_change

# Directory for PRDs, ADRs, and the skip log
docs_path: docs/upstream/

# 'local': full document content in this repo
# 'link': stub file with URL; actual doc lives externally
docs_storage: local
```

---

## Link mode — external docs (Confluence, Google Docs)

If your team stores PRDs and ADRs in an external tool, set `docs_storage: link`. upstream saves a small stub file with the document URL and metadata instead of full content:

```markdown
# PRD: user-auth

- **Status:** Linked
- **Storage:** external
- **Document:** https://docs.google.com/document/d/...
- **Date:** 2026-06-12
```

### OAuth and PKCE

upstream uses **PKCE** (Proof Key for Code Exchange, RFC 7636) for all OAuth flows. Only `client_id` and `allowed_domain` are stored in `upstream.config.yaml` — never in version control.

Both **Google Docs** and **Confluence** require a `client_secret` — neither supports public OAuth clients. Secrets are stored as env vars (`UPSTREAM_GOOGLE_CLIENT_SECRET`, `UPSTREAM_CONFLUENCE_CLIENT_SECRET`) and loaded at CLI startup. They are never stored in `upstream.config.yaml` or committed to the repo. `upstream init` writes the placeholder to `.env`, `.env.local`, and `.env.example` automatically.

### Google Docs integration

**Setup (platform engineer, done once per org):**

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
2. Enable the **Google Drive API**
3. Create an **OAuth 2.0 Client ID** → type: **Desktop app**
   - Desktop app type allows localhost automatically — no redirect URI configuration needed
4. Copy the **Client secret** from the credential detail page
5. Add `client_id` and `allowed_domain` to `upstream.config.yaml` and commit:

```yaml
integrations:
  google_docs:
    client_id: "xxx.apps.googleusercontent.com"
    allowed_domain: "yourcompany.com"
```

Add the `client_secret` to your `.env` / `.env.local` — never commit this file:

```bash
UPSTREAM_GOOGLE_CLIENT_SECRET=your-secret-here
```

> `upstream init` creates the placeholder automatically when you choose Google Docs during setup.

**Each developer authenticates once:**

```bash
upstream auth google-docs
```

### Confluence integration

**Setup (platform engineer, done once per org):**

1. Create an app at [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/)
2. Enable **OAuth 2.0 (3LO)**
3. In **Authorization**, add callback URL: `http://localhost:27182/callback`
4. In **Permissions**, add scopes: `read:confluence-content.all`, `write:confluence-content`
   - `offline_access` is not listed in Permissions — upstream requests it automatically at auth time
5. Copy the **Client ID** and **Client secret** from the app's **Settings** tab
6. Add `client_id` and `allowed_domain` to `upstream.config.yaml` and commit:

```yaml
integrations:
  confluence:
    client_id: "your-client-id"
    allowed_domain: "yourorg.atlassian.net"
```

> `allowed_domain` must be your Atlassian site subdomain (e.g. `acme.atlassian.net`), not your company domain.

Add the `client_secret` to your `.env` / `.env.local` — never commit this file:

```bash
UPSTREAM_CONFLUENCE_CLIENT_SECRET=your-secret-here
```

> `upstream init` creates the placeholder in `.env`, `.env.local`, and `.env.example` automatically.

**Each developer authenticates once:**

```bash
upstream auth confluence
```

### Enforcement policy

Platform engineers can restrict which tools are accepted and require validation before a link can be saved:

```yaml
link_policy:
  allowed_providers:      # only accept links from these tools
    - google-docs
  require_validation: true  # block unvalidated links (e.g. unauthenticated)
```

### CODEOWNERS guardian

During `upstream init`, you can designate a GitHub handle or email as the guardian for `upstream.config.yaml`. upstream writes a `.github/CODEOWNERS` entry — any PR that modifies the config requires guardian approval.

> **Note:** CODEOWNERS is only enforced when branch protection is enabled on the repository.

---

## Skipping

If a PRD or ADR genuinely isn't needed, developers can skip with a justification. The skip is logged to `<docs_path>/SKIPS.md` and a PR snippet is generated for transparency:

```text
> ⚠️ upstream skip: PRD not created for `feat/quick-fix`.
> Reason: two-line CSS change, no product decisions involved.
> Logged in: <docs_path>/SKIPS.md
```

---

## What gets committed to your repo

```text
.claude/
  hooks/
    upstream-check.sh           # UserPromptSubmit hook
  plugins/upstream/
    skills/
      upstream-guard.md         # orchestration skill
      upstream-prd.md           # PRD creation skill
      upstream-adr.md           # ADR creation skill
    templates/
      PRD.md                    # PRD template
      ADR.md                    # ADR template
      PRD-link.md               # stub template for link mode
      ADR-link.md               # stub template for link mode
  settings.json                 # MCP server registration (upstream mcp)
upstream.config.yaml            # org configuration
.env.example                    # env var placeholders (shows required secrets, safe to commit)
.gitignore                      # updated by upstream init to exclude .env/.env.local/.env.test
.github/
  CODEOWNERS                    # guardian entry (if configured)
<docs_path>/                    # your PRDs, ADRs, and skip log
  .gitkeep                      # created by upstream init to track the empty dir
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT
