// src/lib/docs.js
import { readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'

export function getSlug(branch) {
  const idx = branch.indexOf('/')
  return idx === -1 ? branch : branch.slice(idx + 1)
}

export function scanDocs(docsPath, branch, slug) {
  const files = readdirSync(docsPath).filter(f => f.endsWith('.md'))
  return files.filter(f => {
    if (basename(f).toLowerCase().includes(slug.toLowerCase())) return true
    try { return readFileSync(join(docsPath, f), 'utf8').includes(branch) } catch { return false }
  })
}

export function classifyFile(filePath) {
  const name = basename(filePath).toUpperCase()
  if (name.includes('PRD')) return 'prd'
  if (name.includes('ADR')) return 'adr'
  try {
    const first = readFileSync(filePath, 'utf8').split('\n').find(l => l.startsWith('#')) ?? ''
    if (first.toUpperCase().includes('PRD')) return 'prd'
    if (first.toUpperCase().includes('ADR')) return 'adr'
  } catch {}
  return null
}

export function adrRequired(prdFilePath, adrTriggers) {
  try {
    const content = readFileSync(prdFilePath, 'utf8').toLowerCase()
    return adrTriggers.some(t => content.includes(t.toLowerCase().replace(/_/g, ' ')) ||
                                  content.includes(t.toLowerCase()))
  } catch {
    return false
  }
}
