# upstream 0.3.0 — Publish-Ready Polish Design

**Date:** 2026-06-14  
**Scope:** Pre-publish quality baseline (Approach B)  
**Target version:** 0.3.0

---

## 1. Fix failing test

**File:** `tests/integration/auth.test.js:54`

**Problem:** Regex `/client_id|credentials|configure/i` no longer matches the actual error message emitted when `UPSTREAM_CONFLUENCE_CLIENT_SECRET` env var is missing. The real message says "UPSTREAM_CONFLUENCE_CLIENT_SECRET env var is not set."

**Fix:** Update regex to `/UPSTREAM_CONFLUENCE_CLIENT_SECRET/i` — matches the exact env var name that appears in the error output.

---

## 2. package.json metadata

Add missing npm registry fields so the package page is useful:

```json
"version": "0.3.0",
"author": "João S. Moura",
"license": "MIT",
"keywords": ["claude-code", "plugin", "prd", "adr", "documentation", "workflow"],
"repository": { "type": "git", "url": "https://github.com/joaos-moura/upstream" },
"bugs": { "url": "https://github.com/joaos-moura/upstream/issues" },
"homepage": "https://github.com/joaos-moura/upstream#readme"
```

---

## 3. CI/CD — GitHub Actions

### `.github/workflows/ci.yml`

Triggers: push and pull_request to `main`.  
Matrix: Node.js 18, 20, 22.  
Steps: checkout → `npm ci` → `npm test`.

### `.github/workflows/publish.yml`

Triggers: push of tags matching `v*`.  
Steps: checkout → `npm ci` → `npm test` → `npm publish`.  
Requires `NPM_TOKEN` repository secret.

---

## 4. CHANGELOG.md

Format: [Keep a Changelog](https://keepachangelog.com) + [SemVer](https://semver.org).

Three versions back-filled from git log:

- **0.3.0** (2026-06-14) — publish-ready polish: test fix, metadata, CI/CD, changelog, badges
- **0.2.0** — Confluence OAuth (PKCE), MCP server, provider registry, session-based hook cache, wizard `--from`/`--yes` flags, CODEOWNERS guardian, `.env.example` scaffolding
- **0.1.0** — initial release: `upstream init`, `upstream auth google-docs`, Google Docs provider, PRD/ADR scaffold, `upstream-guard` skill

---

## 5. README badges

Three badges added below the `# upstream` title line:

```markdown
[![npm version](https://img.shields.io/npm/v/upstream.svg)](https://www.npmjs.com/package/upstream)
[![CI](https://github.com/joaos-moura/upstream/actions/workflows/ci.yml/badge.svg)](https://github.com/joaos-moura/upstream/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
```

---

## Execution order

1. Fix test regex
2. Update `package.json` (metadata + version)
3. Create `.github/workflows/ci.yml`
4. Create `.github/workflows/publish.yml`
5. Write `CHANGELOG.md`
6. Add badges to `README.md`
7. Commit all as single `chore: prepare 0.3.0 for publish`

---

## Out of scope

- `SECURITY.md`, issue/PR templates, social card — deferred to 1.0.0
- Notion integration — tracked in `docs/backlog/`
- `npm audit` in CI — add when there are actual dependency vulnerabilities to track
