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
async function boot({ common = shared(), count = 25, useLocks = true, failWrite = false, failRead = false, dataSeries = ['dsa', 'linux'], nanaly = null } = {}) {
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
  if (nanaly) window.NANALY = nanaly
  Object.assign(document, { readyState: 'complete', body: new Element('body'), head: new Element('head'), getElementById: id => nodes[id], createElement: tag => new Element(tag) })
  const context = vm.createContext({
    window, document, console, AbortController, Blob,
    URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:export' }, revokeObjectURL() {} },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer },
    clearTimeout: id => timers.delete(id)
  })
  vm.runInContext(fsrs, context)
  vm.runInContext(source, context)
  await tick(); await tick()
  const query = selector => root.querySelector(selector)
  const reveal = () => query('.review-show').click()
  const rate = () => root.all().find(x => x.dataset.rating === '4').click()
  const h = {
    common, root, window, document, alerts, confirmations, timers, query, reveal, rate,
    async grade() { await reveal(); await rate() },
    async import(value) { const file = query('input'); file.files = [{ text: async () => JSON.stringify(value) }]; await file.dispatch('change') },
    async export() { await root.all().find(x => x.textContent === '导出进度').click(); return JSON.parse(await blobs.at(-1).text()) },
    front: () => root.querySelector('.review-card__front').textContent,
    options: () => root.querySelectorAll('.review-option'),
    async settle() { for (let i = 0; i < 4; i++) await tick() },
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
    { ...before, daily: { ...before.daily, picks: 'dsa1' } },
    { ...before, daily: { ...before.daily, done: { dsa1: 7 } } },
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

await test('two tabs answering the same card at once record it only once', async () => {
  const common = shared(), a = await boot({ common }), b = await boot({ common })
  await Promise.all([a.reveal(), b.reveal()])
  const release = common.locks.hold()
  const first = a.rate(), second = b.rate()
  assert.equal(common.state().daily.fresh, 0)
  release()
  await Promise.all([first, second])
  assert.deepEqual(Object.keys(common.state().cards), ['dsa1'])
  assert.equal(common.state().cards.dsa1.reps, 1)
  assert.equal(common.state().daily.fresh, 1)
  assert.deepEqual(common.state().daily.done, { dsa1: 4 })
})

await test('the first day picks five new points spread across every series', async () => {
  const h = await boot({ dataSeries: ['dsa', 'linux', 'git'] })
  assert.deepEqual(h.common.state().daily.picks, ['dsa1', 'linux1', 'git1', 'dsa2', 'linux2'])
  assert.equal(h.front(), 'dsa1')
  assert.match(h.query('.review-stats').textContent, /今天第 1 个，共 5 个/)
})

await test('with due cards: the three most likely forgotten, then two new ones from the least covered series', async () => {
  const day = 86400000, ago = days => new Date(Date.now() - days * day).toISOString()
  const reviewed = (days, stability) => ({
    due: new Date(Date.now() - (days - stability) * day).toISOString(), stability, difficulty: 5, elapsed_days: 0,
    scheduled_days: stability, reps: 3, lapses: 0, learning_steps: 0, state: 2, last_review: ago(days)
  })
  const common = shared(), value = empty()
  // 还记得的概率只看「隔了多久 / 稳定性」：dsa1 最低，其次 linux1、linux2，linux3 最高，git1 还没到期。
  Object.assign(value.cards, { dsa1: reviewed(30, 5), linux1: reviewed(10, 5), linux2: reviewed(6, 5), linux3: reviewed(20, 20), git1: reviewed(1, 30) })
  common.seed(value)
  const h = await boot({ common, dataSeries: ['dsa', 'linux', 'git'] })
  assert.deepEqual(h.common.state().daily.picks, ['dsa1', 'linux1', 'linux2', 'git2', 'dsa2'])
})

await test('reloading the page keeps the same picks and continues where it stopped', async () => {
  const common = shared(), a = await boot({ common })
  await a.grade()
  const picks = common.state().daily.picks
  const b = await boot({ common })
  assert.deepEqual(common.state().daily.picks, picks)
  assert.equal(b.front(), picks[1])
})

await test('after the five points, 再来一组 adds five more that were not picked today', async () => {
  const h = await boot({ dataSeries: ['dsa', 'linux', 'git'] })
  for (let i = 0; i < 5; i++) await h.grade()
  assert.match(h.front(), /5 个知识点都复习完了/)
  await h.query('.review-more').click()
  const { picks, extra } = h.common.state().daily
  assert.equal(picks.length, 10); assert.equal(new Set(picks).size, 10); assert.equal(extra, 1)
  assert.equal(h.front(), picks[5])
})

await test('repeated clicks and keyboard grades while awaiting a lock submit only once', async () => {
  const h = await boot()
  const before = h.common.locks.requests
  await h.reveal()
  const release = h.common.locks.hold(), saving = h.rate()
  await h.rate()
  await h.document.dispatch('keydown', { key: '4', target: h.root, preventDefault() {} })
  assert.equal(h.common.locks.requests, before + 1)
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
  assert.match(h.query('.review-card__front').textContent, /复习完了/)
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
  const stored = h.common.store.get(STORE)
  await h.reveal()
  const release = h.common.locks.hold(), saving = h.rate()
  await h.leave()
  release(); await saving
  assert.equal(h.common.store.get(STORE), stored)
  assert.deepEqual(h.common.state().cards, {})
  assert.equal(h.document.listeners.get('keydown').size, 0)
  assert.equal(h.window.listeners.get('storage').size, 0)
  assert.equal(h.window.listeners.get('nanaly:unlocked').size, 0)
})


await test('再来一组 clicked in two tabs at once adds two distinct rounds', async () => {
  const common = shared(), a = await boot({ common })
  for (let i = 0; i < 5; i++) await a.grade()
  const b = await boot({ common })
  const release = common.locks.hold()
  const first = a.query('.review-more').click(), second = b.query('.review-more').click()
  release(); await Promise.all([first, second])
  const { picks, extra } = common.state().daily
  assert.equal(extra, 2)
  assert.equal(picks.length, 15)
  assert.equal(new Set(picks).size, 15)
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

// ---- 娜娜莉出题 ----
// 假的娜娜莉按请求里的题型回一道题，题面里带着卡片原来的正面，测试据此认出是哪张卡。
function fakeNanaly({ ready = true, reply } = {}) {
  const nanaly = {
    ready, calls: [], unlocks: 0,
    canComplete: () => nanaly.ready,
    requestUnlock: () => { nanaly.unlocks++ },
    async complete({ system, user, json }) {
      assert.match(system, /只返回一个 JSON 对象/)
      assert.equal(json, true)
      const request = JSON.parse(user)
      nanaly.calls.push(request)
      if (reply) return reply(request)
      if (request.type === 'choice') return JSON.stringify({ question: 'Q:' + request.front, options: ['RIGHT', 'W1', 'W2', 'W3'], explain: '因为' })
      if (request.type === 'judge') return '```json\n' + JSON.stringify({ statement: 'S:' + request.front, answer: request.want === '对的说法', explain: '解析' }) + '\n```'
      return JSON.stringify({ question: 'A:' + request.front, answer: '参考答案', explain: '' })
    }
  }
  return nanaly
}
const optionText = (h, text) => h.options().find(x => x.textContent.endsWith(text))

await test('generated choice and judge questions are judged by the page; the grade lands on 下一题', async () => {
  const nanaly = fakeNanaly(), h = await boot({ nanaly, dataSeries: ['dsa', 'linux', 'git'] })
  await h.settle()
  // 今天的 5 个一打开就都去出题了，每张卡只问一次。
  assert.deepEqual(nanaly.calls.map(call => call.front), ['dsa1', 'linux1', 'git1', 'dsa2', 'linux2'])
  const seen = new Set(), expected = {}
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 5; i++) {
      await h.settle()
      const id = h.front().split(':')[1], request = nanaly.calls.find(call => call.front === id)
      seen.add(request.type)
      if (request.type === 'short') {
        assert.equal(h.options().length, 0)
        await h.reveal()
        assert.match(h.query('.review-card__answer').textContent, /参考答案/)
        await h.rate(); expected[id] = 4
        continue
      }
      assert.equal(h.options().length, request.type === 'choice' ? 4 : 2)
      assert.equal(h.query('.review-show'), null, 'auto-judged questions have nothing to flip')
      const wrong = !seen.has('wrong-' + request.type)
      const target = request.type === 'choice' ? (wrong ? 'W2' : 'RIGHT') : (((request.want === '对的说法') !== wrong) ? '对' : '错')
      await optionText(h, target).click()
      const verdict = h.query('.review-card__verdict')
      assert.equal(verdict.dataset.state, wrong ? 'wrong' : 'right')
      if (wrong && request.type === 'choice') assert.match(verdict.textContent, new RegExp(`正确答案是 ${optionText(h, 'RIGHT').textContent[0]}`))
      assert.match(h.query('.review-card__origin').textContent, new RegExp('卡片原文' + id + '答案'))
      assert.equal(h.common.state().daily.done[id], undefined, 'nothing is recorded before 下一题')
      assert.equal(h.query('.review-next').dataset.rating, wrong ? '1' : '3')
      if (!wrong) assert.ok(h.root.all().find(x => x.dataset.rating === '2' && x.textContent.startsWith('蒙对的')))
      seen.add('wrong-' + request.type)
      await h.query('.review-next').click(); expected[id] = wrong ? 1 : 3
    }
    await h.query('.review-more').click()
  }
  assert.ok(['choice', 'judge', 'short', 'wrong-choice', 'wrong-judge'].every(type => seen.has(type)), [...seen].join())
  assert.deepEqual(h.common.state().daily.done, expected)
})

await test('keyboard: 1–4 answer a choice, 1/2 answer a judge, Enter moves on', async () => {
  const nanaly = fakeNanaly(), h = await boot({ nanaly, dataSeries: ['dsa', 'linux', 'git'] })
  const press = key => h.document.dispatch('keydown', { key, target: h.root, preventDefault() {} })
  const driven = new Set()
  for (let i = 0; i < 15 && driven.size < 2; i++) {
    if (i && i % 5 === 0) await h.query('.review-more').click()
    await h.settle()
    const id = h.front().split(':')[1], request = nanaly.calls.find(call => call.front === id)
    if (request.type === 'short') { await press(' '); await press('3'); continue }
    const key = request.type === 'choice' ? h.options().findIndex(x => x.textContent.endsWith('RIGHT')) + 1 : (request.want === '对的说法' ? 1 : 2)
    await press(String(key))
    assert.equal(h.query('.review-card__verdict').dataset.state, 'right')
    await press('Enter')
    assert.equal(h.common.state().daily.done[id], 3)
    driven.add(request.type)
  }
  assert.deepEqual([...driven].sort(), ['choice', 'judge'])
})

await test('a malformed answer from the model falls back to the original card with a note', async () => {
  const nanaly = fakeNanaly({ reply: () => '我想想喵……' }), h = await boot({ nanaly })
  await h.settle()
  assert.equal(h.front(), 'dsa1')
  assert.ok(h.query('.review-show'))
  assert.match(h.query('.review-ai').textContent, /没出成新题（模型给的题格式不对）/)
  await h.grade()
  assert.equal(h.common.state().daily.done.dsa1, 4)
})

await test('这题有问题 swaps back to the original card for good', async () => {
  const nanaly = fakeNanaly(), common = shared(), h = await boot({ nanaly, common })
  await h.settle()
  const id = h.front().split(':')[1]
  if (h.options().length) await h.options()[0].click()
  else await h.reveal()
  await h.query('.review-flag').click()
  assert.equal(h.front(), id)
  assert.ok(h.query('.review-show'))
  const again = await boot({ nanaly, common })
  await again.settle()
  assert.equal(again.front(), id, 'a flagged question stays original after reload')
  await h.grade()
  assert.equal(common.state().daily.done[id], 4)
})

await test('generated questions are cached for the day and not requested again after reload', async () => {
  const nanaly = fakeNanaly(), common = shared(), a = await boot({ nanaly, common })
  await a.settle()
  assert.equal(nanaly.calls.length, 5)
  const b = await boot({ nanaly, common })
  await b.settle()
  assert.equal(nanaly.calls.length, 5)
  assert.match(b.front(), /^[QSA]:dsa1$/)
})

await test('locked: original card with an unlock button; unlocking on the page starts generating', async () => {
  const nanaly = fakeNanaly({ ready: false }), h = await boot({ nanaly })
  await h.settle()
  assert.equal(h.front(), 'dsa1')
  assert.equal(nanaly.calls.length, 0)
  await h.query('.review-unlock').click()
  assert.equal(nanaly.unlocks, 1)
  nanaly.ready = true
  await h.window.dispatch('nanaly:unlocked')
  await h.settle()
  assert.match(h.front(), /^[QSA]:dsa1$/)
  assert.equal(nanaly.calls.length, 5)
})

await test('a slow model can be skipped: 不等了 shows the original card right away', async () => {
  let finish
  const nanaly = fakeNanaly({ reply: () => new Promise(resolve => { finish = resolve }) }), h = await boot({ nanaly })
  await h.settle()
  assert.match(h.front(), /娜娜莉正在出题/)
  await h.query('.review-skip').click()
  assert.equal(h.front(), 'dsa1')
  finish('{}'); await h.settle()
  assert.equal(h.front(), 'dsa1', 'a late answer does not replace the card being looked at')
})

await test('intervals shorter than a day read 明天, because a point is asked at most once a day', async () => {
  const h = await boot()
  await h.reveal()
  const labels = h.root.all().filter(x => x.className === 'review-grade').map(x => x.children[1].textContent)
  assert.equal(labels.length, 4)
  assert.deepEqual(labels.slice(0, 3), ['明天', '明天', '明天'])
  assert.match(labels[3], /^(明天|\d+ 天后)$/)
})

await test('a judge question is graded by the answer the model filled in, and one without an answer is not used', async () => {
  // 要「对的说法」，模型却写了句错的并填 answer=false：按 false 判。
  const flipped = fakeNanaly({ reply: request => request.type === 'judge'
    ? JSON.stringify({ statement: 'S:' + request.front, answer: request.want !== '对的说法', explain: '' })
    : JSON.stringify({ question: 'Q:' + request.front, options: ['RIGHT', 'W1', 'W2', 'W3'], explain: '' }) })
  const h = await boot({ nanaly: flipped, dataSeries: ['dsa', 'linux', 'git'] })
  let judged = 0
  for (let i = 0; i < 10 && !judged; i++) {
    if (i === 5) await h.query('.review-more').click()
    await h.settle()
    const id = h.front().split(':')[1], request = flipped.calls.find(call => call.front === id)
    if (request?.type !== 'judge') { if (h.options().length) await optionText(h, 'RIGHT').click(); else await h.reveal(); await h.query(h.query('.review-next') ? '.review-next' : '.review-grade').click(); continue }
    await optionText(h, request.want === '对的说法' ? '错' : '对').click()
    assert.equal(h.query('.review-card__verdict').dataset.state, 'right')
    judged++
  }
  assert.equal(judged, 1)
  const missing = fakeNanaly({ reply: request => JSON.stringify(request.type === 'judge' ? { statement: 'S:' + request.front, explain: '' }
    : request.type === 'choice' ? { question: 'Q:' + request.front, options: ['RIGHT', 'W1', 'W2', 'W3'] } : { question: 'A:' + request.front, answer: 'x' }) })
  const m = await boot({ nanaly: missing, dataSeries: ['dsa', 'linux', 'git'] })
  for (let i = 0; i < 10; i++) {
    if (i === 5) await m.query('.review-more').click()
    await m.settle()
    const front = m.front(), request = missing.calls.find(call => front.endsWith(call.front))
    if (request.type === 'judge') { assert.equal(front, request.front, 'no answer → original card'); return }
    if (m.options().length) await optionText(m, 'RIGHT').click(); else await m.reveal()
    await m.query(m.query('.review-next') ? '.review-next' : '.review-grade').click()
  }
  assert.fail('no judge question among ten picks')
})
