import { readFileSync, existsSync } from 'fs'
import { formatSummary } from '../lib/report.js'

const DEFAULT_PATH = 'upstream-report.json'

export function reportCommand(subcommand, opts = {}) {
  if (subcommand !== 'summary') {
    console.error(`upstream report: unknown subcommand '${subcommand}'. Try 'summary'.`)
    process.exit(1)
  }

  const inputPath = opts.input ?? DEFAULT_PATH

  if (!existsSync(inputPath)) {
    console.error(`upstream report: file not found — run 'upstream validate --report' first`)
    process.exit(1)
  }

  let report
  try {
    report = JSON.parse(readFileSync(inputPath, 'utf8'))
  } catch {
    console.error('upstream report: invalid report file')
    process.exit(1)
  }

  console.log(formatSummary(report))
}
