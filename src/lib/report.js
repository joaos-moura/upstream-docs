import { writeFileSync } from 'fs'
import { loadLatest } from './snapshots.js'
import { getCurrentStats } from '../commands/stats.js'

function pct(withCount, total) {
  return total === 0 ? 0 : Math.round((withCount / total) * 100)
}

export function buildReport(result, { branch, cwd, version }) {
  const now = new Date()

  let vsLast = null
  const prev = loadLatest(cwd)
  if (prev) {
    const currResult = getCurrentStats(cwd)
    if (!currResult.error) {
      const prevStats = prev.stats
      const currStats = currResult.stats
      const prevPrd = pct(prevStats.branches.withPrd, prevStats.branches.total)
      const currPrd = pct(currStats.branches.withPrd, currStats.branches.total)
      const prevAdr = prevStats.adrCompliance.rate !== null ? Math.round(prevStats.adrCompliance.rate * 100) : null
      const currAdr = currStats.adrCompliance.rate !== null ? Math.round(currStats.adrCompliance.rate * 100) : null
      vsLast = {
        prdCoverage: { before: prevPrd, after: currPrd, delta: currPrd - prevPrd },
        adrCompliance: prevAdr !== null && currAdr !== null
          ? { before: prevAdr, after: currAdr, delta: currAdr - prevAdr }
          : null,
      }
    }
  }

  return {
    branch,
    verdict: result.verdict,
    engine: result.engine,
    coverage: {
      prdPath: result.prdPath ?? null,
      adrPath: result.adrPath ?? null,
    },
    findings: result.findings ?? [],
    snapshot: {
      timestamp: now.toISOString(),
      upstream_version: version,
    },
    trend: { vsLast },
  }
}

export function writeReport(filePath, report) {
  writeFileSync(filePath, JSON.stringify(report, null, 2))
}

export function formatSummary(report) {
  const verdictIcon = { aligned: '✅', warning: '⚠️', misaligned: '❌' }
  const statusIcon = { pass: '✅', warning: '⚠️', fail: '❌' }

  const rows = (report.findings ?? []).map(f =>
    `| ${f.dimension.replace(/_/g, ' ')} | ${statusIcon[f.status] ?? f.status} ${f.status} | ${f.detail ?? '—'} |`
  ).join('\n')

  const lines = [
    '## upstream alignment report',
    '',
    `**Branch:** ${report.branch}`,
    `**Verdict:** ${verdictIcon[report.verdict] ?? ''} ${report.verdict}`,
    `**Engine:** ${report.engine}`,
    '',
    '| Dimension | Status | Detail |',
    '|-----------|--------|--------|',
    rows,
  ]

  if (report.trend?.vsLast) {
    const { prdCoverage, adrCompliance } = report.trend.vsLast
    const sign = n => n > 0 ? `+${n}` : `${n}`
    lines.push('', '**Trend vs last snapshot:**')
    lines.push(`- PRD coverage: ${prdCoverage.after}% (${sign(prdCoverage.delta)}%)`)
    if (adrCompliance !== null) {
      lines.push(`- ADR compliance: ${adrCompliance.after}% (${sign(adrCompliance.delta)}%)`)
    }
  }

  return lines.join('\n')
}
