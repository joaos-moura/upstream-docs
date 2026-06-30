// src/commands/stats.js
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getFeatureBranches, buildBranchEntry, parseSkips, computeStats } from '../lib/branch-stats.js'
import { loadLatest } from '../lib/snapshots.js'

function pct(n, total) {
  return total === 0 ? '—' : `${Math.round((n / total) * 100)}%`
}

function trendArrow(curr, prev) {
  if (curr > prev) return '↑'
  if (curr < prev) return '↓'
  return '—'
}

function fmtDiffPct(diff) {
  if (diff === 0) return 'no change'
  return (diff > 0 ? '+' : '') + diff + '%'
}

function fmtDiffCount(diff) {
  if (diff === 0) return 'no change'
  return (diff > 0 ? '+' : '') + diff
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

function renderTrend(current, snapshot) {
  const prev = snapshot.stats
  const date = snapshot.saved_at.slice(0, 10)
  const t = current.branches.total

  const currPrdPct = t === 0 ? 0 : Math.round((current.branches.withPrd / t) * 100)
  const prevPrdPct = prev.branches.total === 0 ? 0 : Math.round((prev.branches.withPrd / prev.branches.total) * 100)
  const diffPrd = currPrdPct - prevPrdPct

  console.log(chalk.bold(`\nupstream coverage trend  (vs ${date})`))
  console.log('=========================================')
  console.log(`Branches tracked: ${String(t).padStart(4)}`)
  console.log(`PRD coverage:    ${String(currPrdPct + '%').padStart(4)}  ${trendArrow(currPrdPct, prevPrdPct)} from ${prevPrdPct}%  (${fmtDiffPct(diffPrd)})`)

  if (current.adrCompliance.rate !== null || prev.adrCompliance.rate !== null) {
    const currAdr = current.adrCompliance.rate !== null ? Math.round(current.adrCompliance.rate * 100) : 0
    const prevAdr = prev.adrCompliance.rate !== null ? Math.round(prev.adrCompliance.rate * 100) : 0
    const diffAdr = currAdr - prevAdr
    console.log(`ADR compliance:  ${String(currAdr + '%').padStart(4)}  ${trendArrow(currAdr, prevAdr)} from ${prevAdr}%  (${fmtDiffPct(diffAdr)})`)
  }

  const diffSkipped = current.branches.skipped - prev.branches.skipped
  console.log(`Skipped:         ${String(current.branches.skipped).padStart(4)}  ${trendArrow(current.branches.skipped, prev.branches.skipped)} from ${prev.branches.skipped}  (${fmtDiffCount(diffSkipped)})`)

  const diffUnlinked = current.unlinkedDocs - prev.unlinkedDocs
  console.log(`Unlinked docs:   ${String(current.unlinkedDocs).padStart(4)}  ${trendArrow(current.unlinkedDocs, prev.unlinkedDocs)} from ${prev.unlinkedDocs}  (${fmtDiffCount(diffUnlinked)})`)

  console.log('')
}

export function getCurrentStats(cwd) {
  const configPath = join(cwd, 'upstream.config.yaml')
  if (!existsSync(configPath)) return { error: 'no upstream.config.yaml found' }

  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  let featureBranches
  try {
    featureBranches = getFeatureBranches(cwd, config)
  } catch {
    return { error: 'not a git repository' }
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

  return { stats: computeStats(entries, skipEntries, allDocs, allMatched) }
}

export function statsCommand(opts = {}, cwd = process.cwd()) {
  const result = getCurrentStats(cwd)
  if (result.error) {
    console.error(chalk.red(`upstream stats: ${result.error}`))
    process.exit(1)
  }

  const { stats } = result

  if (opts.trend) {
    const snapshot = loadLatest(cwd)
    if (!snapshot) {
      console.error(chalk.red("upstream stats: no snapshots found, run 'upstream snapshot' first"))
      process.exit(1)
    }
    renderTrend(stats, snapshot)
    return
  }

  if (opts.format === 'json') {
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  renderStats(stats)
}
