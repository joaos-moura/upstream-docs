const MAX_DIFF_CHARS = 50_000

export function buildAnalysisPrompt(prdContent, adrContent, diff) {
  const truncatedDiff = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + `\n\n[diff truncated — ${diff.length} total chars, showing first ${MAX_DIFF_CHARS}]`
    : diff

  const adrSection = adrContent
    ? `## Architecture Decision Record\n\n${adrContent}`
    : '## Architecture Decision Record\n\nNone provided.'

  return `You are an alignment checker. Compare the git diff (implementation) against the PRD and ADR.

## Product Requirements Document

${prdContent}

${adrSection}

## Git Diff (feature branch vs base)

\`\`\`diff
${truncatedDiff}
\`\`\`

Analyze alignment across these dimensions:
- problem_statement: Does the diff address the problem described in the PRD?
- success_metrics: Are the PRD success metrics addressed by the implementation?
- out_of_scope: Does the diff touch areas explicitly marked out of scope in the PRD?
- adr_decisions: Does the implementation follow the decisions recorded in the ADR?
- new_dependencies: Are new dependencies in the diff documented in the ADR?

Output ONLY valid JSON with no other text:
{
  "findings": [
    { "dimension": "problem_statement", "status": "pass|warning|fail", "detail": "explanation or null" }
  ],
  "verdict": "aligned|warning|misaligned",
  "summary": "one sentence summary"}`
}

export function parseAnalysisResponse(text) {
  try {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const raw = codeBlock ? codeBlock[1].trim() : text.trim()
    const parsed = JSON.parse(raw)
    if (!parsed.findings || !parsed.verdict) return null
    return parsed
  } catch {
    return null
  }
}
