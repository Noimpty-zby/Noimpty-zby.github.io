// Exercise the real vision module against an in-memory IndexedDB, never user images.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../source/js/nanaly-vision.js', import.meta.url), 'utf8')
const NOW = Date.parse('2026-09-19T12:00:00Z'), HOUR = 3600000
const workspace = (messages = []) => ({ v: 1, activeId: 'session-main', sessions: [{ id: 'session-main', messages, pending: null }], memories: [], undo: null })
const image = (id, age = HOUR * 2) => ({ id, name: id + '.jpg', type: 'image/jpeg', at: NOW - age, dataURL: 'data:image/jpeg;base64,AA==' })
const ref = item => ({ id: item.id, name: item.name, type: item.type })
const clone = value => value === undefined ? undefined : structuredClone(value)
const tick = () => new Promise(resolve => setImmediate(resolve))
class Element {
  constructor(tag) { this.tagName = tag; this.className = ''; this.children = []; this.parentNode = null; this.attributes = new Map(); this.listeners = new Map(); this.hidden = false }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)) }
  prepend(...nodes) { nodes.forEach(n => { n.parentNode = this }); this.children.unshift(...nodes) }
  before(node) { const parent = this.parentNode; node.parentNode = parent; parent.children.splice(parent.children.indexOf(this), 0, node) }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list) }
  matches(selector) { return selector.startsWith('.') ? this.className.split(/\s+/).includes(selector.slice(1)) : this.tagName === selector }
  querySelectorAll(selector) { return this.children.flatMap(n => [...(n.matches(selector) ? [n] : []), ...n.querySelectorAll(selector)]) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}
const boot = (entries, saved = workspace()) => {
  const data = new Map(entries.map(item => [item.id, clone(item)])), deleted = []
  let raw = typeof saved === 'string' || saved === null ? saved : JSON.stringify(saved)
  let denied = false, gets = 0
  const database = { transaction() {
    const tx = { objectStore: () => ({
      get(id) { return request(data.get(id)) },
      getAll() { gets++; return request([...data.values()]) },
      delete(id) { deleted.push(id); data.delete(id); return request(undefined) }
    }) }
    const request = value => { const r = { result: clone(value) }; queueMicrotask(() => tx.oncomplete()); return r }
    return tx
  } }
  const indexedDB = { open() { const request = { result: database }; queueMicrotask(() => request.onsuccess()); return request } }
  const document = { createElement: tag => new Element(tag) }
  class FakeDate extends Date { static now() { return NOW } }
  const window = { indexedDB, localStorage: { getItem(key) {
    assert.equal(key, 'nanaly-workspace-v1')
    if (denied) throw new Error('storage denied')
    return raw
  } } }
  vm.runInNewContext(source, { window, indexedDB, document, URL, Date: FakeDate })
  const api = window.NANALY_VISION
  return { api, data, deleted, reads: () => gets,
    save: value => { raw = typeof value === 'string' || value === null ? value : JSON.stringify(value) },
    deny: () => { denied = true },
    mount() {
      let chat = true, busy = false
      const panel = new Element('div'), foot = new Element('div'), input = new Element('textarea'), notices = []
      foot.className = 'nanaly-foot'; foot.append(input); panel.append(foot)
      const ui = api.mount({ panel, input, isBusy: () => busy, isChat: () => chat, notify: message => notices.push(message) })
      return { ui, panel, notices, tray: () => panel.querySelector('.nanaly-image-tray'),
        setChat: value => { chat = value; ui.refresh() }, setBusy: value => { busy = value; ui.refresh() } }
    }
  }
}
let passed = 0
const check = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name, error) }
}

