import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../source/js/schedule.js', import.meta.url), 'utf8')
const day = '2026-09-25'
const plain = value => JSON.parse(JSON.stringify(value))
const ID_A = 'https://a.test/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_B = 'https://b.test/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEY = 'noimpty-schedule-cache-v1'
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j }); return { resolve, reject, promise } }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const boot = ({ cached } = {}) => {
  const events = [], storage = new Map(cached ? [[KEY, JSON.stringify(cached)]] : []), calls = []
  let identity = ID_A, listener, nextRequest = null
  let unlocked = true, server = { updatedAt: '', days: { [day]: [
    { id: 'a', text: 'read article', done: false, customSecret: 'must-not-broadcast', when: { type: 'post', match: 'Git', token: 'private' } }
  ] } }
  const win = {
    NOIMPTY_GATE: { unlocked: () => unlocked },
    NANALY: { githubToken: () => 'fixture-not-a-real-token' },
    CustomEvent, dispatchEvent: event => events.push(event.detail), addEventListener() {},
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
  }
  win.NANALY_AGENT = { identity: () => identity, configured: () => !!identity, subscribe(fn) { listener = fn }, async privateContent(name, options = {}) {
    assert.equal(name, 'schedule')
    calls.push({ identity, method: options.method || 'GET', body: options.body && plain(options.body) })
    const hold = nextRequest; nextRequest = null
    if (options.method === 'PUT') server = plain(options.body.data)
    const value = { revision: 1, data: plain(server) }
    if (hold) await hold.promise
    if (!identity) throw new Error('disconnected')
    return value
  } }
  const fetch = async () => { throw new Error('public transport forbidden') }
  const context = vm.createContext({ window: win, document: { getElementById: () => null,
    documentElement: { classList: { contains: () => !unlocked } } },
    localStorage: win.localStorage, fetch, CustomEvent, AbortSignal, TextEncoder, TextDecoder,
    Uint8Array, setTimeout, clearTimeout, Intl, Date, console,
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
    atob: text => Buffer.from(text, 'base64').toString('binary')
  })
  // Expose existing mutation functions only inside this offline test realm.
  vm.runInContext(source.replace('    mergeDays,', '    mergeDays, testSetTasks: setTasks, testMoveTask: moveTask, testSave: save,'), context)
  return { api: win.NOIMPTY_SCHEDULE, events, calls, storage, gate: value => { unlocked = value }, server: value => { server = value },
    delay: hold => { nextRequest = hold }, connect: (next, value) => { identity = null; listener({ connected: false, revision: null }); identity = next; if (value) server = plain(value); if (next) listener({ connected: true, revision: 1 }) } }
}

await test('schedule broadcasts real load/edit/save changes once with isolated safe snapshots', async () => {
  const h = boot()
  assert.equal(h.events.length, 0)
  assert.equal(h.api.snapshot(), null, '尚未进入或读取日程时不能把初始空表当成真实数据')
  await h.api.reload()
  assert.equal(h.events.length, 1)
  assert.equal(h.events[0].source, 'load')
  assert.doesNotMatch(JSON.stringify(h.events), /must-not-broadcast|private|fixture-not-a-real-token/)
  h.events[0].days[day][0].text = 'listener mutation'
  const copy = h.api.snapshot(); copy.days[day][0].text = 'snapshot mutation'
  assert.equal(h.api.data().days[day][0].text, 'read article')
  await h.api.reload()
  assert.equal(h.events.length, 1, 'same reload must not replay completion')
  const original = h.api.data().days[day][0]
  h.api.testSetTasks(day, [{ ...original, done: true }])
  assert.equal(h.events.at(-1).source, 'edit')
  const count = h.events.length
  h.api.testSetTasks(day, [{ ...original, done: true }])
  assert.equal(h.events.length, count, 'unchanged edit must not dispatch')
  h.server({ days: { [day]: [original, { id: 'remote', text: 'other device task', done: false }] } })
  await h.api.testSave()
  assert.equal(h.events.at(-1).source, 'save')
  assert.deepEqual(plain(h.events.at(-1).days[day].map(task => [task.id, task.done])), [['a', true], ['remote', false]])
  h.api.testMoveTask(day, '2026-09-26', 'remote')
  assert.equal(h.events.at(-1).source, 'edit')
  assert.equal(h.events.at(-1).days['2026-09-26'][0].id, 'remote')
})
await test('locked schedules expose neither stored text nor mutation events', async () => {
  const h = boot()
  h.gate(false)
  assert.equal(h.api.snapshot(), null)
  assert.equal(await h.api.reload(), 'locked')
  assert.equal(h.events.length, 0)
  h.gate(true)
  await h.api.reload()
  const before = h.events.length
  h.gate(false)
  h.api.testSetTasks(day, [{ id: 'secret', text: 'locked body', done: false }])
  assert.equal(h.api.snapshot(), null)
  assert.equal(h.events.length, before)
  h.gate(true)
  assert.equal(h.api.snapshot().days[day][0].text, 'locked body')
})

