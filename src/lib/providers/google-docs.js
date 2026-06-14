// src/lib/providers/google-docs.js
import https from 'https'
import { randomBytes } from 'crypto'
import { setProviderToken } from '../tokens.js'

export function extractId(url) {
  const match = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

export function exchangeCode(code, clientId, redirectUri, codeVerifier) {
  const clientSecret = process.env.UPSTREAM_GOOGLE_CLIENT_SECRET
  if (!clientSecret) throw new Error('UPSTREAM_GOOGLE_CLIENT_SECRET env var is not set')
  const params = { code, client_id: clientId, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier, client_secret: clientSecret }
  const body = new URLSearchParams(params).toString()

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Token exchange: invalid JSON response')) }
        } else reject(new Error(`Token exchange failed (${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

export async function getIdentity(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo?fields=email',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed) resolve(parsed)
        else {
          const msg = parsed?.error?.message || `Failed to get Google identity (${res.statusCode})`
          reject(new Error(msg))
        }
      })
    })
    req.on('error', reject)
  })
}

export function validateDomain(identity, config) {
  if (!config.allowed_domain) return false
  return identity.email?.endsWith(`@${config.allowed_domain}`) ?? false
}

export async function getMetadata(docId, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${docId}?fields=name,modifiedTime`,
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed) {
          resolve({ title: parsed.name ?? null, last_edited: parsed.modifiedTime ?? null })
        } else {
          const msg = parsed?.error?.message || `Drive API error ${res.statusCode}`
          const err = new Error(msg)
          err.status = res.statusCode
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

export async function refreshTokenIfNeeded(tokenData, appConfig) {
  if (!tokenData.expiry || tokenData.expiry - Date.now() > 5 * 60 * 1000) return tokenData

  const clientSecret = process.env.UPSTREAM_GOOGLE_CLIENT_SECRET
  if (!clientSecret) throw new Error('UPSTREAM_GOOGLE_CLIENT_SECRET env var is not set')
  const body = new URLSearchParams({ refresh_token: tokenData.refresh_token, client_id: appConfig.client_id, client_secret: clientSecret, grant_type: 'refresh_token' }).toString()

  const newTokenData = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Token refresh: invalid JSON response')) }
        } else reject(new Error(`Token refresh failed (${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })

  const updated = {
    ...tokenData,
    access_token: newTokenData.access_token,
    expiry: newTokenData.expires_in != null ? Date.now() + newTokenData.expires_in * 1000 : tokenData.expiry,
  }
  setProviderToken('google-docs', updated)
  return updated
}

export async function createDocument(title, content, destination, tokenData) {
  const boundary = `upstream_boundary_${randomBytes(16).toString('hex')}`
  const metadata = JSON.stringify({
    name: title,
    mimeType: 'application/vnd.google-apps.document',
    ...(destination ? { parents: [destination] } : {}),
  })
  const multipart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/html',
    '',
    content || '',
    `--${boundary}--`,
  ].join('\r\n')

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/upload/drive/v3/files?uploadType=multipart',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(multipart),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = null }
        if (res.statusCode === 200 && parsed?.id) {
          resolve({ url: `https://docs.google.com/document/d/${parsed.id}/edit` })
        } else {
          const msg = parsed?.error?.message || `Drive API error ${res.statusCode}`
          reject(new Error(msg))
        }
      })
    })
    req.on('error', reject)
    req.write(multipart)
    req.end()
  })
}
