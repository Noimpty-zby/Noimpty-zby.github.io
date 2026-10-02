import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../../source/js/study-room.js', import.meta.url), 'utf8')
const KEY = 'noimpty-room-preferences-v1'
const settle = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
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
  const header = new Element('header'); header.id = 'page-header'; body.append(header)
  const clock = new Element('div'); clock.id = 'noimpty-clock'; clock.tickCount = 7; header.append(clock)
  Object.assign(document, { readyState: 'loading', body, documentElement: html, createElement: tag => new Element(tag), getElementById: id => html.all().find(node => node.id === id) || null })
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const events = []; window.addEventListener('noimpty:focus-mode', event => events.push(event.detail.active))
  Object.assign(window, {
    location: { pathname: '/', assign() {} }, NOIMPTY_GATE: { unlocked: () => unlocked }, NOIMPTY_LEARNING_HISTORY: { summary },
    setTimeout: callback => { timers.push(callback); return timers.length }
  })
  vm.runInNewContext(source, { window, document, localStorage, CustomEvent, AbortController })
  const flushTimers = () => { while (timers.length) timers.shift()() }
  const root = () => header.querySelector('.study-room')
  const mount = async () => { window.NOIMPTY_ROOM.mount(); flushTimers(); await settle() }
  return { window, document, html, header, clock, storage, root, mount, flushTimers, events, lock: () => { unlocked = false },
    control: action => root().querySelector(`[data-room-action="${action}"]`),
    async navigate(path) { window.location.pathname = path; await window.fire('pjax:complete'); flushTimers(); await settle() }
  }
}

await test('focus persists after leaving the homepage and the global exit control works there', async () => {
  const h = boot(); await h.mount()
  await h.control('focus').click()
  assert.equal(h.html.classList.contains('noimpty-focus'), true)
  assert.equal(JSON.parse(h.storage.get(KEY)).focus, true)
  await h.navigate('/learn/')
  assert.equal(h.window.NOIMPTY_ROOM.focused(), true)
  assert.equal(h.html.classList.contains('noimpty-room-home'), false)
  const exit = h.document.getElementById('room-focus-exit')
  assert.equal(exit.hidden, false)
  await exit.click()
  assert.equal(h.window.NOIMPTY_ROOM.focused(), false)
  assert.equal(h.html.classList.contains('noimpty-focus'), false)
  assert.equal(JSON.parse(h.storage.get(KEY)).focus, false)
  assert.equal(exit.hidden, true)
})

await test('another tab updates focus and simple view without replacing the original clock or room', async () => {
  const storage = new Map(), a = boot({ storage }), b = boot({ storage }); await a.mount(); await b.mount()
  const original = b.root()
  assert.equal(b.clock.parentElement, original.querySelector('.room-clock-slot'))
  await a.control('focus').click(); await a.control('simple').click()
  await b.window.fire('storage', { key: KEY })
  assert.equal(b.root(), original)
  assert.equal(b.root().querySelector('.room-scene').hidden, true)
  assert.equal(b.root().querySelector('.room-shortcuts').hidden, false)
  assert.equal(b.control('simple').getAttribute('aria-pressed'), 'true')
  assert.equal(b.control('focus').getAttribute('aria-pressed'), 'true')
  assert.equal(b.clock.parentElement, original.querySelector('.room-clock-slot'))
  assert.equal(b.clock.tickCount, 7, 'the running clock is moved, not recreated')
  await b.mount()
  assert.equal(b.header.querySelectorAll('.study-room').length, 1)
  assert.equal(b.clock.parentElement, original.querySelector('.room-clock-slot'))
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
  const original = h.root(), progress = original.querySelector('.room-progress')
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

await test('clearing preferences in another tab exits focus without rebuilding the clock', async () => {
  const storage = new Map([[KEY, JSON.stringify({ simple: true, focus: true })]]), h = boot({ storage }); await h.mount()
  const originalClock = h.clock
  storage.clear(); await h.window.fire('storage', { key: null })
  assert.equal(h.window.NOIMPTY_ROOM.focused(), false)
  assert.equal(h.control('simple').getAttribute('aria-pressed'), 'false')
  assert.equal(h.document.getElementById('room-focus-exit').hidden, true)
  assert.equal(h.root().querySelector('.room-clock-slot').children[0], originalClock)
})
