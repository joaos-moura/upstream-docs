// tests/unit/docs.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getSlug, scanDocs, classifyFile, adrRequired } from '../../src/lib/docs.js'

describe('getSlug', () => {
  it('strips prefix from feat/my-feature', () => {
    expect(getSlug('feat/my-feature')).toBe('my-feature')
  })

  it('strips prefix from fix/short', () => {
    expect(getSlug('fix/short')).toBe('short')
  })

  it('returns the whole string when no slash', () => {
    expect(getSlug('main')).toBe('main')
  })

  it('strips only the first prefix segment', () => {
    expect(getSlug('feat/payments/v2')).toBe('payments/v2')
  })
})

describe('classifyFile', () => {
  let dir

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'upstream-docs-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('returns prd for filename containing PRD', () => {
    const f = join(dir, 'PRD-auth.md')
    writeFileSync(f, '# some content')
    expect(classifyFile(f)).toBe('prd')
  })

  it('returns adr for filename containing ADR', () => {
    const f = join(dir, 'ADR-001-db.md')
    writeFileSync(f, '# some content')
    expect(classifyFile(f)).toBe('adr')
  })

  it('falls back to heading when filename is generic', () => {
    const f = join(dir, 'document.md')
    writeFileSync(f, '# PRD: New Feature\n\nsome content')
    expect(classifyFile(f)).toBe('prd')
  })

  it('returns null when neither filename nor heading matches', () => {
    const f = join(dir, 'notes.md')
    writeFileSync(f, '# Meeting notes\n\nsome content')
    expect(classifyFile(f)).toBe(null)
  })
})

describe('scanDocs', () => {
  let dir

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'upstream-docs-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('matches file by slug in filename', () => {
    writeFileSync(join(dir, 'PRD-payments.md'), '# PRD')
    const result = scanDocs(dir, 'feat/payments', 'payments')
    expect(result).toContain('PRD-payments.md')
  })

  it('matches file by branch name in content', () => {
    writeFileSync(join(dir, 'PRD-something.md'), 'Branch: feat/payments\n# PRD')
    const result = scanDocs(dir, 'feat/payments', 'payments')
    expect(result).toContain('PRD-something.md')
  })

  it('does not match unrelated files', () => {
    writeFileSync(join(dir, 'PRD-auth.md'), '# PRD for auth')
    const result = scanDocs(dir, 'feat/payments', 'payments')
    expect(result).not.toContain('PRD-auth.md')
  })

  it('ignores non-md files', () => {
    writeFileSync(join(dir, 'payments.txt'), 'payments')
    const result = scanDocs(dir, 'feat/payments', 'payments')
    expect(result).toHaveLength(0)
  })
})

describe('adrRequired', () => {
  let dir

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'upstream-docs-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const TRIGGERS = ['new_external_dependency', 'database_schema_change', 'api_breaking_change']

  it('returns true when trigger keyword appears in PRD content', () => {
    const f = join(dir, 'PRD-payments.md')
    writeFileSync(f, '# PRD\n\nThis adds a new_external_dependency for Stripe.')
    expect(adrRequired(f, TRIGGERS)).toBe(true)
  })

  it('returns true when trigger appears with spaces instead of underscores', () => {
    const f = join(dir, 'PRD-payments.md')
    writeFileSync(f, '# PRD\n\nThis introduces a database schema change.')
    expect(adrRequired(f, TRIGGERS)).toBe(true)
  })

  it('returns false when no trigger keyword appears', () => {
    const f = join(dir, 'PRD-ui.md')
    writeFileSync(f, '# PRD\n\nThis changes button colours.')
    expect(adrRequired(f, TRIGGERS)).toBe(false)
  })

  it('returns false when file does not exist', () => {
    expect(adrRequired(join(dir, 'missing.md'), TRIGGERS)).toBe(false)
  })
})
