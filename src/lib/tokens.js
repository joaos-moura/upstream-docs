import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

function tokensPath() {
  return process.env.UPSTREAM_TOKENS_PATH || join(homedir(), '.upstream', 'tokens.json')
}

export function readTokens() {
  try {
    return JSON.parse(readFileSync(tokensPath(), 'utf8'))
  } catch {
    return {}
  }
}

export function writeTokens(tokens) {
  const p = tokensPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(tokens, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
}

export function getProviderToken(provider) {
  return readTokens()[provider] ?? null
}

export function setProviderToken(provider, tokenData) {
  const tokens = readTokens()
  tokens[provider] = tokenData
  writeTokens(tokens)
}

export function deleteProviderToken(provider) {
  const tokens = readTokens()
  delete tokens[provider]
  writeTokens(tokens)
}
