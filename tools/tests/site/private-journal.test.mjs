import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/noimpty-search.js', 'utf8')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const entry = what => ({ at: '2026-09-27 12:00', who: 'reply', what })
const backend = (read = async () => ({ revision: 1, data: { entries: [entry('private')] } })) => {
  let configured = true, requests = 0
  const listeners = new Set(), signals = []
  const api = { configured: () => configured,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    privateContent: (name, opts) => { assert.equal(name, 'journal'); requests++; signals.push(opts.signal); return read() } }
  return { api, signals, requests: () => requests, listeners,
    state: value => { configured = value; for (const fn of listeners) fn({ connected: value, connection: value ? 'connected' : 'disconnected', revision: value ? 1 : null }) } }
}
const boot = (server = backend()) => {
  let permitted = true, clock = 100000, sequence = 0
  const timers = new Map(), emitted = []
  const window = { location: { origin: 'https://blog.test' }, NANALY_AGENT: server.api,
    NOIMPTY_GATE: { unlocked: () => permitted },
    fetch: () => { throw new Error('journal cannot use static fetch') }, addEventListener() {},
    dispatchEvent: event => emitted.push(event.type) }
  vm.runInNewContext(source, { window, URL, Response, AbortController, Event, Date: { now: () => clock },
    setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id }, clearTimeout: id => timers.delete(id) })
  return { window, api: window.NOIMPTY_SEARCH, server, emitted, timers,
    permit: value => { permitted = value }, advance: ms => { clock += ms } }
}

await test('private journal shares requests and TTL while the same permitted backend remains connected', async () => {
  const hold = deferred(), server = backend(() => hold.promise), app = boot(server)
  const first = app.api.loadJournal(), second = app.api.loadJournal()
  await flush(); assert.equal(server.requests(), 1)
  hold.resolve({ revision: 1, data: { entries: [entry('one')] } })
  assert.equal((await first)[0].what, 'one'); await second
  app.advance(59999); await app.api.loadJournal(); assert.equal(server.requests(), 1)
  app.advance(1); await app.api.loadJournal(); assert.equal(server.requests(), 2)
  assert.equal(app.timers.size, 0)
})
await test('locking and disconnecting deny cached journal data and never trigger search-reset', async () => {
  const app = boot()
  await app.api.loadJournal(); app.permit(false)
  await assert.rejects(app.api.loadJournal(), /SEARCH_LOCKED/)
  app.permit(true); await app.api.loadJournal(); assert.equal(app.server.requests(), 2)
  app.server.state(false)
  await assert.rejects(app.api.loadJournal(), /JOURNAL_UNAVAILABLE/)
  app.server.state(true); await app.api.loadJournal(); assert.equal(app.server.requests(), 3)
  assert.deepEqual(app.emitted, [])
})
await test('backend changes abort pending journal reads; late old data cannot enter the replacement cache', async () => {
  const hold = deferred(), old = backend(() => hold.promise), app = boot(old)
  const reading = app.api.loadJournal(), rejected = assert.rejects(reading, /SEARCH_RESET/)
  await flush(); old.state(false); await rejected
  assert.equal(old.signals[0].aborted, true)
  const replacement = backend(async () => ({ revision: 4, data: [entry('replacement')] }))
  app.window.NANALY_AGENT = replacement.api
  assert.equal((await app.api.loadJournal())[0].what, 'replacement')
  assert.equal(old.listeners.size, 0)
  hold.resolve({ revision: 1, data: { entries: [entry('old')] } }); await flush()
  assert.equal((await app.api.loadJournal())[0].what, 'replacement')
  assert.deepEqual(app.emitted, [])
})
await test('journal results received after the gate closes are discarded even without a reset event', async () => {
  const hold = deferred(), app = boot(backend(() => hold.promise))
  const pending = app.api.loadJournal(); await flush(); app.permit(false)
  hold.resolve({ revision: 1, data: { entries: [entry('cannot disclose')] } })
  await assert.rejects(pending, /SEARCH_LOCKED/)
})
await test('hanging private journal requests time out, release coalescing and permit a fresh retry', async () => {
  const hold = deferred(); let slow = true
  const app = boot(backend(() => slow ? hold.promise : Promise.resolve({ revision: 2, data: { entries: [entry('fresh')] } })))
  const pending = app.api.loadJournal(), rejected = assert.rejects(pending, /SEARCH_TIMEOUT/)
  await flush()
  const timeout = [...app.timers.values()].find(timer => timer.ms === 20000)
  assert.ok(timeout); timeout.fn(); await rejected
  assert.equal(app.server.signals[0].aborted, true); assert.equal(app.timers.size, 0)
  slow = false; assert.equal((await app.api.loadJournal())[0].what, 'fresh')
  hold.resolve({ revision: 1, data: { entries: [entry('old')] } }); await flush()
  assert.equal((await app.api.loadJournal())[0].what, 'fresh')
})
await test('journal reads can bind an agent loaded after the head script and reject malformed replies', async () => {
  const app = boot(); delete app.window.NANALY_AGENT
  await assert.rejects(app.api.loadJournal(), /JOURNAL_UNAVAILABLE/)
  app.window.NANALY_AGENT = backend(async () => ({ revision: 1, data: null })).api
  await assert.rejects(app.api.loadJournal(), /SEARCH_BAD_FORMAT/)
  app.window.NANALY_AGENT = backend(async () => ({ revision: 1, data: { entries: [null, {}, entry('valid')] } })).api
  assert.equal((await app.api.loadJournal()).length, 1)
})
