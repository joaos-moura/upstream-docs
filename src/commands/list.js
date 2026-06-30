// src/commands/list.js
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getFeatureBranches, buildBranchEntry } from '../lib/branch-stats.js'

function renderTable(entries, unlinked) {
  const COL = { branch: 24, prd: 30, adr: 30 }

  console.log(chalk.bold('\nActive branches'))

  if (entries.length === 0) {
    console.log('  (no feature branches found)')
  } else {
    const hdr = `  ${'branch'.padEnd(COL.branch)} ${'PRD'.padEnd(COL.prd)} ${'ADR'.padEnd(COL.adr)}`
    console.log(chalk.dim(hdr))

    for (const e of entries) {
      const prdCol = e.prd
        ? chalk.green('✅ ') + e.prd
        : chalk.red('✗  missing')

      let adrCol
      if (e.adr) {
        adrCol = chalk.green('✅ ') + e.adr
      } else if (e.adrRequired) {
        adrCol = chalk.yellow('⚠  required, missing')
      } else {
        adrCol = chalk.dim('—')
      }

      console.log(`  ${e.branch.padEnd(COL.branch)} ${prdCol.padEnd(COL.prd + 10)} ${adrCol}`)
    }
  }

  if (unlinked.length > 0) {
    console.log(chalk.bold('\nUnlinked documents'))
    for (const f of unlinked) {
      console.log(`  ${f}  ${chalk.dim('(no active branch match)')}`)
    }
  }

  console.log('')
}

export function listCommand(opts = {}, cwd = process.cwd()) {
  const configPath = join(cwd, 'upstream.config.yaml')
  if (!existsSync(configPath)) {
    console.error(chalk.red('upstream list: no upstream.config.yaml found'))
    process.exit(1)
  }

  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  let featureBranches
  try {
    featureBranches = getFeatureBranches(cwd, config)
  } catch {
    console.error(chalk.red('upstream list: not a git repository'))
    process.exit(1)
  }

  const entries = featureBranches.map(b =>
    buildBranchEntry(b, docsPath, config.docs_path, config.adr_triggers ?? [])
  )

  const allMatched = new Set(entries.flatMap(e => e._matched))

  let allDocs = []
  if (existsSync(docsPath)) {
    allDocs = readdirSync(docsPath).filter(f => f.endsWith('.md') && f !== 'SKIPS.md')
  }
  const unlinked = allDocs
    .filter(f => !allMatched.has(f))
    .map(f => join(config.docs_path, f))

  const cleanEntries = entries.map(({ _matched, ...rest }) => rest)

  if (opts.format === 'json') {
    console.log(JSON.stringify({ branches: cleanEntries, unlinked }, null, 2))
    return
  }

  renderTable(cleanEntries, unlinked)
}
