import { execFileSync } from 'child_process'

export function getAuthorMap(cwd, branches, since) {
  const branchSet = new Set(branches)
  const authorMap = new Map()

  const args = ['log', '--all', '--format=%an|%D']
  if (since) args.push('--since', since)

  let out
  try {
    out = execFileSync('git', args, { encoding: 'utf8', cwd, stdio: 'pipe' })
  } catch {
    return authorMap
  }

  for (const line of out.trim().split('\n')) {
    if (!line.trim()) continue
    const pipeIdx = line.indexOf('|')
    if (pipeIdx === -1) continue
    const author = line.slice(0, pipeIdx)
    const refs = line.slice(pipeIdx + 1)
    if (!refs.trim()) continue
    for (const ref of refs.split(',').map(r => r.trim())) {
      const clean = ref.replace(/^HEAD -> /, '')
      if (branchSet.has(clean) && !authorMap.has(clean)) {
        authorMap.set(clean, author)
      }
    }
  }

  return authorMap
}

export function computeAdoption(entries, skipEntries, authorMap, since) {
  const sinceDate = since ? new Date(since) : null

  const filteredSkips = sinceDate
    ? skipEntries.filter(s => new Date(s.date) >= sinceDate)
    : skipEntries

  const activeEntries = entries.filter(e => authorMap.has(e.branch))

  const authors = new Map()

  for (const entry of activeEntries) {
    const author = authorMap.get(entry.branch)
    if (!authors.has(author)) authors.set(author, { branches: 0, withPrd: 0, withAdr: 0, skips: 0 })
    const a = authors.get(author)
    a.branches++
    if (entry.prd) a.withPrd++
    if (entry.adr) a.withAdr++
  }

  for (const skip of filteredSkips) {
    const author = authorMap.get(skip.branch) ?? 'unknown'
    if (!authors.has(author)) authors.set(author, { branches: 0, withPrd: 0, withAdr: 0, skips: 0 })
    authors.get(author).skips++
  }

  const totalBranches = activeEntries.length
  const totalWithPrd = activeEntries.filter(e => e.prd).length
  const adoptionScore = totalBranches > 0 ? Math.round((totalWithPrd / totalBranches) * 100) : 0

  return {
    authors: [...authors.entries()].map(([name, stats]) => ({ name, ...stats })),
    skips: filteredSkips.map(s => ({ ...s, author: authorMap.get(s.branch) ?? 'unknown' })),
    adoptionScore,
    since: since ?? null,
  }
}
