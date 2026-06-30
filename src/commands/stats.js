// src/commands/stats.js
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getFeatureBranches, buildBranchEntry, parseSkips, computeStats } from '../lib/branch-stats.js'

function pct(n, total) {
  return total === 0 ? '—' : `${Math.round((n / total) * 100)}%`
}

function renderStats(stats) {
  const { branches, adrCompliance, unlinkedDocs } = stats
  const t = branches.total

  console.log(chalk.bold('\nupstream coverage report'))
  console.log('========================')
  console.log(`Branches tracked:  ${String(t).padStart(3)}`)
  console.log(`  With PRD:        ${String(branches.withPrd).padStart(3)}  (${pct(branches.withPrd, t)})`)
  console.log(`  With ADR:        ${String(branches.withAdr).padStart(3)}  (${pct(branches.withAdr, t)})`)
  console.log(`  Skipped:         ${String(branches.skipped).padStart(3)}  (${pct(branches.skipped, t)})`)
  console.log(`    PRD skips:     ${String(branches.skippedPrd).padStart(3)}`)
  console.log(`    ADR skips:     ${String(branches.skippedAdr).padStart(3)}`)
  console.log(`  No docs:         ${String(branches.noDocs).padStart(3)}  (${pct(branches.noDocs, t)})`)

  if (adrCompliance.rate !== null) {
    const rateStr = `${Math.round(adrCompliance.rate * 100)}%`
    console.log(`\nADR compliance:    ${rateStr.padStart(4)}  (${adrCompliance.present} of ${adrCompliance.required} PRDs that triggered ADR requirement)`)
  }

  console.log(`\nUnlinked docs:     ${String(unlinkedDocs).padStart(3)}`)
  console.log('')
}

export function statsCommand(opts = {}, cwd = process.cwd()) {
  const configPath = join(cwd, 'upstream.config.yaml')
  if (!existsSync(configPath)) {
    console.error(chalk.red('upstream stats: no upstream.config.yaml found'))
    process.exit(1)
  }

  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  let featureBranches
  try {
    featureBranches = getFeatureBranches(cwd, config)
  } catch {
    console.error(chalk.red('upstream stats: not a git repository'))
    process.exit(1)
  }

  const entries = featureBranches.map(b =>
    buildBranchEntry(b, docsPath, config.docs_path, config.adr_triggers ?? [])
  )

  let skipEntries = []
  const skipsPath = join(docsPath, 'SKIPS.md')
  if (existsSync(skipsPath)) {
    try { skipEntries = parseSkips(readFileSync(skipsPath, 'utf8')) } catch {}
  }

  let allDocs = []
  if (existsSync(docsPath)) {
    allDocs = readdirSync(docsPath).filter(f => f.endsWith('.md') && f !== 'SKIPS.md')
  }
  const allMatched = new Set(entries.flatMap(e => e._matched))

  const stats = computeStats(entries, skipEntries, allDocs, allMatched)

  if (opts.format === 'json') {
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  renderStats(stats)
}
