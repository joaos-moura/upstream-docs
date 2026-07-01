# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `upstream stats --adoption` — team adoption analytics: per-author PRD/ADR coverage, skip log with author attribution, and an overall adoption score; scoped to a configurable lookback window via `--since <date>` (default: 90 days); `--no-authors` suppresses the per-author table; `--format json` emits the raw `{ authors, skips, adoptionScore, since }` object for CI/dashboards; all data derived from local git history and `SKIPS.md` — no network calls
- `upstream validate --report [path]` — writes a structured JSON artifact to disk after alignment check (default filename: `upstream-report.json`); shape includes `branch`, `verdict`, `engine`, `coverage`, `findings`, `snapshot`, and `trend` fields
- `upstream report summary [--input <path>]` — reads the report artifact and prints a Markdown summary to stdout; suitable for piping to `$GITHUB_STEP_SUMMARY` in GitHub Actions
- Automatic trend computation in reports — when a snapshot exists (from `upstream snapshot`), the report includes PRD coverage and ADR compliance deltas vs the previous snapshot
- Updated `upstream-align.yml` workflow template to upload the report as a build artifact and write a job summary via `$GITHUB_STEP_SUMMARY`

## [0.3.1] - 2026-06-23

### Fixed
- `upstream validate` now fetches full document content when `docs_storage: link` — previously used stub content for both heuristic and LLM analysis, resulting in low-quality alignment checks; now fetches via Google Docs or Confluence provider and falls back to stub with a warning if unauthenticated or provider unavailable

## [0.3.0] - 2026-06-23

### Added
- `upstream validate` — CLI command that checks whether the current branch's diff is aligned with its PRD/ADR; runs LLM analysis via `claude -p` with heuristic fallback; exits 1 when `on_violation: block` and verdict is `misaligned`
- `upstream validate --format json` — machine-readable output with `{ engine, verdict, findings, prdPath, adrPath }` shape
- `upstream validate --base <branch>` — override the base branch used for diff
- Heuristic alignment engine — detects out-of-scope changes, dependency additions, config drift, and test coverage gaps without requiring Claude CLI
- LLM analysis prompt builder and response parser (`src/lib/align/prompt.js`)
- GitHub PR comment posting — posts alignment verdict as a PR comment when `GITHUB_TOKEN` and `GITHUB_REPOSITORY` are set (`src/lib/align/github.js`)
- `upstream-align` Claude Code skill — guides the alignment check workflow within Claude sessions
- `upstream-align.yml` GitHub Actions workflow template — scaffolded by `upstream init` to run `upstream validate` on PRs
- Alignment check prompts added to `upstream init` wizard (`align.base_branch`, `align.on_violation`, `align.post_pr_comment`)
- `align` defaults added to `upstream.config.yaml` schema

## [0.2.0] - 2026-06-23

### Added
- `upstream list` — shows PRD/ADR coverage for all local feature branches in a table, with a second section for unlinked documents (docs in `docs_path` with no active branch match)
- `upstream list --format json` — machine-readable output with `{ branches, unlinked }` shape, suitable for CI scripts and tooling
- ADR requirement detection in `upstream list` — branches whose PRD contains any `adr_triggers` keyword show `⚠ required, missing` when no ADR is present, instead of `—`
- `src/lib/docs.js` — shared library with `getSlug`, `scanDocs`, `classifyFile`, `adrRequired` helpers, reused by both `upstream status` and `upstream list`

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
