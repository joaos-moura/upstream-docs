import { describe, it, expect } from 'vitest'
import { buildAnalysisPrompt, parseAnalysisResponse } from '../../src/lib/align/prompt.js'

describe('buildAnalysisPrompt', () => {
  it('includes PRD content', () => {
    const prompt = buildAnalysisPrompt('PRD content here', null, 'diff content')
    expect(prompt).toContain('PRD content here')
  })

  it('includes ADR section when present', () => {
    const prompt = buildAnalysisPrompt('PRD', 'ADR content', 'diff')
    expect(prompt).toContain('ADR content')
  })

  it('truncates diff over 50k chars', () => {
    const bigDiff = 'x'.repeat(60000)
    const prompt = buildAnalysisPrompt('PRD', null, bigDiff)
    expect(prompt).not.toContain(bigDiff)
    expect(prompt).toContain('[diff truncated')
  })

  it('asks for JSON output', () => {
    const prompt = buildAnalysisPrompt('PRD', null, 'diff')
    expect(prompt).toContain('JSON')
  })
})

describe('parseAnalysisResponse', () => {
  it('parses valid JSON response', () => {
    const json = JSON.stringify({
      findings: [{ dimension: 'problem_statement', status: 'pass', detail: null }],
      verdict: 'aligned',
      summary: 'All good.',
    })
    const result = parseAnalysisResponse(json)
    expect(result.verdict).toBe('aligned')
    expect(result.findings).toHaveLength(1)
  })

  it('extracts JSON from markdown code block', () => {
    const response = '```json\n{"findings":[],"verdict":"aligned","summary":"ok"}\n```'
    const result = parseAnalysisResponse(response)
    expect(result.verdict).toBe('aligned')
  })

  it('returns null for invalid JSON', () => {
    expect(parseAnalysisResponse('not json at all')).toBeNull()
  })
})
