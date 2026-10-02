import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../../source/js/review.js', import.meta.url), 'utf8')
const fsrs = readFileSync(new URL('../../../source/js/review-fsrs.js', import.meta.url), 'utf8')
const STORE = 'noimpty-review-v1'
const today = () => new Date().toLocaleDateString('sv-SE')
const empty = () => ({ v: 1, cards: {}, series: ['dsa', 'linux'], daily: { date: today(), fresh: 0, extra: 0 } })
const tick = () => new Promise(resolve => setImmediate(resolve))

class Events {
  listeners = new Map()
  addEventListener(type, fn, options = {}) {
    if (options.signal?.aborted) return
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
    options.signal?.addEventListener('abort', () => this.listeners.get(type).delete(fn), { once: true })
  }
  async dispatch(type, event = {}) {
    await Promise.all([...this.listeners.get(type) || []].map(fn => fn({ type, ...event })))
  }
}
class Element extends Events {
  constructor(tag = 'div') {
    super()
    Object.assign(this, { tagName: tag.toUpperCase(), className: '', children: [], dataset: {}, hidden: false, disabled: false, _text: '' })
    this.classList = { add: () => {}, remove: () => {} }
  }
  get textContent() { return this._text + this.children.map(x => x.textContent).join('') }
  set textContent(value) { this._text = String(value); this.children = [] }
  set innerHTML(value) { this.textContent = value }
  get innerHTML() { return this.textContent }
  setAttribute(key, value) { this[key] = value }
  getAttribute(key) { return this[key] }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child) } }
  replaceChildren(...children) { this.children = []; this.append(...children) }
  all() { return this.children.flatMap(x => [x, ...x.all()]) }
  querySelectorAll(selector) { return this.all().filter(x => selector.startsWith('.') ? x.className === selector.slice(1) : x.tagName.toLowerCase() === selector) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  click() { return this.disabled ? Promise.resolve() : this.dispatch('click', { target: this }) }
  focus() {}
  remove() {}
  closest() { return null }
}
function shared() {
  const store = new Map()
  let tail = Promise.resolve()
  const locks = {
    requests: 0, reject: false,
    request(name, options, callback) {
      assert.equal(name, STORE); assert.equal(options.mode, 'exclusive')
      this.requests++
      if (this.reject) return Promise.reject(new Error('lock unavailable'))
      const result = tail.then(() => {
        if (options.signal.aborted) throw new Error('aborted')
        return callback()
      })
      tail = result.catch(() => {})
      return result
    },
    hold() { let release; tail = new Promise(resolve => { release = resolve }); return release }
  }
  return { store, locks, state: () => JSON.parse(store.get(STORE)), seed: value => store.set(STORE, JSON.stringify(value)) }
}
async function boot({ common = shared(), count = 25, useLocks = true, failWrite = false, failRead = false, dataSeries = ['dsa', 'linux'] } = {}) {
  const root = new Element(), data = new Element('script'), window = new Events(), document = new Events()
  data.textContent = JSON.stringify({
    series: dataSeries.map(id => ({ id, name: id, count })),
    cards: dataSeries.flatMap(series => Array.from({ length: count }, (_, i) => ({ id: series + (i + 1), series, kind: '问答', front: series + (i + 1), back: '答案', post: { title: '文章', url: '/post/' } })))
  })
  const nodes = { 'review-app': root, 'review-cards': data }, alerts = [], confirmations = [], blobs = [], timers = new Map()
  let nextTimer = 0
  const storage = {
    getItem(key) { if (failRead) throw new Error('unreadable'); return common.store.get(key) ?? null },
    setItem(key, value) { if (failWrite) throw new Error('QuotaExceededError'); common.store.set(key, value) }
  }
  Object.assign(window, { navigator: useLocks ? { locks: common.locks } : {}, localStorage: storage, confirm: text => { confirmations.push(text); return true }, alert: text => alerts.push(text) })
  Object.assign(document, { readyState: 'complete', body: new Element('body'), head: new Element('head'), getElementById: id => nodes[id], createElement: tag => new Element(tag) })
  const context = vm.createContext({
    window, document, console, AbortController, Blob,
    URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:export' }, revokeObjectURL() {} },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer },
    clearTimeout: id => timers.delete(id)
  })
  vm.runInContext(fsrs, context)
  vm.runInContext(source, context)
  await tick()
  const query = selector => root.querySelector(selector)
  const reveal = () => query('.review-show').click()
  const rate = () => root.all().find(x => x.dataset.rating === '4').click()
  const h = {
    common, root, window, document, alerts, confirmations, timers, query, reveal, rate,
    async grade() { await reveal(); await rate() },
    async import(value) { const file = query('input'); file.files = [{ text: async () => JSON.stringify(value) }]; await file.dispatch('change') },
    async export() { await root.all().find(x => x.textContent === '导出进度').click(); return JSON.parse(await blobs.at(-1).text()) },
    async select(id) { await root.all().find(x => x.dataset.series === id).click() },
    async storageEvent() { await window.dispatch('storage', { key: STORE }) },
    async leave() { delete nodes['review-app']; delete nodes['review-cards']; await document.dispatch('pjax:complete'); await tick() }
  }
  return h
}

