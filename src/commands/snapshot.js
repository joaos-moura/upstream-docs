// src/commands/snapshot.js
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import { getCurrentStats } from './stats.js'
import { saveSnapshot, loadLatest, compareForCI } from '../lib/snapshots.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function snapshotCommand(opts = {}, cwd = process.cwd()) {
  const result = getCurrentStats(cwd)
  if (result.error) {
    console.error(chalk.red(`upstream snapshot: ${result.error}`))
    process.exit(1)
  }

  const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'))

  let prev = null
  if (opts.ci) {
    prev = loadLatest(cwd)
  }

  const filePath = saveSnapshot(cwd, result.stats, version)
  const relPath = filePath.replace(cwd + '/', '').replace(cwd + '\\', '')
  console.log(`Snapshot saved to ${relPath}`)

  if (opts.ci) {
    if (!prev) {
      return
    }
    const { regressed, details } = compareForCI(prev, result.stats)
    if (regressed) {
      console.error(chalk.red('Coverage regression detected:'))
      for (const d of details) console.error(chalk.red(`  ${d}`))
      process.exit(1)
    }
    console.log('No coverage regression detected.')
  }
}
