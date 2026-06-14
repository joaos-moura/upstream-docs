# upstream 0.3.0 Publish-Ready Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the one failing test and add all missing publish-quality artifacts so `upstream` is ready for `npm publish` as v0.3.0.

**Architecture:** Six independent file-level changes with no cross-dependencies — each task is self-contained. No new runtime logic; all changes are metadata, config, docs, and a test regex fix.

**Tech Stack:** Node.js 18+, Vitest, GitHub Actions, npm

---

## File Map

| Action | File |
|--------|------|
| Modify | `tests/integration/auth.test.js` — fix regex on line 54 |
| Modify | `package.json` — add metadata fields, bump to 0.3.0 |
| Create | `.github/workflows/ci.yml` — test matrix on push/PR |
| Create | `.github/workflows/publish.yml` — npm publish on tag |
| Create | `CHANGELOG.md` — back-filled 0.1.0 → 0.3.0 |
| Modify | `README.md` — add 3 badges after title |

---

## Task 1: Fix failing test regex

**Files:**
- Modify: `tests/integration/auth.test.js:54`

- [ ] **Step 1: Run the test to confirm the failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A 10 "confluence credentials"
```

Expected output includes:
```
AssertionError: expected 'upstream auth: UPSTREAM_CONFLUENCE_CL…' to match /client_id|credentials|configure/i
```

- [ ] **Step 2: Fix the regex**

In `tests/integration/auth.test.js`, line 54, replace:

```js
    expect(output).toMatch(/client_id|credentials|configure/i)
```

with:

```js
    expect(output).toMatch(/UPSTREAM_CONFLUENCE_CLIENT_SECRET/i)
```

- [ ] **Step 3: Verify all tests pass**

```bash
npm test
```

Expected:
```
Test Files  14 passed (14)
     Tests  80 passed (80)
