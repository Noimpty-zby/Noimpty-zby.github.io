/* 首页「我的小房间」（scripts/noimpty-room.js 生成结构，source/js/study-room.js 摆放和接按钮）。
 *
 * 盯的几件事：
 *   - 房间摆在「这里是私人记录」前面，换页回来不会摆出第二个；
 *   - 每个入口都指向站里真的存在的页面，九个小物件的贴纸滤镜 id 互不相同；
 *   - 首页是公开页，房间里的字不能出现泄漏检查禁止的词；
 *   - 学习记录的统计只在解锁后读，上锁、换页、迟到的旧请求都不能把数字写回页面；
 *   - 专注模式跨页、跨标签页同步，任何页面都能退出。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { ITEMS, markup } = require('../../../scripts/noimpty-room.js')
const source = readFileSync(new URL('../../../source/js/study-room.js', import.meta.url), 'utf8')
const KEY = 'noimpty-room-preferences-v1'
const settle = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
// 假 DOM 只认简单的 HTML，测试里把 SVG 去掉，只留房间的骨架
const skeleton = markup().replace(/^<template[^>]*>|<\/template>$/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '')

class Events {
  listeners = new Map()
  addEventListener(type, callback, options = {}) {
    if (options.signal?.aborted) return
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(callback)
    options.signal?.addEventListener('abort', () => this.listeners.get(type).delete(callback), { once: true })
  }
  dispatchEvent(event) { void this.fire(event.type, event); return true }
  async fire(type, event = {}) { await Promise.all([...this.listeners.get(type) || []].map(fn => fn({ type, target: this, detail: event.detail, ...event }))) }
}
class Element extends Events {
  constructor(tag = 'div') {
    super(); this.tagName = tag.toLowerCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.hidden = false; this._text = ''
    this.classList = {
      contains: cls => (this.className || '').split(/\s+/).includes(cls),
      toggle: (cls, enabled) => { const values = new Set((this.className || '').split(/\s+/).filter(Boolean)); const add = enabled ?? !values.has(cls); add ? values.add(cls) : values.delete(cls); this.className = [...values].join(' '); return add }
    }
  }
  get isConnected() { return this.connected === true || this.parentElement?.isConnected === true }
  get textContent() { return this._text + this.children.map(child => child.textContent).join('') }
  set textContent(value) { this._text = String(value); this.replaceChildren() }
  set innerHTML(html) {
    this.replaceChildren(); this._text = ''
    const stack = [this], voidTags = new Set(['img', 'input', 'br', 'hr', 'meta', 'link'])
    for (const match of html.matchAll(/<\/?[^>]+>|[^<]+/g)) {
      const token = match[0]
      if (token.startsWith('</')) { stack.pop(); continue }
      if (!token.startsWith('<')) { const text = new Element('#text'); text._text = token; stack.at(-1).append(text); continue }
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue
      const node = new Element(tag)
      for (const attr of token.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], attr[2] ?? '')
      stack.at(-1).append(node)
      if (!voidTags.has(tag)) stack.push(node)
    }
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value)
    if (key === 'id') this.id = value
    if (key === 'class') this.className = value
    if (key === 'hidden') this.hidden = true
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value
  }
  getAttribute(key) { return this.attributes[key] ?? null }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node) } }
  before(node) { node.remove(); node.parentElement = this.parentElement; const list = this.parentElement.children; list.splice(list.indexOf(this), 0, node) }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes) }
  all() { return this.children.flatMap(node => [node, ...node.all()]) }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1))
    if (selector.startsWith('#')) return this.id === selector.slice(1)
    const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
    if (attr) return Object.hasOwn(this.attributes, attr[1]) && (attr[2] === undefined || this.attributes[attr[1]] === attr[2])
    return this.tagName === selector
  }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/)
    if (parts.length === 1) return this.all().filter(node => node.matches(selector))
    return this.querySelectorAll(parts.shift()).flatMap(node => node.querySelectorAll(parts.join(' ')))
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null }
  async click() { for (let node = this; node; node = node.parentElement) await node.fire('click', { target: this }) }
}

function boot({ storage = new Map(), unlocked = false, summary = async () => null } = {}) {
  const document = new Events(), window = new Events(), html = new Element('html'), body = new Element('body'), timers = []
  html.connected = true; html.append(body)
  const posts = new Element('div'); posts.id = 'recent-posts'; body.append(posts)
  const hub = new Element('section'); hub.id = 'private-sections'; posts.append(hub)
  const template = { id: 'noimpty-room-template', innerHTML: skeleton }
  Object.assign(document, {
    readyState: 'loading', body, documentElement: html, createElement: tag => new Element(tag),
    getElementById: id => id === template.id ? template : html.all().find(node => node.id === id) || null,
    querySelector: selector => html.querySelector(selector)
  })
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const events = []; window.addEventListener('noimpty:focus-mode', event => events.push(event.detail.active))
  const opened = []
  Object.assign(window, {
    location: { pathname: '/', assign() {} }, NOIMPTY_GATE: { unlocked: () => unlocked }, NOIMPTY_LEARNING_HISTORY: { summary },
    NANALY: { open: () => opened.push('chat') },
    setTimeout: callback => { timers.push(callback); return timers.length }
  })
  vm.runInNewContext(source, { window, document, localStorage, CustomEvent, AbortController })
  const flushTimers = () => { while (timers.length) timers.shift()() }
  const root = () => posts.querySelector('.noimpty-room')
  const mount = async () => { window.NOIMPTY_ROOM.mount(); flushTimers(); await settle() }
  return {
    window, document, html, posts, hub, storage, root, mount, flushTimers, events, opened, lock: () => { unlocked = false },
    control: action => root().querySelector(`[data-room-action="${action}"]`),
    async navigate(path) { window.location.pathname = path; await window.fire('pjax:complete'); flushTimers(); await settle() }
  }
}

await test('the room sits right before the three section cards, once', async () => {
  const h = boot(); await h.mount()
  const room = h.root()
  assert.ok(room, '首页上没有摆出小房间')
  assert.equal(h.posts.children.indexOf(room) + 1, h.posts.children.indexOf(h.hub), '房间应该紧挨在「私人记录」前面')
  assert.equal(room.querySelectorAll('.noimpty-room__item').length, ITEMS.length)
  await h.mount(); await h.navigate('/')
  assert.equal(h.posts.querySelectorAll('.noimpty-room').length, 1, 'PJAX 回到首页摆出了第二个房间')
})

await test('every entry leads to a page that exists, and every sticker filter id is unique', () => {
  for (const item of ITEMS) {
    if (item.action) { assert.match(item.action, /^(music|chat)$/); continue }
    if (item.href.startsWith('#')) { assert.equal(item.href, '#private-sections'); continue }
    const page = new URL(`../../../source${item.href}index.md`, import.meta.url)
    assert.ok(existsSync(page), `${item.label} 指向的 ${item.href} 没有对应的页面`)
  }
  const ids = [...markup().matchAll(/<filter id="([^"]+)"/g)].map(m => m[1])
  assert.equal(ids.length, ITEMS.length)
  assert.equal(new Set(ids).size, ids.length, '两个小物件共用一个滤镜 id，白边会串')
})

await test('the public homepage markup carries none of the words the leak check forbids', () => {
  const leak = readFileSync(new URL('../../checks/leakcheck.mjs', import.meta.url), 'utf8')
  const list = leak.slice(leak.indexOf('const FORBIDDEN = ['), leak.indexOf(']', leak.indexOf('const FORBIDDEN = [')))
  const words = [...list.matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.ok(words.length > 20, '没读到泄漏检查的禁用词表')
  const html = markup()
  for (const word of words) assert.ok(!html.includes(word), `首页小房间里出现了「${word}」`)
})

await test('the chat bubble opens the chat panel', async () => {
  const h = boot(); await h.mount()
  await h.control('chat').click()
  assert.deepEqual(h.opened, ['chat'])
})

await test('focus persists after leaving the homepage and the global exit control works there', async () => {
  const h = boot(); await h.mount()
  await h.control('focus').click()
  assert.equal(h.html.classList.contains('noimpty-focus'), true)
  assert.equal(JSON.parse(h.storage.get(KEY)).focus, true)
  assert.equal(h.control('focus').getAttribute('aria-pressed'), 'true')
  await h.navigate('/learn/')
  assert.equal(h.window.NOIMPTY_ROOM.focused(), true)
  const exit = h.document.getElementById('room-focus-exit')
  assert.equal(exit.hidden, false)
  await exit.click()
  assert.equal(h.window.NOIMPTY_ROOM.focused(), false)
  assert.equal(h.html.classList.contains('noimpty-focus'), false)
  assert.equal(JSON.parse(h.storage.get(KEY)).focus, false)
  assert.equal(exit.hidden, true)
})

await test('another tab switches focus without rebuilding the room', async () => {
  const storage = new Map(), a = boot({ storage }), b = boot({ storage }); await a.mount(); await b.mount()
  const original = b.root()
  await a.control('focus').click()
  await b.window.fire('storage', { key: KEY })
  assert.equal(b.root(), original)
  assert.equal(b.window.NOIMPTY_ROOM.focused(), true)
  assert.equal(b.control('focus').getAttribute('aria-pressed'), 'true')
  assert.deepEqual(b.events.at(-1), true)
})

await test('a locked homepage does not request private learning summaries', async () => {
  let calls = 0
  const h = boot({ summary: async () => { calls++; return { cases: 50, due: 4 } } }); await h.mount()
  assert.equal(calls, 0)
  assert.equal(h.root().querySelector('.room-progress').hidden, true)
  assert.equal(h.root().querySelector('.room-progress').textContent, '')
})

await test('locking while a private summary is pending prevents late progress from appearing', async () => {
  const pending = deferred(), h = boot({ unlocked: true, summary: () => pending.promise }); await h.mount()
  h.lock(); pending.resolve({ cases: 9, due: 4 }); await settle()
  assert.equal(h.root().querySelector('.room-progress').hidden, true)
  assert.equal(h.root().querySelector('.room-progress').textContent, '')
})

await test('navigation cancels a pending summary and removes its event listeners', async () => {
  const pending = deferred(), h = boot({ unlocked: true, summary: () => pending.promise }); await h.mount()
  const progress = h.root().querySelector('.room-progress')
  await h.navigate('/learn/'); pending.resolve({ cases: 9, due: 4 }); await settle()
  assert.equal(progress.hidden, true); assert.equal(progress.textContent, '')
  assert.equal(h.window.listeners.get('noimpty:learning-history').size, 0)
})

await test('out-of-order refreshes cannot replace a newer private summary', async () => {
  const first = deferred(), second = deferred(); let calls = 0
  const h = boot({ unlocked: true, summary: () => ++calls === 1 ? first.promise : second.promise }); await h.mount()
  const update = h.window.fire('noimpty:learning-history')
  second.resolve({ cases: 3, due: 1, explanations: 2, dueExplanations: 1 }); await update
  first.resolve({ cases: 100, due: 100 }); await settle()
  const progress = h.root().querySelector('.room-progress')
  assert.equal(progress.hidden, false)
  assert.match(progress.textContent, /5 个留下来的问题 · 2 个可以再试一次/)
  assert.doesNotMatch(progress.textContent, /100/)
})

await test('clearing preferences in another tab exits focus', async () => {
  const storage = new Map([[KEY, JSON.stringify({ focus: true })]]), h = boot({ storage }); await h.mount()
  assert.equal(h.window.NOIMPTY_ROOM.focused(), true)
  storage.clear(); await h.window.fire('storage', { key: null })
  assert.equal(h.window.NOIMPTY_ROOM.focused(), false)
  assert.equal(h.control('focus').getAttribute('aria-pressed'), 'false')
  assert.equal(h.document.getElementById('room-focus-exit').hidden, true)
})
