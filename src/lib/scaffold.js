import { copyFile, mkdir, writeFile, appendFile, access, chmod } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import yaml from 'js-yaml'

const HOOK_SRC = 'hooks/upstream-check.sh'

const FILE_MAP = [
  [HOOK_SRC,                     '.claude/hooks/upstream-check.sh'],
  ['skills/upstream-guard.md',   '.claude/plugins/upstream/skills/upstream-guard.md'],
  ['skills/upstream-prd.md',     '.claude/plugins/upstream/skills/upstream-prd.md'],
  ['skills/upstream-adr.md',     '.claude/plugins/upstream/skills/upstream-adr.md'],
  ['templates/PRD.md',           '.claude/plugins/upstream/templates/PRD.md'],
  ['templates/ADR.md',           '.claude/plugins/upstream/templates/ADR.md'],
]

export const GENERATED_FILES = FILE_MAP.map(([, dest]) => dest)

async function fileExists(p) {
  try { await access(p); return true } catch { return false }
}

const PROVIDER_CONFIG_KEY = { 'google-docs': 'google_docs', 'confluence': 'confluence' }

export function generateConfig(answers) {
  const config = {
    version: 1,
    bypass_for: answers.bypass_for,
    prd_required_fields: answers.prd_required_fields,
    adr_triggers: answers.adr_triggers,
    docs_path: answers.docs_path ?? 'docs/upstream/',
    docs_storage: answers.docs_storage,
  }
  if (answers.providers?.length) {
    config.integrations = {}
    for (const p of answers.providers) {
      const key = PROVIDER_CONFIG_KEY[p.id] ?? p.id.replace(/-/g, '_')
      config.integrations[key] = { client_id: p.client_id, allowed_domain: p.allowed_domain }
    }
  }
  return yaml.dump(config, { lineWidth: -1 })
}

export async function writeCodeowners(targetDir, guardian) {
  if (!guardian) return
  const dir = join(targetDir, '.github')
  await mkdir(dir, { recursive: true })
  const codeownersPath = join(dir, 'CODEOWNERS')
  const entry = `upstream.config.yaml ${guardian}\n`
  if (await fileExists(codeownersPath)) {
    const existing = readFileSync(codeownersPath, 'utf8')
    if (existing.includes('upstream.config.yaml')) return
    await appendFile(codeownersPath, `\n# upstream config — changes require guardian approval\n${entry}`)
  } else {
    await writeFile(codeownersPath, `# upstream config — changes require guardian approval\n${entry}`)
  }
}

export async function scaffoldInto(targetDir, templatesDir, answers = null) {
  for (const [src, dest] of FILE_MAP) {
    const srcPath = join(templatesDir, src)
    const destPath = join(targetDir, dest)
    await mkdir(dirname(destPath), { recursive: true })
    await copyFile(srcPath, destPath)
  }

  // Make hook executable
  const hookDest = FILE_MAP.find(([src]) => src === HOOK_SRC)[1]
  await chmod(join(targetDir, hookDest), 0o755)

  const configDest = join(targetDir, 'upstream.config.yaml')
  if (!await fileExists(configDest)) {
    if (answers) {
      await writeFile(configDest, generateConfig(answers))
    } else {
      await copyFile(join(templatesDir, 'upstream.config.yaml'), configDest)
    }
  } else if (answers?.providers?.length) {
    const raw = yaml.load(readFileSync(configDest, 'utf8')) ?? {}
    raw.integrations = raw.integrations ?? {}
    for (const p of answers.providers) {
      const key = PROVIDER_CONFIG_KEY[p.id] ?? p.id.replace(/-/g, '_')
      raw.integrations[key] = { client_id: p.client_id, allowed_domain: p.allowed_domain }
    }
    await writeFile(configDest, yaml.dump(raw, { lineWidth: -1 }))
  }

  if (answers?.guardian) {
    await writeCodeowners(targetDir, answers.guardian)
  }

  // Ensure docs dir exists
  const docsPath = answers?.docs_path ?? 'docs/upstream/'
  const docsDir = join(targetDir, docsPath)
  await mkdir(docsDir, { recursive: true })
  const gitkeep = join(docsDir, '.gitkeep')
  if (!await fileExists(gitkeep)) {
    await writeFile(gitkeep, '')
  }
}
