import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import chalk from 'chalk'

const MCP_ENTRY = { command: 'npx', args: ['upstream', 'mcp'] }

export function writeMcpSettings(targetDir) {
  const settingsPath = join(targetDir, '.claude', 'settings.json')
  mkdirSync(dirname(settingsPath), { recursive: true })

  let settings = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    } catch {
      console.warn(chalk.yellow('warning: .claude/settings.json is not valid JSON — MCP entry will be added'))
      settings = {}
    }
  }

  const existing = settings?.mcpServers?.upstream
  if (existing &&
      (existing.command !== MCP_ENTRY.command ||
       JSON.stringify(existing.args) !== JSON.stringify(MCP_ENTRY.args))) {
    console.warn(chalk.yellow('warning: overwriting existing mcpServers.upstream in .claude/settings.json'))
  }

  settings.mcpServers = { ...settings.mcpServers, upstream: MCP_ENTRY }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}
