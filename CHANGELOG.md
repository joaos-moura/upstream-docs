# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-14

### Added
- `upstream init` — interactive wizard scaffolds `upstream.config.yaml`, `.claude/` hooks and skills, and `.gitignore` updates
- `upstream init --from <answers.json>` and `--yes` non-interactive flags
- Wizard `docs_path` prompt — configurable instead of hardcoded `docs/upstream/`
- `.env.example` scaffolded with secret placeholders during `upstream init`
- CODEOWNERS guardian — platform engineer designated during init, protects `upstream.config.yaml`
- `upstream auth google-docs` — Google Docs OAuth 2.0 (PKCE) provider
- `upstream auth confluence` — Confluence OAuth 2.0 (PKCE) provider
- `upstream auth status` — shows authentication state for all providers
- `upstream logout <provider>` — removes stored token
- `upstream upgrade` — regenerates skills and hook, preserving config and docs
- `upstream doctor` — checks upstream installation health (config, hook, MCP registration, skills, templates, auth) with pass/warn/fail per item
- `upstream doctor --fix` — repairs missing or misconfigured files automatically by re-running scaffold and MCP settings
- `upstream status` — shows PRD/ADR state for the current git branch (found/missing, file paths, bypass detection)
- `upstream-guard` skill — classifies work, checks for PRD and ADR, releases to development
- `upstream-prd` skill — PRD creation via interview, import, git-context draft, or external link
- `upstream-adr` skill — ADR creation via interview, import, or external link
- PRD and ADR templates (local and link variants)
- Skip flow — justification logged to `SKIPS.md`, PR snippet generated
- MCP server (`upstream mcp`) with `create_document` and `validate_link` tools
- MCP server registration in `.claude/settings.json`
- Provider registry — centralises Google Docs and Confluence definitions
- Session-based hook cache (PPID-based) — upstream check fires at most once per Claude Code session
- `link_policy` in `upstream.config.yaml` — restrict allowed providers, require validation
- Fixed-port OAuth callback (27182) for Confluence
- SSRF guard and exact hostname match in Confluence provider
- GitHub Actions CI workflow (Node.js 20, 22 matrix)
- GitHub Actions publish workflow (triggers on `v*` tags, publishes to npm)
- README badges: npm version, CI status, license
- `package.json` metadata: author, license, keywords, repository, bugs, homepage