await test('valid original v1 export imports with identical cards, series and daily counters', async () => {
  const original = await boot()
  await original.grade()
  const value = original.common.state()
  const destination = await boot()
  await destination.import(value)
  assert.deepEqual(destination.common.state(), value)
  assert.equal(destination.alerts.length, 0)
  assert.equal(destination.confirmations.length, 1)
  await destination.grade()
  assert.equal(destination.common.state().daily.fresh, 2)
})

await test('malformed imports leave storage, visible card and exportable memory unchanged', async () => {
  const h = await boot()
  await h.grade()
  const before = await h.export(), raw = h.common.store.get(STORE), front = h.query('.review-card__front').textContent
  const invalid = [
    { v: 1, cards: {}, series: ['dsa'], daily: { date: today(), extra: 0 } },
    { ...before, cards: null }, { ...before, cards: [] }, { ...before, series: [] },
    { ...before, daily: { ...before.daily, fresh: -1 } },
    { ...before, daily: { ...before.daily, fresh: '2' } },
    { ...before, daily: { ...before.daily, date: '2026-02-31' } },
    ...['due', 'state', 'stability', 'reps', 'learning_steps', 'last_review'].map(key => {
      const value = structuredClone(before); value.cards.dsa1[key] = key === 'state' ? 42 : 'invalid'; return value
    })
  ]
  for (const value of invalid) {
    await h.import(value)
    assert.equal(h.common.store.get(STORE), raw)
    assert.equal(h.query('.review-card__front').textContent, front)
    assert.deepEqual(await h.export(), before)
  }
  assert.equal(h.confirmations.length, 0)
  assert.equal(h.alerts.length, invalid.length)
})

await test('stale second tab cannot erase cards or count the same first review twice', async () => {
  const common = shared(), a = await boot({ common }), b = await boot({ common })
  await a.grade(); await a.grade()
  const before = common.state()
  await b.grade()
  assert.deepEqual(common.state(), before)
  assert.equal(common.state().daily.fresh, 2)
})

await test('simultaneous distinct-card saves preserve both records and daily increments without storage events', async () => {
  const common = shared(), a = await boot({ common }), b = await boot({ common })
  await b.select('dsa')
  await Promise.all([a.reveal(), b.reveal()])
  const release = common.locks.hold()
  const first = a.rate(), second = b.rate()
  assert.equal(common.state().daily.fresh, 0)
  release()
  await Promise.all([first, second])
  assert.deepEqual(Object.keys(common.state().cards).sort(), ['dsa1', 'linux1'])
  assert.equal(common.state().daily.fresh, 2)
})

await test('concurrent new-card answers enforce the shared daily limit inside the lock', async () => {
  const common = shared(), initial = empty(); initial.daily.fresh = 19; common.seed(initial)
  const a = await boot({ common }), b = await boot({ common })
  await b.select('linux')
  await Promise.all([a.reveal(), b.reveal()])
  await Promise.all([a.rate(), b.rate()])
  assert.equal(common.state().daily.fresh, 20)
  assert.equal(Object.keys(common.state().cards).length, 1)
})

await test('repeated clicks and keyboard grades while awaiting a lock submit only once', async () => {
  const h = await boot()
  await h.reveal()
  const release = h.common.locks.hold(), saving = h.rate()
  await h.rate()
  await h.document.dispatch('keydown', { key: '4', target: h.root, preventDefault() {} })
  assert.equal(h.common.locks.requests, 1)
  release(); await saving
  assert.equal(h.common.state().cards.dsa1.reps, 1)
  assert.equal(h.common.state().daily.fresh, 1)
})

