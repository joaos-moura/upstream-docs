import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

function pct(withCount, total) {
  return total === 0 ? 0 : Math.round((withCount / total) * 100)
}

export function saveSnapshot(cwd, stats, version) {
  const dir = join(cwd, '.upstream', 'snapshots')
  mkdirSync(dir, { recursive: true })

  const gitignorePath = join(dir, '.gitignore')
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*\n!.gitignore\n')
  }

  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const filePath = join(dir, `${date}.json`)
  writeFileSync(filePath, JSON.stringify({ upstream_version: version, saved_at: now.toISOString(), stats }, null, 2))
  return filePath
}

export function loadLatest(cwd) {
  const dir = join(cwd, '.upstream', 'snapshots')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
  if (files.length === 0) return null
  try {
    return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'))
  } catch {
    return null
  }
}

export function compareForCI(prev, curr) {
  const details = []

  const prevPrd = pct(prev.stats.branches.withPrd, prev.stats.branches.total)
  const currPrd = pct(curr.branches.withPrd, curr.branches.total)
  if (currPrd < prevPrd) {
    details.push(`PRD coverage: ${currPrd}%  ↓ from ${prevPrd}%  (${currPrd - prevPrd}%)`)
  }

  if (prev.stats.adrCompliance.rate !== null) {
    const prevAdr = Math.round(prev.stats.adrCompliance.rate * 100)
    const currAdr = curr.adrCompliance.rate !== null ? Math.round(curr.adrCompliance.rate * 100) : 0
    if (currAdr < prevAdr) {
      details.push(`ADR compliance: ${currAdr}%  ↓ from ${prevAdr}%  (${currAdr - prevAdr}%)`)
    }
  }

  return { regressed: details.length > 0, details }
}