await check('a stale tab cannot prune an image referenced by another tab in persisted history', async () => {
  const old = image('image-other-tab')
  const h = boot([old], workspace([{ role: 'user', content: '看图', attachments: [ref(old)] }]))
  await h.api.prune(workspace(), [])
  assert.equal(h.data.has(old.id), true)
  assert.deepEqual(h.deleted, [])
  // Re-read persisted state on every pass, rather than keeping its first snapshot.
  h.save(workspace())
  await h.api.prune(workspace(), [])
  assert.equal(h.data.has(old.id), false)
})
await check('pending turns, retry snapshots, undo records and current drafts all retain image references', async () => {
  const items = ['image-pending-1', 'image-retry-001', 'image-undo-0001', 'image-draft-001'].map(id => image(id))
  const local = workspace()
  local.sessions[0].pending = { attachments: [ref(items[0])], baseMessages: [{ attachments: [ref(items[1])] }] }
  const saved = workspace(); saved.undo = { sessionId: 'session-main', messages: [{ attachments: [ref(items[2])] }] }
  const h = boot(items, saved)
  await h.api.prune(local, [ref(items[3])])
  assert.equal(h.data.size, items.length)
  assert.deepEqual(h.deleted, [])
})
await check('unreferenced images within the one-hour grace period remain available', async () => {
  const items = [image('image-new-0001', 0), image('image-hour-001', HOUR), image('image-future-01', -HOUR)]
  const h = boot(items)
  await h.api.prune(workspace(), [])
  assert.equal(h.data.size, 3)
  assert.deepEqual(h.deleted, [])
})
await check('an unreferenced image older than the grace period is deleted while current references survive', async () => {
  const stale = image('image-stale-01', HOUR + 1), kept = image('image-kept-001', HOUR * 5)
  const local = workspace([{ attachments: [ref(kept)] }]), h = boot([stale, kept])
  await h.api.prune(local, [])
  assert.deepEqual(h.deleted, [stale.id])
  assert.equal(h.data.has(kept.id), true)
})
await check('uncertain or unreadable persisted state skips cleanup instead of treating it as empty', async () => {
  for (const saved of [null, '{broken', 'null', '[]', { v: 2, sessions: [] }, { v: 1 }, { v: 1, sessions: {} }, { v: 1, sessions: [] }, { v: 1, sessions: [null] },
    { v: 1, sessions: [{ id: 'session-main', messages: null }] }, { v: 1, sessions: [{ messages: [] }] }]) {
    const old = image('image-uncertain-01'), h = boot([old], saved)
    await h.api.prune(workspace(), [])
    assert.equal(h.data.has(old.id), true, JSON.stringify(saved))
    assert.equal(h.reads(), 0, 'untrusted state must not even enumerate stored image data')
  }
  const old = image('image-denied-001'), h = boot([old]); h.deny()
  await h.api.prune(workspace(), [])
  assert.equal(h.data.has(old.id), true)
  assert.equal(h.reads(), 0)
})
await check('clearing a restored attachment only clears the draft and preserves the historical image', async () => {
  const old = image('image-restored-01'), h = boot([old]), mounted = h.mount()
  await mounted.ui.restore([ref(old)])
  assert.equal(mounted.ui.refs()[0].id, old.id)
  mounted.ui.clear(); await tick()
  assert.equal(mounted.ui.refs().length, 0)
  assert.equal(h.data.has(old.id), true)
  assert.deepEqual(h.deleted, [])
  const content = await h.api.imageContent('原图还能追问', [ref(old)])
  assert.equal(content[1].image_url.url, old.dataURL)
})
await check('removing or replacing restored preview images never deletes either original history image', async () => {
  const first = image('image-first-001'), second = image('image-second-01'), h = boot([first, second]), mounted = h.mount()
  await mounted.ui.restore([ref(first)])
  mounted.tray().querySelector('button').onclick(); await tick()
  assert.equal(mounted.ui.refs().length, 0)
  assert.equal(h.data.has(first.id), true)
  await mounted.ui.restore([ref(first)])
  await mounted.ui.restore([ref(second)])
  assert.equal(mounted.ui.refs()[0].id, second.id)
  assert.equal(h.data.has(first.id), true)
  mounted.ui.clear(); await tick()
  assert.equal(h.data.has(second.id), true)
  assert.deepEqual(h.deleted, [])
})
await check('clearing while an asynchronous restore is loading cannot resurrect its preview', async () => {
  const old = image('image-delayed-01'), h = boot([old]), mounted = h.mount()
  const pending = mounted.ui.restore([ref(old)])
  mounted.ui.clear()
  await pending
  assert.equal(mounted.ui.refs().length, 0)
  assert.equal(mounted.tray().hidden, true)
  assert.equal(h.data.has(old.id), true)
})
await check('setup and lock views hide retained previews without deleting the draft', async () => {
  const old = image('image-hidden-01'), h = boot([old]), mounted = h.mount()
  await mounted.ui.restore([ref(old)])
  assert.equal(mounted.tray().hidden, false)
  mounted.setChat(false)
  assert.equal(mounted.tray().hidden, true)
  assert.equal(mounted.tray().querySelector('button').disabled, true)
  assert.equal(mounted.ui.refs()[0].id, old.id)
  mounted.setChat(true)
  assert.equal(mounted.tray().hidden, false)
  assert.equal(h.data.has(old.id), true)
})
console.log(`\n${passed} image storage regression cases passed`)