```

---

## Task 2: Update package.json metadata + version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace the package.json content**

Replace the entire `package.json` with:

```json
{
  "name": "upstream",
  "version": "0.3.0",
  "description": "Claude Code plugin: enforce PRD/ADR before feature development",
  "author": "João S. Moura",
  "license": "MIT",
  "keywords": ["claude-code", "plugin", "prd", "adr", "documentation", "workflow"],
  "repository": {
    "type": "git",
    "url": "https://github.com/joaos-moura/upstream"
  },
  "bugs": {
    "url": "https://github.com/joaos-moura/upstream/issues"
  },
  "homepage": "https://github.com/joaos-moura/upstream#readme",
  "type": "module",
  "bin": {
    "upstream": "./bin/upstream.js"
  },
  "files": [
    "bin",
    "src",
    "templates"
  ],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:hook": "npx bats tests/hook/"
  },
  "dependencies": {
    "@inquirer/prompts": "^8.5.2",
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

- [ ] **Step 2: Verify npm sees the new metadata**

```bash
npm pack --dry-run 2>&1 | grep -E "name:|version:"
```

Expected:
```
npm notice name:          upstream
npm notice version:       0.3.0
```

---

## Task 3: Create CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Test (Node ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test
```

- [ ] **Step 3: Validate YAML syntax**

```bash
node -e "
const fs = require('fs');
const yaml = require('js-yaml');
yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
console.log('YAML valid');
"
```

Expected: `YAML valid`

---

## Task 4: Create publish workflow

**Files:**
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Write `.github/workflows/publish.yml`**

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Publish to npm
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Validate YAML syntax**

```bash
node -e "
const fs = require('fs');
const yaml = require('js-yaml');
yaml.load(fs.readFileSync('.github/workflows/publish.yml', 'utf8'));
console.log('YAML valid');
"
```

Expected: `YAML valid`

---

## Task 5: Write CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-06-14

### Fixed
- Test regex for Confluence missing credentials error now matches actual error message

### Added
- GitHub Actions CI workflow (Node.js 18, 20, 22 matrix)
- GitHub Actions publish workflow (triggers on `v*` tags, publishes to npm)
- `CHANGELOG.md`
- README badges: npm version, CI status, license
- `package.json` metadata: author, license, keywords, repository, bugs, homepage

## [0.2.0] - 2026-06-12

### Added
- Confluence OAuth 2.0 (PKCE) provider with `upstream auth confluence`
- MCP server (`upstream mcp`) with `create_document` and `validate_link` tools
- Provider registry — centralises Google Docs and Confluence definitions
- Session-based hook cache (PPID-based) — upstream check fires at most once per Claude Code session
- `upstream init --from <answers.json>` and `--from --yes` non-interactive flags
- Wizard `docs_path` prompt — configurable instead of hardcoded `docs/upstream/`
- `.env.example` scaffolded with secret placeholders during `upstream init`
- CODEOWNERS guardian — platform engineer designated during init, protects `upstream.config.yaml`
- `link_policy` in `upstream.config.yaml` — restrict allowed providers, require validation
- Fixed-port OAuth callback (27182) for Confluence
- SSRF guard and exact hostname match in Confluence provider

### Changed
- Confluence API migrated from v1 to v2
- `upstream-guard` skill now chunks Notion content to respect 2 000-char API limit

### Removed
- Notion provider removed pending PKCE support

## [0.1.0] - 2026-06-11

### Added
- `upstream init` — interactive wizard scaffolds `upstream.config.yaml`, `.claude/` hooks and skills, and `.gitignore` updates
- `upstream auth google-docs` — Google Docs OAuth 2.0 (PKCE) provider
- `upstream auth status` — shows authentication state for all providers
- `upstream logout <provider>` — removes stored token
- `upstream upgrade` — regenerates skills and hook, preserving config and docs
- `upstream-guard` skill — classifies work, checks for PRD and ADR, releases to development
- `upstream-prd` skill — PRD creation via interview, import, git-context draft, or external link
- `upstream-adr` skill — ADR creation via interview, import, or external link
- PRD and ADR templates (local and link variants)
- Skip flow — justification logged to `SKIPS.md`, PR snippet generated
- MCP server registration in `.claude/settings.json`
```

- [ ] **Step 2: Verify file exists and looks right**

```bash
head -5 CHANGELOG.md
```

Expected:
```
# Changelog

All notable changes to this project will be documented in this file.
```

---

## Task 6: Add README badges

**Files:**
- Modify: `README.md:1-3`

- [ ] **Step 1: Add badges after the title line**

In `README.md`, replace:

```markdown
# upstream

> A Claude Code plugin that enforces PRD and ADR documentation before feature development begins.
```

with:

```markdown
# upstream

[![npm version](https://img.shields.io/npm/v/upstream.svg)](https://www.npmjs.com/package/upstream)
[![CI](https://github.com/joaos-moura/upstream/actions/workflows/ci.yml/badge.svg)](https://github.com/joaos-moura/upstream/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> A Claude Code plugin that enforces PRD and ADR documentation before feature development begins.
```

- [ ] **Step 2: Verify the first 8 lines**

```bash
head -8 README.md
```

Expected:
```
# upstream

[![npm version](https://img.shields.io/npm/v/upstream.svg)](https://www.npmjs.com/package/upstream)
[![CI](https://github.com/joaos-moura/upstream/actions/workflows/ci.yml/badge.svg)](https://github.com/joaos-moura/upstream/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> A Claude Code plugin that enforces PRD and ADR documentation before feature development begins.
```

---

## Task 7: Final check + commit

- [ ] **Step 1: Run full test suite one last time**

```bash
npm test
```

Expected:
```
Test Files  14 passed (14)
     Tests  80 passed (80)
```

- [ ] **Step 2: Verify pack output**

```bash
npm pack --dry-run 2>&1 | grep -E "name:|version:|total files"
```

Expected:
```
npm notice name:          upstream
npm notice version:       0.3.0
npm notice total files:   27
```

- [ ] **Step 3: Commit everything**

```bash
git add tests/integration/auth.test.js package.json .github/workflows/ci.yml .github/workflows/publish.yml CHANGELOG.md README.md
git commit -m "chore: prepare 0.3.0 for publish

- Fix Confluence missing-credentials test regex
- Add package.json metadata (author, license, keywords, repository, bugs, homepage)
- Bump version to 0.3.0
- Add GitHub Actions CI workflow (Node 18/20/22 matrix)
- Add GitHub Actions publish workflow (tag v* → npm publish)
- Add CHANGELOG.md (back-filled 0.1.0–0.3.0)
- Add README badges (npm version, CI, license)"
```
