#!/usr/bin/env node
for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(f) } catch { /* file doesn't exist or can't be read */ }
}
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Command } from 'commander'
import { initCommand } from '../src/commands/init.js'
import { upgradeCommand } from '../src/commands/upgrade.js'
import { authCommand, authLogoutCommand } from '../src/commands/auth.js'
import { doctorCommand } from '../src/commands/doctor.js'
import { statusCommand } from '../src/commands/status.js'
import { listCommand } from '../src/commands/list.js'
import { validateCommand } from '../src/commands/validate.js'
import { statsCommand } from '../src/commands/stats.js'
import { snapshotCommand } from '../src/commands/snapshot.js'
import { reportCommand } from '../src/commands/report.js'
import { startMcpServer } from '../src/lib/mcp/server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

const program = new Command()

program
  .name('upstream')
  .description('Claude Code plugin: enforce PRD/ADR before feature development')
  .version(version)

program
  .command('init')
  .description('Scaffold upstream into the current repo')
  .option('--from <file>', 'load answers from JSON file (non-interactive)')
  .option('--docs-storage <value>', 'docs_storage: local or link')
  .option('--provider <id>', 'provider ID: google-docs or confluence (single provider)')
  .option('--client-id <id>', 'OAuth client_id for the provider')
  .option('--allowed-domain <domain>', 'allowed domain for the provider')
  .option('--guardian <handle>', 'GitHub handle or email for CODEOWNERS')
  .option('--yes', 'skip Phase 2 (use org defaults)')
  .action(initCommand)

program
  .command('upgrade')
  .description('Regenerate skills and hook, preserve config and docs')
  .action(upgradeCommand)

program
  .command('auth <provider>')
  .description('Authenticate with a documentation provider (google-docs) or check status (status)')
  .action(authCommand)

program
  .command('logout <provider>')
  .description('Remove stored token for a provider (or "all")')
  .action(authLogoutCommand)

program
  .command('doctor')
  .description('Check upstream installation health in the current repo')
  .option('--fix', 'repair missing or misconfigured files automatically')
  .action((opts) => doctorCommand(opts))

program
  .command('status')
  .description('Show PRD/ADR state for the current git branch')
  .action(() => statusCommand())

program
  .command('list')
  .description('Show PRD/ADR coverage for all feature branches')
  .option('--format <fmt>', 'output format: table or json', 'table')
  .action((opts) => listCommand(opts))

program
  .command('validate')
  .description('Check alignment between implementation and PRD/ADR')
  .option('--output <format>', 'output format: human or json', 'human')
  .option('--base <branch>', 'base branch for diff (overrides config)')
  .action((opts) => validateCommand({ outputFormat: opts.output, base: opts.base ?? null }))

program
  .command('stats')
  .description('Show PRD/ADR coverage summary across all feature branches')
  .option('--format <fmt>', 'output format: table or json', 'table')
  .option('--trend', 'compare current stats against the latest snapshot')
  .action((opts) => statsCommand(opts))

program
  .command('snapshot')
  .description('Save current PRD/ADR coverage stats as a local snapshot')
  .option('--ci', 'exit non-zero if coverage regressed since last snapshot')
  .action((opts) => snapshotCommand(opts))

program
  .command('report <subcommand>')
  .description('Generate reports from upstream artifacts (subcommands: summary)')
  .option('--input <path>', 'report file to read (default: upstream-report.json)')
  .action((sub, opts) => reportCommand(sub, opts))

program
  .command('mcp')
  .description('Start the upstream MCP server (called automatically by Claude Code)')
  .action(startMcpServer)

program.parse()