await test('a read superseded by a reconnect is stale, not locked (no false "enter the passphrase" warning)', async () => {
  // 打开日程页时，后端会话恢复常常晚于第一次读取。那次读取作废后曾返回 'locked'，
  // 页面于是在已解锁、任务也正常显示的情况下挂着「请先输入站点暗号，再读取日程」。
  const h = boot()
  const hold = deferred()
  h.delay(hold)
  const first = h.api.reload()
  h.connect(ID_A)
  hold.resolve()
  assert.equal(await first, 'stale')
  assert.equal(await h.api.reload(), 'remote')
  h.gate(false)
  assert.equal(await h.api.reload(), 'locked', '真的没解锁时仍然报 locked')
})

await test('drafts are bound to backend identity and each account survives switching and offline reads', async () => {
  const h = boot()
  await h.api.reload()
  const original = h.api.data().days[day][0]
  h.api.testSetTasks(day, [original, { id: 'a-draft', text: 'only A', done: false }])
  h.connect(ID_B, { days: { [day]: [{ id: 'b', text: 'only B', done: false }] } })
  await h.api.reload()
  assert.deepEqual(plain(h.api.data().days[day].map(x => x.id)), ['b'])
  h.api.testSetTasks(day, [...h.api.data().days[day], { id: 'b-draft', text: 'B draft', done: false }])
  await h.api.testSave()
  assert.deepEqual(h.calls.filter(x => x.method === 'PUT').map(x => x.body.data.days[day].map(x => x.id)), [['b', 'b-draft']])
  h.connect(ID_A, { days: { [day]: [original] } })
  await h.api.reload()
  assert.deepEqual(plain(h.api.data().days[day].map(x => x.id)), ['a', 'a-draft'])
  assert.equal(h.api.dirty(), true)
  const cache = JSON.parse(h.storage.get(KEY))
  assert.equal(cache.version, 2)
  assert.deepEqual(Object.keys(cache.accounts).sort(), [ID_A, ID_B])
  assert.doesNotMatch(JSON.stringify(cache), /fixture-not-a-real-token/)
  h.connect(ID_B, { days: {} })
  const unavailable = deferred(); h.delay(unavailable)
  const offline = h.api.reload(); unavailable.reject(new Error('offline')); await offline
  assert.deepEqual(plain(h.api.data().days[day].map(x => x.id)), ['b', 'b-draft'])
  h.connect('https://c.test/cccccccc-cccc-4ccc-8ccc-cccccccccccc', { days: {} })
  const unknown = deferred(); h.delay(unknown)
  const failed = h.api.reload(); unknown.reject(new Error('offline'))
  assert.equal(await failed, 'failed')
  assert.equal(h.api.snapshot(), null)
  assert.deepEqual(plain(h.api.data().days), {})
})
await test('unbound legacy drafts stay recoverable but never merge into the next account', async () => {
  const legacy = { days: { [day]: [{ id: 'legacy', text: 'unknown owner', done: false }] }, _dirty: true, _base: {} }
  const h = boot({ cached: legacy })
  await h.api.reload()
  assert.equal(h.api.data().days[day].some(x => x.id === 'legacy'), false)
  assert.deepEqual(JSON.parse(h.storage.get(KEY)).legacy, legacy)
  h.connect(ID_B, { days: {} }); await h.api.reload()
  assert.deepEqual(plain(h.api.data().days), {})
  assert.deepEqual(JSON.parse(h.storage.get(KEY)).legacy, legacy)
})
await test('a delayed save GET cannot write its draft into a replacement connection', async () => {
  const h = boot(); await h.api.reload()
  h.api.testSetTasks(day, [{ id: 'a-draft', text: 'only A', done: false }])
  const hold = deferred(); h.delay(hold)
  const save = h.api.testSave(); await flush()
  h.connect(ID_B, { days: { [day]: [{ id: 'b', text: 'only B', done: false }] } }); await h.api.reload()
  hold.resolve(); await save
  assert.equal(h.calls.filter(x => x.method === 'PUT').length, 0)
  assert.deepEqual(plain(h.api.data().days[day].map(x => x.id)), ['b'])
  assert.equal(JSON.parse(h.storage.get(KEY)).accounts[ID_A]._dirty, true)
})
await test('a delayed save PUT completion cannot replace the new account or clear its newer save', async () => {
  const h = boot(); await h.api.reload()
  h.api.testSetTasks(day, [{ id: 'a-draft', text: 'only A', done: false }])
  // Pause the GET first, then pause the following PUT.
  const get = deferred(); h.delay(get)
  const savingA = h.api.testSave(); await flush()
  const putA = deferred(); h.delay(putA); get.resolve(); await flush()
  assert.equal(h.calls.at(-1).method, 'PUT')
  h.connect(ID_B, { days: { [day]: [{ id: 'b', text: 'only B', done: false }] } }); await h.api.reload()
  h.api.testSetTasks(day, [{ id: 'b-draft', text: 'only B draft', done: false }])
  const getB = deferred(); h.delay(getB)
  const savingB = h.api.testSave(); await flush()
  putA.resolve(); await savingA
  assert.deepEqual(plain(h.api.data().days[day].map(x => x.id)), ['b-draft'])
  const before = h.calls.length; await h.api.testSave()
  assert.equal(h.calls.length, before, 'old finally must not clear the replacement save guard')
  getB.resolve(); await savingB
  assert.equal(h.calls.at(-1).identity, ID_B)
  assert.equal(h.api.dirty(), false)
})
await test('gate locking or reconnecting the same identity invalidates an outstanding save', async () => {
  for (const transition of ['lock', 'reconnect']) {
    const h = boot(); await h.api.reload()
    h.api.testSetTasks(day, [{ id: 'draft', text: 'unsaved', done: false }])
    const hold = deferred(); h.delay(hold)
    const save = h.api.testSave(); await flush()
    if (transition === 'lock') h.gate(false)
    else h.connect(ID_A, { days: {} })
    hold.resolve(); await save
    assert.equal(h.calls.filter(x => x.method === 'PUT').length, 0)
  }
})

await test('saving one account does not replay stale cache entries over another tab account draft', async () => {
  const h = boot(); await h.api.reload()
  h.connect(ID_B, { days: {} }); await h.api.reload()
  const cache = JSON.parse(h.storage.get(KEY))
  cache.accounts[ID_A] = { days: { [day]: [{ id: 'other-tab', text: 'new A draft', done: false }] }, _dirty: true, _base: {} }
  h.storage.set(KEY, JSON.stringify(cache))
  h.api.testSetTasks(day, [{ id: 'b-draft', text: 'B draft', done: false }])
  assert.equal(JSON.parse(h.storage.get(KEY)).accounts[ID_A].days[day][0].id, 'other-tab')
  h.connect(ID_A, { days: {} }); await h.api.reload()
  assert.equal(h.api.data().days[day][0].id, 'other-tab')
})
