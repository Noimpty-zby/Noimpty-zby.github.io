import test from 'node:test'
import assert from 'node:assert/strict'
import { CFG, getTrafficUmami, getTrafficGoatCounter, getOwnerHeartbeat } from '../../daily-report/sources.mjs'

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

/* 按地址路径回放一串响应：`{ '/stats/total': [404, 404, { total: 5 }] }`，
 * 数字是错误状态码，对象是 200 的 JSON；用完了就重复最后一个。 */
const scripted = async (fn, script) => {
  const original = globalThis.fetch, config = { ...CFG }, calls = {}
  Object.assign(CFG, { gcCode: 'fixture', gcToken: 'fixture', gcRetryMs: [0, 0] })
  globalThis.fetch = async (url, init) => {
    assert.equal(init.redirect, 'error')
    const path = new URL(url).pathname.replace('/api/v0', '')
    const seen = calls[path] = (calls[path] || 0) + 1
    const steps = script[path] || [{}]
    const step = steps[Math.min(seen, steps.length) - 1]
    return typeof step === 'number' ? Response.json({ error: 'not found' }, { status: step }) : Response.json(step)
  }
  try { return { result: await fn(), calls } } finally { globalThis.fetch = original; Object.assign(CFG, config) }
}

test('GoatCounter intermittent 404 is retried before the report gives up', async () => {
  const { result, calls } = await scripted(getTrafficGoatCounter, { '/stats/total': [404, 404, { total: 5 }] })
  assert.equal(result.ok, true)
  assert.equal(result.pageviews, 5)
  assert.equal(calls['/stats/total'] >= 3, true)
})

test('a persistent GoatCounter 404 is reported as an upstream read failure, not a config problem', async () => {
  const { result, calls } = await scripted(getTrafficGoatCounter, { '/stats/total': [404] })
  assert.equal(result.ok, false)
  assert.match(result.why, /连续 3 次返回 404/)
  assert.match(result.why, /GoatCounter 那边的读取故障/)
  assert.equal(calls['/stats/total'] >= 3, true)
})

test('GoatCounter 401 is a configuration error and is not retried', async () => {
  const { result, calls } = await scripted(getTrafficGoatCounter, { '/stats/total': [401] })
  assert.equal(result.ok, false)
  assert.match(result.why, /^401 /)
  assert.equal(calls['/stats/total'], 2, 'range total and all-time total are one call each, no retries')
})

test('the owner heartbeat shares the GoatCounter retry', async () => {
  const { result, calls } = await scripted(getOwnerHeartbeat, {
    '/stats/hits': [503, { hits: [{ path: '/owner-heartbeat', count: 3, stats: [{ day: '2026-09-28', daily: 2 }] }] }]
  })
  assert.equal(result.ok, true)
  assert.equal(result.lastSeen, '2026-09-28')
  assert.equal(calls['/stats/hits'], 2)
})
