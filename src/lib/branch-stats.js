// src/lib/branch-stats.js
import { join } from 'path'
import { execFileSync } from 'child_process'
import { getSlug, scanDocs, classifyFile, adrRequired } from './docs.js'

export function getFeatureBranches(cwd, config) {
  const out = execFileSync('git', ['branch', '--format=%(refname:short)'], {
    encoding: 'utf8',
    cwd,
    stdio: 'pipe',
  })
  const branches = out.trim().split('\n').filter(Boolean)
  return branches.filter(b =>
    b !== 'HEAD' && !config.bypass_for.some(prefix => b.startsWith(prefix))
  )
}

export function buildBranchEntry(branch, docsPath, configDocsPath, adrTriggers) {
  const slug = getSlug(branch)
  let matched = []
  try { matched = scanDocs(docsPath, branch, slug) } catch { /* docs_path may not exist */ }

  let prdFile = null
  let adrFile = null
  for (const f of matched) {
    const type = classifyFile(join(docsPath, f))
    if (type === 'prd' && !prdFile) prdFile = f
    if (type === 'adr' && !adrFile) adrFile = f
  }

  const prdPath = prdFile ? join(configDocsPath, prdFile) : null
  const adrPath = adrFile ? join(configDocsPath, adrFile) : null
  const required = prdFile ? adrRequired(join(docsPath, prdFile), adrTriggers) : false

  return { branch, prd: prdPath, adr: adrPath, adrRequired: required, _matched: matched }
}

export function parseSkips(content) {
  const entries = []
  const blocks = content.split(/^(?=## Skip:)/m).filter(Boolean)
  for (const block of blocks) {
    const headerMatch = block.match(/^## Skip:\s*(PRD|ADR)\s*—\s*(.+?)\s*—\s*(\d{4}-\d{2}-\d{2})/i)
    if (!headerMatch) continue
    const reasonMatch = block.match(/\*\*Reason:\*\*\s*(.+)/)
    entries.push({
      type: headerMatch[1].toLowerCase(),
      branch: headerMatch[2].trim(),
      date: headerMatch[3],
      reason: reasonMatch ? reasonMatch[1].trim() : '',
    })
  }
  return entries
}

export function computeStats(entries, skipEntries, allDocs, allMatched) {
  const total = entries.length
  const skippedBranches = new Set(skipEntries.map(s => s.branch))

  let withPrd = 0
  let withAdr = 0
  let adrRequiredCount = 0
  let adrPresentCount = 0

  for (const e of entries) {
    if (e.prd) withPrd++
    if (e.adr) withAdr++
    if (e.adrRequired) {
      adrRequiredCount++
      if (e.adr) adrPresentCount++
    }
  }

  const skipped = skippedBranches.size
  const skippedPrd = skipEntries.filter(e => e.type === 'prd').length
  const skippedAdr = skipEntries.filter(e => e.type === 'adr').length
  const noDocs = entries.filter(e => !e.prd && !e.adr && !skippedBranches.has(e.branch)).length
  const unlinkedDocs = allDocs.filter(f => !allMatched.has(f)).length

  return {
    branches: { total, withPrd, withAdr, skipped, skippedPrd, skippedAdr, noDocs },
    adrCompliance: {
      required: adrRequiredCount,
      present: adrPresentCount,
      rate: adrRequiredCount > 0 ? adrPresentCount / adrRequiredCount : null,
    },
    unlinkedDocs,
  }
}
