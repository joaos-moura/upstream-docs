#!/usr/bin/env bash

set -euo pipefail

CONFIG="upstream.config.yaml"

# Not an upstream-enabled repo — exit silently
[[ -f "$CONFIG" ]] || exit 0

# Not in a git repo or on a detached HEAD — exit silently
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
[[ -z "$BRANCH" || "$BRANCH" == "HEAD" ]] && exit 0

# --- Parse bypass_for from config (pure bash, no external deps) ---
BYPASS="no"
in_bypass=0
while IFS= read -r line; do
  if [[ "$line" =~ ^bypass_for: ]]; then
    in_bypass=1
    continue
  fi
  if [[ $in_bypass -eq 1 ]]; then
    if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+(.*) ]]; then
      pattern="${BASH_REMATCH[1]}"
      pattern="${pattern//\'/}"
      pattern="${pattern//\"/}"
      if [[ "$BRANCH" == "${pattern}"* ]]; then
        BYPASS="yes"
        break
      fi
    elif [[ "$line" =~ ^[^[:space:]] ]]; then
      in_bypass=0
    fi
  fi
done < "$CONFIG"

[[ "$BYPASS" == "yes" ]] && exit 0

# --- Get docs_path from config ---
DOCS_PATH=$(grep -E '^docs_path:' "$CONFIG" | head -1 | sed 's/docs_path:[[:space:]]*//' | tr -d "'\"")
DOCS_PATH="${DOCS_PATH:-docs/upstream}"
DOCS_PATH="${DOCS_PATH%/}"  # strip trailing slash

# --- Derive slug from branch name ---
SLUG=$(echo "$BRANCH" | sed 's|.*/||' | tr '[:upper:]' '[:lower:]' | tr '_' '-')

# --- Check for existing PRD ---
PRD_FOUND=0

# Match by filename slug
while IFS= read -r prd_file; do
  fname=$(basename "$prd_file" .md)
  if [[ "$fname" == *"$SLUG"* ]]; then
    PRD_FOUND=1
    break
  fi
done < <(ls "$DOCS_PATH"/PRD-*.md 2>/dev/null || true)

# Match by content if filename check failed
if [[ $PRD_FOUND -eq 0 ]]; then
  while IFS= read -r prd_file; do
    if grep -qiF "$SLUG" "$prd_file" 2>/dev/null || grep -qiF "$BRANCH" "$prd_file" 2>/dev/null; then
      PRD_FOUND=1
      break
    fi
  done < <(ls "$DOCS_PATH"/PRD-*.md 2>/dev/null || true)
fi

CACHE_FILE="/tmp/upstream-checked-${PPID}-${SLUG}"

# Already ran this session — exit silently regardless of PRD state
[[ -f "$CACHE_FILE" ]] && exit 0

# Clean up cache files older than 1 day
_now=$(date +%s)
for _f in /tmp/upstream-checked-*; do
  [[ -f "$_f" ]] || continue
  _mtime=$(stat -f %m "$_f" 2>/dev/null || stat -c %Y "$_f" 2>/dev/null || echo 0)
  (( _now - _mtime > 86400 )) && rm -f "$_f" 2>/dev/null || true
done

touch "$CACHE_FILE"

[[ $PRD_FOUND -eq 1 ]] && exit 0

echo "UPSTREAM: feature detected without PRD. Invoke upstream-guard before continuing."
