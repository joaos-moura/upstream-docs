#!/usr/bin/env bats

HOOK="$BATS_TEST_DIRNAME/../../templates/hooks/upstream-check.sh"

setup() {
  TMPDIR="$(mktemp -d)"
  cd "$TMPDIR"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  touch .gitkeep && git add .gitkeep && git commit -q -m "init"
  mkdir -p docs/upstream
}

teardown() {
  rm -rf "$TMPDIR"
}

@test "exits silently when upstream.config.yaml is absent" {
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "exits silently on a bypass branch (fix/)" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for:
  - fix/
  - hotfix/
docs_path: docs/upstream/
EOF
  git checkout -b fix/typo -q
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "exits silently on a bypass branch (hotfix/)" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for:
  - fix/
  - hotfix/
docs_path: docs/upstream/
EOF
  git checkout -b hotfix/crash -q
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "injects UPSTREAM message on feature branch with no PRD" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for:
  - fix/
docs_path: docs/upstream/
EOF
  git checkout -b feat/new-payments -q
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [[ "$output" == *"UPSTREAM:"* ]]
}

@test "exits silently when matching PRD file exists" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for: []
docs_path: docs/upstream/
EOF
  git checkout -b feat/oauth-login -q
  echo "# PRD: OAuth Login" > docs/upstream/PRD-oauth-login.md
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "exits silently when PRD exists for branch with prefix" {
  cat > upstream.config.yaml <<'EOF'
version: 1
bypass_for: []
docs_path: docs/upstream/
EOF
  git checkout -b feature/user-dashboard -q
  echo "# PRD: User Dashboard" > docs/upstream/PRD-user-dashboard.md
  run bash "$HOOK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
