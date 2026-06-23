import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { execSync, execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
export const CLI = join(__dirname, '../bin/upstream.js')

/**
 * Create an isolated temp directory, optionally initialised as a git repo
 * with `upstream init --yes` pre-run.
 *
 * Returns { dir, git, cleanup }.  Always call cleanup() in afterEach.
 */
export function makeTmpRepo({ git = false, init = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'upstream-test-'))

  if (git || init) {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'pipe' })
  }

  if (init) {
    execFileSync(process.execPath, [CLI, 'init', '--yes'], { cwd: dir, stdio: 'pipe' })
  }

  return {
    dir,
    git: (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** Write a minimal upstream.config.yaml into dir */
export function writeMinimalConfig(dir) {
  writeFileSync(join(dir, 'upstream.config.yaml'), 'version: 1\n')
}

/**
 * Run the upstream CLI with the given args array.
 * Returns { stdout, stderr, exitCode } — never throws.
 */
export function runCLI(args, opts = {}) {
  const { cwd, env } = opts
  const argsArray = typeof args === 'string' ? args.split(/\s+/) : args
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...argsArray], {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: 'pipe',
    }).toString()
    return { stdout, stderr: '', exitCode: 0 }
  } catch (err) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      exitCode: err.status ?? 1,
    }
  }
}
