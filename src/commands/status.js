import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getSlug, scanDocs, classifyFile } from '../lib/docs.js'

function getCurrentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim()
}

export function statusCommand(cwd = process.cwd()) {
  let branch
  try {
    branch = getCurrentBranch()
  } catch {
    console.error(chalk.red('upstream status: not a git repository'))
    process.exit(1)
  }

  if (branch === 'HEAD') {
    console.error(chalk.red('upstream status: repository is in detached HEAD state — check out a branch first'))
    process.exit(1)
  }

  const configPath = join(cwd, 'upstream.config.yaml')
  if (!existsSync(configPath)) {
    console.error(chalk.red(`upstream status: no upstream.config.yaml found in ${cwd}`))
    process.exit(1)
  }

  let config
  try {
    config = readConfig(configPath)
  } catch (err) {
    console.error(chalk.red(`upstream status: invalid upstream.config.yaml — ${err.message}`))
    process.exit(1)
  }
  const docsPath = join(cwd, config.docs_path)

  console.log(chalk.bold('upstream status\n'))
  console.log(`Branch:  ${branch}`)

  const bypassPrefix = config.bypass_for.find(p => branch.startsWith(p))
  if (bypassPrefix) {
    console.log(`Type:    bypass — upstream skipped for ${bypassPrefix} branches`)
    return
  }

  console.log('Type:    feature\n')

  if (!existsSync(docsPath)) {
    console.error(chalk.red(`upstream status: docs path not found: ${config.docs_path}`))
    process.exit(1)
  }

  const slug = getSlug(branch)
  let matched
  try {
    matched = scanDocs(docsPath, branch, slug)
  } catch (err) {
    console.error(chalk.red(`upstream status: cannot read docs directory — ${err.message}`))
    process.exit(1)
  }

  let prdFile = null
  let adrFile = null
  for (const f of matched) {
    const type = classifyFile(join(docsPath, f))
    if (type === 'prd' && !prdFile) prdFile = f
    if (type === 'adr' && !adrFile) adrFile = f
  }

  if (prdFile) {
    console.log(`PRD  ${chalk.green('✅')}  ${join(config.docs_path, prdFile)}`)
  } else {
    console.log(`PRD  ${chalk.red('❌')}  not found in ${config.docs_path}`)
  }

  if (!prdFile) {
    console.log('ADR  —   (check PRD first)')
    process.exit(1)
  } else if (adrFile) {
    console.log(`ADR  ${chalk.green('✅')}  ${join(config.docs_path, adrFile)}`)
  } else {
    console.log(`ADR  ${chalk.yellow('—')}   none in ${config.docs_path}`)
  }
}
