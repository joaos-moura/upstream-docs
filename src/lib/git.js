import { execSync, execFileSync } from 'child_process'

const SAFE_BRANCH_RE = /^[\w./\-]+$/

export function resolveBaseBranch(configBase) {
  if (configBase && configBase !== 'auto') return configBase
  try {
    return execSync('git symbolic-ref refs/remotes/origin/HEAD', { encoding: 'utf8', stdio: 'pipe' })
      .trim()
      .replace('refs/remotes/origin/', '')
  } catch {
    return 'main'
  }
}

export function getCurrentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim()
}

export function getDiff(baseBranch, maxBytes = 10 * 1024 * 1024) {
  if (!SAFE_BRANCH_RE.test(baseBranch)) return ''
  try {
    return execFileSync('git', ['diff', `${baseBranch}...HEAD`], {
      encoding: 'utf8',
      maxBuffer: maxBytes,
    })
  } catch {
    return ''
  }
}
