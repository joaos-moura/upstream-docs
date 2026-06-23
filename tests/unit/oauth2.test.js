import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import http from 'http'
import { generatePKCE, waitForCallback } from '../../src/lib/auth/oauth2.js'

describe('generatePKCE', () => {
  it('generates base64url verifier between 43 and 128 chars', () => {
    const { verifier } = generatePKCE()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('generates S256 challenge matching the verifier', () => {
    const { verifier, challenge } = generatePKCE()
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
  })

  it('generates unique verifier each call', () => {
    const a = generatePKCE()
    const b = generatePKCE()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('waitForCallback', () => {
  function makeServer() {
    return new Promise((resolve, reject) => {
      const srv = http.createServer()
      srv.on('error', reject)
      srv.listen(0, () => resolve(srv))
    })
  }

  function sendRequest(port, params) {
    const qs = new URLSearchParams(params).toString()
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/callback?${qs}`, (res) => {
        res.resume()
        res.on('end', resolve)
      }).on('error', reject)
    })
  }

  it('resolves with the authorization code on valid callback', async () => {
    const srv = await makeServer()
    const { port } = srv.address()
    const promise = waitForCallback(srv, 'state-abc')
    await sendRequest(port, { code: 'auth-code-123', state: 'state-abc' })
    await expect(promise).resolves.toBe('auth-code-123')
  })

  it('rejects when OAuth returns an error param', async () => {
    const srv = await makeServer()
    const { port } = srv.address()
    const promise = waitForCallback(srv, 'state-abc')
    // fire request without awaiting first — attach rejection handler before resolving
    const req = sendRequest(port, { error: 'access_denied', state: 'state-abc' })
    await expect(promise).rejects.toThrow(/OAuth cancelled/)
    await req
  })

  it('rejects on state mismatch (CSRF guard)', async () => {
    const srv = await makeServer()
    const { port } = srv.address()
    const promise = waitForCallback(srv, 'expected-state')
    const req = sendRequest(port, { code: 'code', state: 'tampered-state' })
    await expect(promise).rejects.toThrow(/state mismatch/)
    await req
  })

  it('rejects when no code or error in callback', async () => {
    const srv = await makeServer()
    const { port } = srv.address()
    const promise = waitForCallback(srv, 'state-abc')
    const req = sendRequest(port, { state: 'state-abc' })
    await expect(promise).rejects.toThrow(/No authorization code/)
    await req
  })
})
