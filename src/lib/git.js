import { execSync } from 'child_process'

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
  try {
    return execSync(`git diff ${baseBranch}...HEAD`, {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: maxBytes,
    })
  } catch {
    return ''
  }
}
