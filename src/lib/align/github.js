const STATUS_ICON = { pass: '✅', warning: '⚠️', fail: '❌' }
const VERDICT_LABEL = { aligned: '✅ ALIGNED', warning: '⚠️ WARNING', misaligned: '❌ MISALIGNED' }

export function formatComment(result) {
  const lines = ['## upstream alignment check', '']

  lines.push(`**PRD:** ${result.prdPath}`)
  if (result.adrPath) lines.push(`**ADR:** ${result.adrPath}`)
  lines.push('')

  lines.push('| Check | Status | Detail |')
  lines.push('|-------|--------|--------|')
  for (const f of result.findings) {
    const icon = STATUS_ICON[f.status] ?? '—'
    lines.push(`| ${f.dimension.replace(/_/g, ' ')} | ${icon} | ${f.detail ?? ''} |`)
  }

  lines.push('')
  lines.push(`**Verdict: ${VERDICT_LABEL[result.verdict] ?? result.verdict}**`)

  if (result.summary) {
    lines.push('')
    lines.push(`> ${result.summary}`)
  }

  if (result.engine === 'heuristic') {
    lines.push('')
    lines.push('> _Analysis via heuristic fallback (claude not available in this runner). Run `upstream validate` locally for full LLM analysis._')
  }

  lines.push('')
  lines.push('<details><summary>How to resolve misalignments</summary>')
  lines.push('')
  lines.push('Update the PRD/ADR to reflect the new decisions, or adjust the implementation to match the documented plan. Run `upstream validate` locally for details.')
  lines.push('')
  lines.push('</details>')

  return lines.join('\n')
}

export async function postPrComment(result, env) {
  const { GITHUB_TOKEN, GITHUB_PR_NUMBER, GITHUB_REPOSITORY } = env
  if (!GITHUB_TOKEN || !GITHUB_PR_NUMBER || !GITHUB_REPOSITORY) return

  const parts = GITHUB_REPOSITORY.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return
  const [owner, repo] = parts
  const body = formatComment(result)

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${GITHUB_PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub API error ${response.status}: ${text}`)
  }
}
