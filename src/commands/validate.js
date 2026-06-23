import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import chalk from 'chalk'
import { readConfig } from '../lib/config.js'
import { getSlug, scanDocs, classifyFile } from '../lib/docs.js'
import { getCurrentBranch, resolveBaseBranch, getDiff } from '../lib/git.js'
import { runHeuristics } from '../lib/align/heuristics.js'
import { buildAnalysisPrompt, parseAnalysisResponse } from '../lib/align/prompt.js'
import { formatComment, postPrComment } from '../lib/align/github.js'

function tryClaudeAnalysis(prdContent, adrContent, diff) {
  const prompt = buildAnalysisPrompt(prdContent, adrContent, diff)
  const result = spawnSync('claude', ['-p', prompt], {
    encoding: 'utf8',
    timeout: 90_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0) return null
  return parseAnalysisResponse(result.stdout ?? '')
}

export async function validateCommand({ outputFormat = 'human', base = null } = {}, cwd = process.cwd()) {
  let branch
  try {
    branch = getCurrentBranch()
  } catch {
    console.error(chalk.red('upstream validate: not a git repository'))
    process.exit(1)
  }

  const configPath = join(cwd, 'upstream.config.yaml')
  const config = readConfig(configPath)
  const docsPath = join(cwd, config.docs_path)

  if (!existsSync(docsPath)) {
    const skipped = { skipped: true, reason: 'docs path not found' }
    if (outputFormat === 'json') console.log(JSON.stringify(skipped, null, 2))
    else console.log(chalk.yellow('upstream validate: docs path not found — skipping alignment check'))
    return skipped
  }

  const slug = getSlug(branch)
  const matched = scanDocs(docsPath, branch, slug)

  let prdFile = null
  let adrFile = null
  for (const f of matched) {
    const type = classifyFile(join(docsPath, f))
    if (type === 'prd' && !prdFile) prdFile = f
    if (type === 'adr' && !adrFile) adrFile = f
  }

  if (!prdFile) {
    const skipped = { skipped: true, reason: 'no PRD found for this branch' }
    if (outputFormat === 'json') console.log(JSON.stringify(skipped, null, 2))
    else console.log(chalk.yellow('upstream validate: no PRD found — skipping alignment check'))
    return skipped
  }

  const prdContent = readFileSync(join(docsPath, prdFile), 'utf8')
  const adrContent = adrFile ? readFileSync(join(docsPath, adrFile), 'utf8') : null

  const baseBranch = base ?? resolveBaseBranch(config.align?.base_branch)
  const diff = getDiff(baseBranch)

  let analysisResult = tryClaudeAnalysis(prdContent, adrContent ?? '', diff)
  if (!analysisResult) {
    analysisResult = runHeuristics(prdContent, adrContent ?? '', diff)
  } else {
    analysisResult.engine = 'llm'
  }

  const result = {
    ...analysisResult,
    prdPath: join(config.docs_path, prdFile),
    adrPath: adrFile ? join(config.docs_path, adrFile) : null,
  }

  if (outputFormat === 'json') {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(chalk.bold('\nupstream alignment check\n'))
    console.log(`Branch:  ${branch}`)
    console.log(`PRD:     ${result.prdPath}`)
    if (result.adrPath) console.log(`ADR:     ${result.adrPath}`)
    console.log(`Engine:  ${result.engine}\n`)
    for (const f of result.findings) {
      const icon = f.status === 'pass' ? chalk.green('✅') : f.status === 'warning' ? chalk.yellow('⚠️') : chalk.red('❌')
      console.log(`${icon}  ${f.dimension.replace(/_/g, ' ')}${f.detail ? ` — ${f.detail}` : ''}`)
    }
    console.log()
    const verdictColor = result.verdict === 'aligned' ? chalk.green : result.verdict === 'warning' ? chalk.yellow : chalk.red
    console.log(verdictColor(`Verdict: ${result.verdict.toUpperCase()}`))
    if (result.summary) console.log(`\n${result.summary}`)
  }

  if (config.align?.post_pr_comment !== false) {
    try {
      await postPrComment(result, process.env)
    } catch {
      // Non-fatal — comment posting failure should not block validate
    }
  }

  const shouldBlock = config.align?.on_violation === 'block' && result.verdict === 'misaligned'
  if (shouldBlock) process.exit(1)

  return result
}
