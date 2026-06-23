export function parseOutOfScope(prdContent) {
  const match = prdContent.match(/##\s*out[_\s-]*of[_\s-]*scope\s*\n([\s\S]*?)(?=\n##|$)/i)
  if (!match) return []
  return match[1]
    .split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

export function checkScopeCreep(outOfScopeItems, diffPaths) {
  const findings = []
  for (const item of outOfScopeItems) {
    const keywords = item.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    for (const path of diffPaths) {
      if (keywords.some(kw => path.toLowerCase().includes(kw))) {
        findings.push({ path, outOfScopeItem: item })
      }
    }
  }
  return findings
}

export function parseNewDeps(packageJsonDiff) {
  const pkgSection = packageJsonDiff.match(/diff --git a\/package\.json[\s\S]*?(?=diff --git|$)/)?.[0] ?? ''
  return pkgSection
    .split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1).match(/"([^"@][^"]+)":\s*"[^"]*"/)?.[1])
    .filter(Boolean)
}

export function checkNewDepsInAdr(newDeps, adrContent) {
  return newDeps.filter(dep => !adrContent.toLowerCase().includes(dep.toLowerCase()))
}

export function runHeuristics(prdContent, adrContent, diff) {
  const diffPaths = diff
    .split('\n')
    .filter(l => l.startsWith('diff --git'))
    .map(l => l.match(/b\/(.*)/)?.[1] ?? '')
    .filter(Boolean)

  const outOfScopeItems = parseOutOfScope(prdContent)
  const scopeCreepFindings = checkScopeCreep(outOfScopeItems, diffPaths)

  const newDeps = parseNewDeps(diff)
  const undocumentedDeps = adrContent ? checkNewDepsInAdr(newDeps, adrContent) : []

  const findings = []

  if (outOfScopeItems.length > 0) {
    findings.push({
      dimension: 'out_of_scope',
      status: scopeCreepFindings.length > 0 ? 'warning' : 'pass',
      detail: scopeCreepFindings.length > 0
        ? scopeCreepFindings.map(f => `\`${f.path}\` matches "${f.outOfScopeItem}"`).join('; ')
        : null,
    })
  }

  if (newDeps.length > 0) {
    findings.push({
      dimension: 'new_dependencies',
      status: undocumentedDeps.length > 0 ? 'fail' : 'pass',
      detail: undocumentedDeps.length > 0
        ? `New deps not in ADR: ${undocumentedDeps.join(', ')}`
        : null,
    })
  }

  const verdict = findings.some(f => f.status === 'fail')
    ? 'misaligned'
    : findings.some(f => f.status === 'warning')
      ? 'warning'
      : 'aligned'

  return { engine: 'heuristic', findings, verdict }
}
