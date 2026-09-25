import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../source/js/schedule.js', import.meta.url), 'utf8')
const day = '2026-09-25'
const plain = value => JSON.parse(JSON.stringify(value))
const boot = () => {
  const events = [], storage = new Map()
  let unlocked = true, server = { updatedAt: '', days: { [day]: [
    { id: 'a', text: 'read article', done: false, customSecret: 'must-not-broadcast', when: { type: 'post', match: 'Git', token: 'private' } }
  ] } }
  const win = {
    NOIMPTY_GATE: { unlocked: () => unlocked },
    NANALY: { githubToken: () => 'fixture-not-a-real-token' },
    CustomEvent, dispatchEvent: event => events.push(event.detail), addEventListener() {},
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
  }
  const fetch = async (url, init = {}) => {
    if (String(url).startsWith('/schedule/')) return { ok: true, json: async () => plain(server) }
    assert.ok(String(url).startsWith('https://api.github.com/repos/'))
    if (init.method === 'PUT') {
      server = JSON.parse(Buffer.from(JSON.parse(init.body).content, 'base64').toString())
      return { ok: true, json: async () => ({}) }
    }
    return { ok: true, json: async () => ({ encoding: 'base64', content: Buffer.from(JSON.stringify(server)).toString('base64'), sha: 'fixture-sha' }) }
  }
  const context = vm.createContext({ window: win, document: { getElementById: () => null,
    documentElement: { classList: { contains: () => !unlocked } } },
    localStorage: win.localStorage, fetch, CustomEvent, AbortSignal, TextEncoder, TextDecoder,
    Uint8Array, setTimeout, clearTimeout, Intl, Date, console,
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
    atob: text => Buffer.from(text, 'base64').toString('binary')
  })
  // Expose existing mutation functions only inside this offline test realm.
  vm.runInContext(source.replace('    mergeDays,', '    mergeDays, testSetTasks: setTasks, testMoveTask: moveTask, testSave: save,'), context)
  return { api: win.NOIMPTY_SCHEDULE, events, gate: value => { unlocked = value }, server: value => { server = value } }
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