await test('storage failure stays visible before flipping and after finishing, with exportable progress', async () => {
  const h = await boot({ count: 2, dataSeries: ['dsa'], failWrite: true })
  await h.grade()
  assert.equal(h.query('.review-warn').hidden, false)
  assert.match(h.query('.review-warn').textContent, /导出进度/)
  assert.ok(h.query('.review-show'))
  await h.grade()
  assert.match(h.query('.review-card__front').textContent, /复习做完了/)
  assert.equal(h.query('.review-warn').hidden, false)
  assert.equal(h.common.store.has(STORE), false)
  const value = await h.export()
  assert.equal(Object.keys(value.cards).length, 2)
  assert.equal(value.daily.fresh, 2)
})

await test('missing or rejected locks never write outside the lock and retain an exportable session', async () => {
  for (const mode of ['missing', 'rejected']) {
    const common = shared(); common.locks.reject = mode === 'rejected'
    const h = await boot({ common, useLocks: mode !== 'missing' })
    await h.grade(); await h.grade()
    assert.equal(common.store.has(STORE), false)
    assert.equal((await h.export()).daily.fresh, 2)
    assert.equal(h.query('.review-warn').hidden, false)
    const imported = await h.export()
    imported.daily.extra = 10
    await h.import(imported)
    assert.equal(common.store.has(STORE), false, 'import fallback must not bypass the rejected lock')
    assert.equal((await h.export()).daily.extra, 10)
  }
})

await test('failed import persistence preserves existing stored data and warns about session-only import', async () => {
  const origin = await boot(); await origin.grade()
  const common = shared(); common.seed(empty()); const stored = common.store.get(STORE)
  const h = await boot({ common, failWrite: true })
  await h.import(origin.common.state())
  assert.equal(common.store.get(STORE), stored)
  assert.deepEqual(await h.export(), origin.common.state())
  assert.equal(h.query('.review-warn').hidden, false)
})

await test('corrupted stored progress is not overwritten during session reviews', async () => {
  const common = shared(), broken = '{"v":1,"cards":{},"daily":{}}'; common.store.set(STORE, broken)
  const h = await boot({ common })
  await h.grade()
  assert.equal(common.store.get(STORE), broken)
  assert.equal((await h.export()).daily.fresh, 1)
  assert.equal(h.query('.review-warn').hidden, false)
})

await test('storage events update another mounted page without requiring refresh', async () => {
  const common = shared(), a = await boot({ common }), b = await boot({ common })
  await a.grade()
  await b.storageEvent()
  assert.equal(b.query('.review-card__front').textContent, 'linux1')
  assert.deepEqual(await b.export(), common.state())
})

await test('failed PJAX navigation keeps the same review page interactive', async () => {
  const h = await boot()
  await h.document.dispatch('pjax:send')
  await h.document.dispatch('pjax:error')
  await h.document.dispatch('pjax:complete')
  await h.grade()
  assert.equal(h.common.state().daily.fresh, 1)
})

await test('actually leaving the page cancels a waiting transaction and listeners', async () => {
  const h = await boot()
  await h.reveal()
  const release = h.common.locks.hold(), saving = h.rate()
  await h.leave()
  release(); await saving
  assert.equal(h.common.store.has(STORE), false)
  assert.equal(h.document.listeners.get('keydown').size, 0)
  assert.equal(h.window.listeners.get('storage').size, 0)
})


await test('concurrent requests for ten extra cards both increment the latest daily allowance', async () => {
  const common = shared(), value = empty(); value.daily.fresh = 20; common.seed(value)
  const a = await boot({ common }), b = await boot({ common })
  const release = common.locks.hold()
  const first = a.query('.review-more').click(), second = b.query('.review-more').click()
  release(); await Promise.all([first, second])
  assert.equal(common.state().daily.extra, 20)
  assert.equal(common.state().daily.fresh, 20)
})

await test('late import reads after leaving neither mutate progress nor show alerts', async () => {
  for (const rejectRead of [false, true]) {
    const h = await boot()
    await h.grade()
    const stored = h.common.store.get(STORE), file = h.query('input')
    let finish
    file.files = [{ text: () => new Promise((resolve, reject) => { finish = rejectRead ? () => reject(new Error('read failed')) : () => resolve(JSON.stringify(empty())) }) }]
    const importing = file.dispatch('change')
    await h.leave()
    finish(); await importing
    assert.equal(h.common.store.get(STORE), stored)
    assert.equal(h.alerts.length, 0)
    assert.equal(h.confirmations.length, 0)
  }
})
