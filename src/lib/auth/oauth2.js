import http from 'http'
import { URL } from 'url'
import { randomBytes, createHash } from 'crypto'
import open from 'open'
import { setProviderToken } from '../tokens.js'

export function generatePKCE() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function bindCallbackServer(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.on('error', reject)
    srv.listen(port ?? 0, () => resolve({ srv, port: srv.address().port }))
  })
}

export function waitForCallback(srv, expectedState) {
  return new Promise((resolve, reject) => {
    let settled = false
    const { port } = srv.address()

    const timer = setTimeout(
      () => { if (!settled) { settled = true; srv.close(); reject(new Error('Authentication timed out after 5 minutes')) } },
      5 * 60 * 1000
    )

    srv.on('request', (req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`)
      const code = u.searchParams.get('code')
      const error = u.searchParams.get('error')
      const state = u.searchParams.get('state')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>upstream: Authentication complete. You can close this tab.</h2></body></html>')

      if (settled) return
      settled = true
      clearTimeout(timer)
      srv.close()

      if (error) reject(new Error(`OAuth cancelled: ${error}`))
      else if (state !== expectedState) reject(new Error('OAuth state mismatch — possible CSRF attempt'))
      else if (code) resolve(code)
      else reject(new Error('No authorization code received'))
    })

    srv.on('error', reject)
  })
}

export async function runOAuthFlow(providerId, providerDef, appConfig) {
  const domainValue = appConfig[providerDef.domainField]
  if (!domainValue) {
    throw new Error(
      `${providerDef.domainField} is not configured in upstream.config.yaml integrations.${providerDef.configKey}`
    )
  }

  const { srv: callbackServer, port } = await bindCallbackServer(providerDef.callbackPort)
  const redirectUri = `http://localhost:${port}/callback`
  const state = randomBytes(16).toString('hex')
  const { verifier, challenge } = generatePKCE()

  const authUrl = new URL(providerDef.authUrl)
  authUrl.searchParams.set('client_id', appConfig.client_id)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  if (providerDef.scopes?.length) authUrl.searchParams.set('scope', providerDef.scopes.join(' '))
  for (const [k, v] of Object.entries(providerDef.authParams ?? {})) authUrl.searchParams.set(k, v)

  console.log(`Opening browser for ${providerId} authentication...`)
  console.log(`If browser doesn't open, visit:\n  ${authUrl.toString()}`)
  try { await open(authUrl.toString()) } catch { /* user has URL in console */ }

  const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let fi = 0
  const spinner = setInterval(() => {
    process.stderr.write(`\r${FRAMES[fi++ % FRAMES.length]} Waiting for browser callback... (Ctrl+C to cancel)`)
  }, 100)

  let code
  try {
    code = await waitForCallback(callbackServer, state)
  } finally {
    clearInterval(spinner)
    process.stderr.write('\r\x1b[K')
  }
  const tokenResponse = await providerDef.exchangeCode(code, appConfig.client_id, redirectUri, verifier)

  const identity = await providerDef.getIdentity(tokenResponse.access_token, tokenResponse)

  if (!providerDef.validateDomain(identity, appConfig)) {
    throw new Error(
      `Your account does not belong to the ${providerDef.domainField} configured for this org (expected: ${domainValue})`
    )
  }

  let tokenData = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token ?? null,
    expiry: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : null,
  }
  if (providerDef.enrichToken) tokenData = providerDef.enrichToken(tokenData, identity, appConfig)

  setProviderToken(providerId, tokenData)
}
