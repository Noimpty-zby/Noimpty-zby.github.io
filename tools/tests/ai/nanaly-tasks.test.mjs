import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const script = readFileSync(new URL('../../../source/js/nanaly-tasks.js', import.meta.url), 'utf8')
const path = '/2026/09/19/test/', id = '12345678-1234-1234-1234-123456789abc', sha = 'a'.repeat(40)
const result = { v: 1, requestId: id, path, sha, at: '2026-09-19T01:00:00Z', state: 'completed', checked: 1, broken: 0, unknown: 0, skipped: 2,
  results: [{ url: 'https://noimpty-zby.github.io/ok', state: 'ok', status: 200 }], scope: '本站检查' }
const run = { id: 42, head_sha: sha, display_title: `Nanaly article check ${id}`, status: 'completed', conclusion: 'success' }
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
class Element {
  constructor() { this.children = []; this.attributes = {}; this.textContent = '' }
  setAttribute(key, value) { this.attributes[key] = value }
  appendChild(child) { this.children.push(child) }
}
const boot = ({ token = 'fixture-token', fetchImpl, links = [], images = [], locked = false, storage = new Map() } = {}) => {
  const calls = [], timers = new Map(), updates = []
  let sequence = 0, now = Date.parse('2026-09-19T01:00:00Z')
  class Clock extends Date { static now() { return now } }
  const window = {
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    NOIMPTY_PRIVACY: { entries: [{ path }] }, NOIMPTY_GATE: { unlocked: () => !locked }, NANALY: { githubToken: () => token },
    setTimeout: (fn, ms) => { const key = ++sequence; timers.set(key, { fn, ms }); return key }, clearTimeout: key => timers.delete(key)
  }
  const document = { createElement: () => new Element() }
  const ctx = vm.createContext({ window, document, location: { origin: 'https://noimpty-zby.github.io', pathname: path },
    URL, AbortController, DOMException, TextDecoder, structuredClone, Date: Clock, crypto: { randomUUID: () => id },
    DOMParser: class { parseFromString() { return { querySelector: () => ({ querySelectorAll: () => [...links.map(href => ({ tagName: 'A', getAttribute: () => href })), ...images.map(attrs => ({ tagName: 'IMG', getAttribute: key => attrs[key] || null }))] }) } } },
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init) }
  })
  vm.runInContext(script, ctx)
  const settle = async promise => {
    let done = false, value, error
    promise.then(out => { done = true; value = out }, out => { done = true; error = out })
    for (let i = 0; i < 200 && !done; i++) {
      await flush()
      if (done) break
      const next = [...timers].sort((a, b) => a[1].ms - b[1].ms)[0]
      if (next) { timers.delete(next[0]); now += next[1].ms; next[1].fn() }
    }
    if (!done) throw new Error('test promise never settled')
    if (error) throw error
    return value
  }
  return { window, storage, api: window.NANALY_TASKS, calls, timers, updates, settle,
    start: options => window.NANALY_TASKS.checkArticle({ path, onUpdate: task => updates.push(task), ...options }) }
}
const remote = overrides => async (url, init) => {
  if (overrides) { const response = await overrides(url, init); if (response) return response }
  if (url.endsWith('/dispatches')) return new Response(null, { status: 204 })
  if (url.includes('/check-runs?')) return Response.json({ check_runs: [{ external_id: id, head_sha: sha, status: 'completed', output: { text: JSON.stringify(result) } }] })
  if (url.includes('/runs?')) return Response.json({ workflow_runs: [run] })
  if (url.endsWith('/actions/runs/42')) return Response.json(run)
  return Response.json({ id: 5 })
}
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }
await check('allowlist/lock validation happens before network and requests require explicit wording', async () => {
  const app = boot({ fetchImpl: () => { throw new Error('unexpected') } })
  for (const path of ['/about/', '//evil.test/x', '/2026/09/19/unknown/', '/2026/09/19/test/?x=1']) await assert.rejects(app.start({ path }))
  assert.equal(app.calls.length, 0)
  assert.equal(app.api.isCheckRequest('检查本文链接'), true)
  assert.equal(app.api.isCheckRequest('不要检查本文链接'), false)
  assert.equal(app.api.isCheckRequest('介绍一下怎么检查本文链接'), false)
  const locked = boot({ locked: true, fetchImpl: () => { throw new Error('unexpected') } })
  await assert.rejects(locked.start(), /解锁/)
})
await check('GitHub dispatch is unique and results are correlated to request ID and commit', async () => {
  const app = boot({ fetchImpl: remote() })
  const task = await app.settle(app.start())
  assert.equal(task.state, 'completed'); assert.equal(task.mode, 'github'); assert.equal(task.result.skipped, 2)
  const writes = app.calls.filter(call => call.init.method === 'POST')
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0].init.body), { ref: 'main', inputs: { request_id: id, article_path: path } })
  assert.ok(app.calls.every(call => call.url.startsWith('https://api.github.com/repos/Noimpty-zby/Noimpty-zby.github.io/')))
  assert.ok(app.calls.every(call => call.init.headers.Authorization === 'Bearer fixture-token' && !call.url.includes('fixture-token')))
  const refreshed = await app.settle(app.api.refreshTask(task.id))
  assert.equal(refreshed.result.at, result.at)
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 1)
  assert.ok(app.api.renderCard(task).children.length >= 3)
})
await check('foreign or stale result metadata cannot be reported as completed', async () => {
  const app = boot({ fetchImpl: remote((url) => url.includes('/check-runs?') ? Response.json({ check_runs: [{ external_id: id, head_sha: sha, status: 'completed', output: { text: JSON.stringify({ ...result, requestId: 'old' }) } }] }) : null) })
  const task = await app.settle(app.start())
  assert.equal(task.state, 'failed'); assert.match(task.message, /不匹配/)
})
await check('missing workflow falls back truthfully and never probes foreign/private addresses', async () => {
  const app = boot({ links: ['/ok', '/bad', 'https://external.test/', 'http://127.0.0.1/'], fetchImpl: async (url, init) => {
    if (url.startsWith('https://api.github.com/')) return new Response(null, { status: 404 })
    if (url.endsWith(path)) return new Response('<div id="article-container"></div>')
    return new Response(null, { status: url.endsWith('/bad') ? 404 : 200 })
  } })
  const task = await app.settle(app.start())
  assert.equal(task.mode, 'browser'); assert.equal(task.result.broken, 1); assert.equal(task.result.skipped, 2)
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 0)
  assert.equal(app.calls.filter(call => call.url.endsWith('/bad')).length, 2)
  assert.ok(app.calls.every(call => !call.url.includes('127.0.0.1') && !call.url.includes('external.test')))
  assert.ok(app.calls.filter(call => !call.url.startsWith('https://api.github.com/')).every(call => !call.init.headers?.Authorization))
})
await check('browser lazy image checks match backend data-src/data-lazy-src/src priority', async () => {
  const app = boot({ token: '', images: [
    { src: 'data:占位', 'data-lazy-src': '/missing.png' },
    { src: '/fallback', 'data-lazy-src': '/second', 'data-src': '/first' }
  ], fetchImpl: async url => url.endsWith(path) ? new Response('<div id="article-container"></div>')
    : new Response(null, { status: url.endsWith('/missing.png') ? 404 : 200 }) })
  const task = await app.settle(app.start())
  assert.equal(task.result.checked, 2); assert.equal(task.result.broken, 1)
  assert.equal(task.result.skipped, 0)
  assert.deepEqual(Array.from(task.result.results, row => row.url), ['https://noimpty-zby.github.io/missing.png', 'https://noimpty-zby.github.io/first'])
  assert.equal(app.calls.filter(call => call.url.endsWith('/missing.png')).length, 2)
  assert.ok(!app.calls.some(call => /\/(?:fallback|second)$/.test(call.url) || call.url.startsWith('data:')))
})
await check('an uncertain POST response is never resent and cancellation never claims to cancel the backend', async () => {
  const app = boot({ fetchImpl: remote(url => { if (url.endsWith('/dispatches')) throw new Error('response lost'); return null }) })
  assert.equal((await app.settle(app.start())).state, 'completed')
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 1)
  const controller = new AbortController()
  const canceled = boot({ fetchImpl: remote() })
  await assert.rejects(canceled.settle(canceled.start({ signal: controller.signal, onUpdate: task => {
    canceled.updates.push(task)
    if (task.state === 'queued') controller.abort()
  } })), error => error.name === 'AbortError')
  assert.equal(canceled.updates.at(-1).state, 'cancelled')
  assert.match(canceled.updates.at(-1).message, /后台已启动.*继续/)
  assert.equal(canceled.calls.filter(call => call.init.method === 'POST').length, 1)
})
await check('rate-limit retry-after is respected and browser timeouts are unknown, not bad links', async () => {
  let reads = 0
  const app = boot({ fetchImpl: remote(url => {
    if (url.includes('/runs?') && reads++ === 0) return new Response(null, { status: 429, headers: { 'retry-after': '30' } })
    return null
  }) })
  const task = await app.settle(app.start())
  assert.equal(task.state, 'completed')
  assert.ok(app.updates.some(row => row.state === 'waiting' && row.message.includes('限流')))
  const local = boot({ token: '', links: ['/network'], fetchImpl: async url => {
    if (url.endsWith(path)) return new Response('<div id="article-container"></div>')
    throw new Error('network failed')
  } })
  const outcome = await local.settle(local.start())
  assert.equal(outcome.result.unknown, 1); assert.equal(outcome.result.broken, 0)
})
await check('a backend query outage preserves uncertainty and can be refreshed without redispatch', async () => {
  const app = boot({ fetchImpl: remote(url => { if (url.includes('/runs?')) throw new Error('offline'); return null }) })
  const task = await app.settle(app.start())
  assert.equal(task.state, 'waiting')
  assert.equal(task.canRefresh, true)
  assert.match(task.message, /后台可能仍在运行/)
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 1)
})
await check('secondary rate limits before dispatch are not mistaken for missing permissions', async () => {
  const app = boot({ fetchImpl: async () => new Response('secondary rate limit', { status: 403, headers: { 'retry-after': '90' } }) })
  const task = await app.settle(app.start())
  assert.equal(task.state, 'failed')
  assert.match(task.message, /未启动后台检查/)
  assert.equal(app.calls.length, 1)
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 0)
})
await check('reload restores scoped metadata without credentials, results, network or redispatch', async () => {
  const storage = new Map(), app = boot({ storage, fetchImpl: remote() })
  const task = await app.settle(app.start({ sessionId: 'chat-a' }))
  assert.equal(task.expectedSHA, sha)
  const raw = storage.get('nanaly.article-tasks.v1')
  assert.ok(!raw.includes('fixture-token') && !raw.includes('/ok') && !raw.includes('本站检查'))
  const saved = JSON.parse(raw).tasks[0]
  assert.equal(saved.sessionId, 'chat-a'); assert.equal(saved.runId, 42)
  const loaded = boot({ storage, fetchImpl: remote() })
  assert.equal(loaded.calls.length, 0)
  assert.equal(loaded.api.recover(id, { sessionId: 'chat-b' }), null)
  assert.equal(loaded.api.list({ sessionId: 'chat-b' }).length, 0)
  const recovered = loaded.api.recover(id, { sessionId: 'chat-a' })
  assert.equal(recovered.state, 'waiting'); assert.equal(recovered.canRefresh, true)
  assert.equal(recovered.result, undefined); assert.match(recovered.message, /尚未重新核验/)
  await assert.rejects(loaded.api.refreshTask(id, { sessionId: 'chat-b' }), /当前会话/)
  const refreshed = await loaded.settle(loaded.api.refreshTask(id, { sessionId: 'chat-a' }))
  assert.equal(refreshed.state, 'completed')
  assert.equal(loaded.calls.filter(call => call.init.method === 'POST').length, 0)
})
await check('restored run routing and commit must match the exact original task', async () => {
  const storage = new Map(), app = boot({ storage, fetchImpl: remote() })
  await app.settle(app.start({ sessionId: 'chat-a' }))
  for (const tampered of [{ ...run, head_sha: 'b'.repeat(40) }, { ...run, display_title: 'another task' }]) {
    const loaded = boot({ storage: new Map(storage), fetchImpl: remote(url => url.endsWith('/actions/runs/42') ? Response.json(tampered) : null) })
    const task = await loaded.settle(loaded.api.refreshTask(id))
    assert.equal(task.state, 'failed'); assert.match(task.message, /不匹配/)
    assert.equal(loaded.calls.filter(call => call.url.includes('/check-runs?')).length, 0)
  }
})
await check('task storage is bounded and malformed metadata or disabled storage cannot cause a dispatch', async () => {
  const base = { repo: 'Noimpty-zby/Noimpty-zby.github.io', path, mode: 'github', state: 'running',
    startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', canRefresh: true }
  const records = Array.from({ length: 10 }, (_, i) => ({ ...base, id: `12345678-1234-1234-1234-${String(i).padStart(12, '0')}` }))
  const storage = new Map([['nanaly.article-tasks.v1', JSON.stringify({ v: 1, tasks: records })]])
  const app = boot({ storage, fetchImpl: remote() })
  assert.equal(app.api.list().length, 10); assert.equal(app.calls.length, 0)
  await app.settle(app.start())
  assert.equal(JSON.parse(storage.get('nanaly.article-tasks.v1')).tasks.length, 10)
  assert.ok(JSON.parse(storage.get('nanaly.article-tasks.v1')).tasks.some(task => task.id === id))
  const invalid = boot({ storage: new Map([['nanaly.article-tasks.v1', JSON.stringify({ v: 1, tasks: [
    { ...base, id, path: '//evil.test/' }, { ...base, id, repo: 'other/repo' }, { ...base, id: '<script>' }
  ] })]]), fetchImpl: remote() })
  assert.equal(invalid.api.list().length, 0); assert.equal(invalid.calls.length, 0)
  const blocked = boot({ storage: { get() { throw new Error('blocked') }, set() { throw new Error('full') } }, fetchImpl: remote() })
  assert.equal((await blocked.settle(blocked.start())).state, 'completed')
})
console.log(`\n${passed} browser task cases passed`)
