import test from 'node:test'
import assert from 'node:assert/strict'
import { CFG, getTrafficUmami, getTrafficGoatCounter } from '../../daily-report/sources.mjs'

const sample = async (fn, body) => {
  const original = globalThis.fetch, config = { ...CFG }
  Object.assign(CFG, { umamiKey: 'fixture', umamiSite: 'fixture', gcCode: 'fixture', gcToken: 'fixture' })
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.redirect, 'error', 'authenticated API redirects must not forward a custom API key')
    return Response.json(body)
  }
  try { return await fn() } finally { globalThis.fetch = original; Object.assign(CFG, config) }
}

test('traffic providers refuse redirects and malformed success bodies do not become zero traffic', async () => {
  for (const fn of [getTrafficUmami, getTrafficGoatCounter]) {
    for (const value of [undefined, null, '', ' ', false, 'NaN', -1, { value: [] }, { value: {} }]) {
      const result = await sample(fn, { pageviews: value, total: value })
      assert.equal(result.ok, false, JSON.stringify({ value, result }))
    }
    const result = await sample(fn, { pageviews: 0, total: 0 })
    assert.equal(result.ok, true)
    assert.equal(result.pageviews, 0)
  }
})

test('Umami value-wrapped counters remain supported', async () => {
  const result = await sample(getTrafficUmami, { pageviews: { value: 7 } })
  assert.equal(result.ok, true)
  assert.equal(result.pageviews, 7)
})
