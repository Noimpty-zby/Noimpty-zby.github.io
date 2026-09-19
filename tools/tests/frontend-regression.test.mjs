import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'

const source = name => readFileSync(new URL('../../source/js/' + name + '.js', import.meta.url), 'utf8')
const noop = () => {}
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const storage = initial => {
  const values = new Map(Object.entries(initial || {}))
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
}
const jsonResponse = value => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) })
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase()
    this.dataset = {}
    this.events = new Map()
    this.nodes = new Map()
    this.children = []
    this.classes = new Set()
    this.classList = {
      add: x => this.classes.add(x), remove: x => this.classes.delete(x),
      toggle: (x, on) => on ? this.classes.add(x) : this.classes.delete(x)
    }
    this.style = { setProperty: noop }
    this.value = ''
    this.innerHTML = ''
    this.textContent = ''
  }
  addEventListener(event, fn) { this.events.set(event, fn) }
  removeEventListener(event) { this.events.delete(event) }
  emit(event, args = {}) { return this.events.get(event)?.(args) }
  querySelector(selector) { return this.nodes.get(selector) || null }
  querySelectorAll() { return [] }
  setAttribute(key, value) { this[key] = value }
  hasAttribute(key) { return !!this[key] }
  appendChild(node) { this.children.push(node); return node }
  replaceWith(node) { this.replacement = node }
  focus() {}
  select() {}
  remove() {}
}
let passed = 0
const check = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { process.exitCode = 1; console.error('  ✗ ' + name, e) }
}

const DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
const task = (id, text = id, extra = {}) => ({ id, text, done: false, ...extra })
const schedule = (tasks, updatedAt = '') => ({ updatedAt, days: { [DAY]: tasks } })
const KEY = 'noimpty-schedule-cache-v1'
const bootSchedule = ({ remote = schedule([]), cached, siteFetch, githubFetch, gate, study, noStorage = false, decrypt } = {}) => {
  const node = new Element()
  node.nodes.set('[data-role="status"]', new Element())
  const store = storage(cached ? { [KEY]: JSON.stringify(cached) } : {})
  if (noStorage) store.setItem = () => { throw new Error('quota') }
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (String(url).startsWith('/schedule/')) return siteFetch ? siteFetch(url, init) : jsonResponse(remote)
    return githubFetch ? githubFetch(url, init) : jsonResponse({})
  }
  const win = {
    addEventListener: noop, setTimeout: () => 0, clearTimeout: noop,
    localStorage: store, NOIMPTY_GATE: gate, NOIMPTY_STUDY: study,
    NOIMPTY_SEARCH: { decryptPayload: decrypt },
    NANALY: { githubToken: () => 'test-token' }
  }
  const ctx = vm.createContext({
    window: win, document: { getElementById: () => node, createElement: tag => new Element(tag) },
    localStorage: store, fetch, setTimeout: () => 0, clearTimeout: noop, console, URL,
    Intl, Date, TextEncoder, TextDecoder, btoa, atob, AbortSignal
  })
  vm.runInContext(source('schedule'), ctx)
  const click = (act, extra = {}) => {
    const button = { dataset: { act, ...extra } }
    node.emit('click', { target: { closest: selector => selector === '[data-act]' ? button : null } })
  }
  const add = text => node.emit('submit', {
    preventDefault: noop,
    target: {
      matches: selector => selector === '[data-role="add"]',
      querySelector: () => ({ value: text })
    }
  })
  return { api: win.NOIMPTY_SCHEDULE, node, store, calls, click, add }
}

await check('未保存草稿不因远端时间戳更新而丢失，删除和远端新增都正确合并', async () => {
  const base = schedule([task('a'), task('b')]).days
  const local = { ...schedule([task('a'), task('local')], '2020'), _dirty: true, _base: base }
  const remote = schedule([task('a', 'a', { done: true }), task('b'), task('remote')], '2030')
  const b = bootSchedule({ remote, cached: local })
  await flush()
  const out = b.api.data().days[DAY]
  assert.deepEqual(Array.from(out, t => t.id).sort(), ['a', 'local', 'remote'])
  assert.equal(out.find(t => t.id === 'a').done, true)
  assert.equal(b.api.dirty(), true)
})

await check('提交等待期间的新任务保留为未保存草稿，下一次提交能完整保存', async () => {
  const pending = deferred()
  let persisted = schedule([task('base')]), writes = 0
  const b = bootSchedule({
    remote: persisted,
    githubFetch: async (url, init) => {
      if (!init?.method) return jsonResponse({ encoding: 'base64', content: btoa(JSON.stringify(persisted)), sha: 'test' })
      persisted = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(JSON.parse(init.body).content), c => c.charCodeAt(0))))
      if (++writes === 1) await pending.promise
      return jsonResponse({})
    }
  })
  await flush()
  b.add('first')
  b.click('save')
  await flush()
  b.add('second')
  pending.resolve()
  await flush()
  assert.equal(b.api.dirty(), true)
  assert.deepEqual(Array.from(b.api.data().days[DAY], t => t.text), ['base', 'first', 'second'])
  assert.deepEqual(persisted.days[DAY].map(t => t.text), ['base', 'first'])
  b.click('save')
  await flush()
  assert.equal(b.api.dirty(), false)
  assert.deepEqual(persisted.days[DAY].map(t => t.text), ['base', 'first', 'second'])
})

await check('存储配额用尽时重新加载也保留内存草稿', async () => {
  const b = bootSchedule({ remote: schedule([task('a')]), noStorage: true })
  await flush()
  b.add('still here')
  await b.api.reload()
  assert.equal(b.api.dirty(), true)
  assert.equal(b.api.data().days[DAY].at(-1).text, 'still here')
})

await check('重复载入共享同一个请求，载入前提交不会被稍后的响应覆盖', async () => {
  const pending = deferred()
  const b = bootSchedule({ siteFetch: () => pending.promise })
  b.add('too early')
  const again = b.api.reload()
  assert.equal(b.calls.length, 1)
  pending.resolve(jsonResponse(schedule([task('existing')])))
  await again
  assert.deepEqual(Array.from(b.api.data().days[DAY], t => t.id), ['existing'])
  assert.equal(b.api.dirty(), false)
})

await check('不存在的日期缓存不会作为草稿覆盖有效远端日程', async () => {
  for (const day of ['2026-02-31', '2025-02-29', '2026-13-01']) {
    const cached = { days: { [day]: [task('bad-cache')] }, _dirty: true }
    const b = bootSchedule({ remote: schedule([task('remote')]), cached })
    await flush()
    assert.equal(Object.hasOwn(b.api.data().days, day), false)
    assert.equal(b.api.data().days[DAY][0].id, 'remote')
    assert.equal(b.api.dirty(), false)
  }
})

await check('不存在的远端日期和数组任务被拒绝，保留有效离线草稿', async () => {
  for (const remote of [{ days: { '2026-02-31': [task('bad-date')] } }, { days: { [DAY]: [[]] } }]) {
    const cached = { ...schedule([task('keep-draft')]), _dirty: true, _base: null }
    const b = bootSchedule({ remote, cached })
    await flush()
    assert.equal(await b.api.reload(), 'cache-offline')
    assert.equal(b.api.data().days[DAY][0].id, 'keep-draft')
    assert.equal(b.api.dirty(), true)
  }
})

await check('真实闰日可载入，坏日期且无缓存时明确载入失败', async () => {
  const valid = bootSchedule({ remote: { days: { '2024-02-29': [task('leap-day')] } } })
  await flush()
  assert.equal(valid.api.data().days['2024-02-29'][0].id, 'leap-day')
  const invalid = bootSchedule({ remote: { days: { '2026-02-31': [task('bad')] } } })
  await flush()
  assert.equal(await invalid.api.reload(), 'failed')
  assert.equal(Object.keys(invalid.api.data().days).length, 0)
})

await check('加密日程通过共享解密器读取', async () => {
  let decryptions = 0
  const b = bootSchedule({
    remote: { v: 1, alg: 'AES-GCM', data: 'ciphertext' },
    decrypt: async envelope => { decryptions++; assert.equal(envelope.data, 'ciphertext'); return JSON.stringify(schedule([task('secret')])) }
  })
  await flush()
  assert.equal(decryptions, 1)
  assert.equal(b.api.data().days[DAY][0].id, 'secret')
})

await check('暗号门锁定时不请求日程，也不展示缓存中的私有任务', async () => {
  const b = bootSchedule({ gate: { unlocked: () => false }, cached: { ...schedule([task('secret')]), _dirty: true } })
  await flush()
  assert.equal(b.calls.length, 0)
  assert.equal(Object.keys(b.api.data().days).length, 0)
  assert.ok(!b.node.innerHTML.includes('secret'))
})

await check('损坏远端数据不成为可保存基准，离线有效缓存仍能恢复', async () => {
  for (const remote of [null, [], { days: [] }, { days: { [DAY]: [null] } }, schedule([task('a'), task('a')])]) {
    const b = bootSchedule({ remote })
    await flush()
    assert.equal(b.api.baseline(), null)
    assert.ok(b.node.querySelector('[data-role="status"]').textContent.includes('读不到仓库'))
  }
  const cached = { ...schedule([task('draft')]), _dirty: true, _base: schedule([]).days }
  const b = bootSchedule({ cached, siteFetch: async () => { throw new Error('offline') } })
  await flush()
  assert.equal(b.api.data().days[DAY][0].id, 'draft')
  assert.equal(b.api.dirty(), true)
})

await check('GitHub 内容形状损坏时不发送 PUT，草稿保留', async () => {
  const b = bootSchedule({ remote: schedule([]), githubFetch: async () => jsonResponse({ encoding: 'base64', content: btoa('{"days":[]}'), sha: 'bad' }) })
  await flush()
  b.add('draft')
  b.click('save')
  await flush()
  assert.equal(b.calls.filter(c => c.init?.method === 'PUT').length, 0)
  assert.equal(b.api.dirty(), true)
  assert.ok(b.node.querySelector('[data-role="status"]').textContent.includes('读不出仓库'))
})

await check('课程数据部分缺失不再令整页白屏', async () => {
  const b = bootSchedule({ study: { courses: [null, { title: 'partial', leaf: 'P' }], posts: [null, {}] } })
  await flush()
  assert.ok(b.node.innerHTML.includes('sch-nextlist'))
})

await check('完成条件切换到课程时创建下拉框，切回关键词时创建文本框', async () => {
  const b = bootSchedule({ study: { courses: [{ title: 'Go', leaf: 'Go' }], posts: [] } })
  await flush()
  let input = new Element('input')
  input.value = 'old keyword'
  const form = { querySelector: () => input }
  const type = { matches: () => true, closest: () => form, value: 'section' }
  b.node.emit('change', { target: type })
  input = input.replacement
  assert.equal(input.tagName, 'SELECT')
  assert.equal(input.children[0].value, 'Go')
  type.value = 'post'
  b.node.emit('change', { target: type })
  assert.equal(input.replacement.tagName, 'INPUT')
  assert.equal(input.replacement.value, '')
})

await check('手工撤销自动勾选保留自动完成标记，供后台避免再次勾选', async () => {
  const b = bootSchedule({ remote: schedule([task('a', 'a', { done: true, autoAt: '2026-01-01', autoWhy: 'evidence' })]) })
  await flush()
  b.click('toggle', { id: 'a', day: DAY })
  assert.equal(b.api.data().days[DAY][0].done, false)
  assert.equal(b.api.data().days[DAY][0].autoAt, '2026-01-01')
})

await check('更换完成条件会解除旧自动完成撤销标记，原样保存不会解除', async () => {
  const b = bootSchedule({ remote: schedule([task('a', 'a', {
    done: false, when: { type: 'reply', match: 'old' }, autoAt: '2026-01-01', autoWhy: 'old evidence'
  })]) })
  await flush()
  const submitCondition = (type, match) => b.node.emit('submit', {
    preventDefault: noop,
    target: {
      dataset: { id: 'a' }, matches: selector => selector === '[data-role="condform"]',
      querySelector: selector => ({ value: selector === '[data-role="ctype"]' ? type : match })
    }
  })
  submitCondition('reply', 'old')
  assert.equal(b.api.data().days[DAY][0].autoAt, '2026-01-01')
  submitCondition('reply', 'new')
  const next = b.api.data().days[DAY][0]
  assert.equal(next.when.match, 'new')
  assert.equal(next.done, false)
  assert.equal(Object.hasOwn(next, 'autoAt'), false)
  assert.equal(Object.hasOwn(next, 'autoWhy'), false)
})

const bootMusic = state => {
  const player = new Element('aside')
  for (const selector of ['audio', '.noimpty-music-title', '.noimpty-music-artist', '.noimpty-music-status', '.noimpty-music-current', '.noimpty-music-duration', '.noimpty-music-progress', '.noimpty-music-volume input', '.noimpty-music-volume i', '[data-action="play"]', '[data-action="shuffle"]']) player.nodes.set(selector, new Element())
  player.nodes.get('[data-action="play"]').nodes.set('i', new Element('i'))
  const audio = player.nodes.get('audio')
  Object.assign(audio, { paused: true, ended: false, currentTime: 0, duration: 180, load() { this.paused = true; this.currentTime = 0 }, pause() { this.paused = true; this.emit('pause') }, play() { this.paused = false; this.emit('play'); return Promise.resolve() } })
  const store = storage({ 'noimpty-music-player-v1': JSON.stringify(state) })
  const win = { localStorage: store, addEventListener: noop }
  vm.runInNewContext(source('music-player'), { window: win, document: { createElement: () => player, body: new Element() }, navigator: {}, console })
  return { api: win.NOIMPTY_MUSIC_PLAYER, player, audio, state: () => JSON.parse(store.getItem('noimpty-music-player-v1')) }
}

await check('播放器缓存为 null、数组、标量或损坏 JSON 时仍能初始化', async () => {
  for (const value of [null, [], 3, 'broken']) assert.ok(bootMusic(value).api)
})

await check('元数据尚未到达时保存状态不清零恢复进度和续播意图', async () => {
  const b = bootMusic({ index: 2, currentTime: 55, playing: true })
  assert.equal(b.state().currentTime, 55)
  assert.equal(b.state().playing, true)
  b.audio.emit('loadedmetadata')
  await flush()
  assert.equal(b.audio.currentTime, 55)
  assert.equal(b.audio.paused, false)
})

await check('连续切歌不会丢失续播意图，旧 play 拒绝不会污染新曲状态', async () => {
  const b = bootMusic({ index: 0, playing: true, shuffle: false })
  b.api.next()
  b.api.next()
  assert.equal(b.state().index, 2)
  assert.equal(b.state().playing, true)
  const stale = deferred()
  b.audio.play = () => stale.promise
  const play = b.api.play()
  b.api.next()
  stale.reject(new Error('aborted old load'))
  await play
  assert.equal(b.state().playing, true)
  assert.ok(!b.player.nodes.get('.noimpty-music-status').textContent.includes('点击播放'))
})

await check('元数据到达前暂停能取消自动恢复', async () => {
  const b = bootMusic({ playing: true })
  b.api.pause()
  b.audio.emit('loadedmetadata')
  await flush()
  assert.equal(b.audio.paused, true)
  assert.equal(b.state().playing, false)
})

const bootGate = (session = {}) => {
  const doc = new Element()
  doc.readyState = 'loading'
  doc.documentElement = new Element()
  const win = {
    NOIMPTY_PRIVACY: { entries: [], publicPaths: ['/'], passHash: 'hash-now' },
    sessionStorage: storage(session), location: { origin: 'https://site.test', pathname: '/', search: '' },
    addEventListener: noop
  }
  vm.runInNewContext(source('privacy-gate'), { window: win, document: doc, URL })
  const click = (href, props = {}, anchorProps = {}) => {
    doc.documentElement.classes.clear()
    const anchor = { href, target: '', hasAttribute: () => false, ...anchorProps }
    doc.emit('click', { button: 0, target: { closest: () => anchor }, ...props })
    return doc.documentElement.classes.has('noimpty-private-locked')
  }
  return { api: win.NOIMPTY_GATE, click }
}

await check('外链、新标签、下载、锚点和取消的点击不锁住当前页面', async () => {
  const b = bootGate()
  assert.equal(b.click('https://other.test/private/'), false)
  assert.equal(b.click('mailto:someone@example.test'), false)
  assert.equal(b.click('/private/', { ctrlKey: true }), false)
  assert.equal(b.click('/private/', {}, { target: '_blank' }), false)
  assert.equal(b.click('/private/', {}, { hasAttribute: () => true }), false)
  assert.equal(b.click('/#anchor'), false)
  assert.equal(b.click('/private/', { defaultPrevented: true }), false)
  assert.equal(b.click('/private/'), true)
})

await check('暗号配置轮换后旧会话失效，残留暗号不再交给搜索', async () => {
  const b = bootGate({ 'noimpty-private-unlocked': 'true', 'noimpty-private-pass': 'old', 'noimpty-private-hash': 'hash-old' })
  assert.equal(b.api.unlocked(), false)
  assert.equal(b.api.passphrase(), '')
})

const XML = '<search><entry><title>Test</title><url>/a/</url><content>body</content></entry></search>'
const bootSearch = fetchImpl => {
  const calls = []
  const win = {
    location: { origin: 'https://site.test' }, NOIMPTY_GATE: { passphrase: () => 'test' },
    fetch: (url, init) => { calls.push({ url, init }); return fetchImpl ? fetchImpl(url, init) : Promise.resolve({ ok: true, text: async () => XML }) }
  }
  const ctx = vm.createContext({
    window: win, URL, Response, DOMException, TextEncoder, TextDecoder, crypto: webcrypto, atob, AbortController, setTimeout, clearTimeout,
    DOMParser: class {
      parseFromString(text) {
        return {
          querySelector: selector => selector === 'parsererror' && !text.includes('<search>') ? {} : null,
          querySelectorAll: () => text.includes('<entry>') ? [{ querySelector: tag => ({ textContent: tag === 'title' ? 'Test' : tag === 'url' ? '/a/' : 'body' }) }] : []
        }
      }
    }
  })
  vm.runInContext(source('noimpty-search'), ctx)
  return { win, calls, ctx }
}

await check('搜索只拦截同源 GET；URL 对象可用，跨域同名文件和 POST 原样通过', async () => {
  const b = bootSearch()
  assert.equal(b.win.NOIMPTY_SEARCH.isIndexUrl('https://foreign.test/search.xml'), false)
  await b.win.fetch(new URL('https://site.test/search.xml'))
  assert.equal(b.calls[0].url, '/search.xml')
  await b.win.fetch('https://foreign.test/search.xml')
  await b.win.fetch('/search.xml', { method: 'POST' })
  assert.equal(b.calls.length, 3)
  assert.equal(b.calls[2].init.method, 'POST')
})

await check('搜索支持 AbortSignal，取消一个调用不影响共享加载', async () => {
  const pending = deferred()
  const b = bootSearch(() => pending.promise)
  const controller = new AbortController()
  const cancelled = b.win.fetch('/search.xml', { signal: controller.signal })
  const normal = b.win.fetch('/search.xml')
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  pending.resolve({ ok: true, text: async () => XML })
  assert.equal(await (await normal).text(), XML)
  assert.equal(b.calls.length, 1)
})

await check('reset 使在途搜索失效，旧响应不能覆盖下一轮缓存', async () => {
  const pending = deferred()
  let round = 0
  const b = bootSearch(() => ++round === 1 ? pending.promise : Promise.resolve({ ok: true, text: async () => XML }))
  const stale = b.win.NOIMPTY_SEARCH.loadCorpus()
  const rejected = assert.rejects(stale, /SEARCH_RESET/)
  b.win.NOIMPTY_SEARCH.reset()
  await b.win.NOIMPTY_SEARCH.loadCorpus()
  pending.resolve({ ok: true, text: async () => XML })
  await rejected
  assert.equal((await b.win.NOIMPTY_SEARCH.loadCorpus()).length, 1)
  assert.equal(round, 2)
})

await check('搜索脚本重复执行保持原 API 和 fetch，避免重复补丁', async () => {
  const b = bootSearch()
  const api = b.win.NOIMPTY_SEARCH, fetch = b.win.fetch
  vm.runInContext(source('noimpty-search'), b.ctx)
  assert.equal(b.win.NOIMPTY_SEARCH, api)
  assert.equal(b.win.fetch, fetch)
})

await check('行动日志 null 数据产生明确格式错误，并发调用共享读取', async () => {
  const b = bootSearch(async () => ({ ok: true, text: async () => 'null' }))
  await assert.rejects(b.win.NOIMPTY_SEARCH.loadJournal(), /SEARCH_BAD_FORMAT/)
  const c = bootSearch(async () => ({ ok: true, text: async () => '{"entries":[{"id":"log","at":"9-19 10:00","who":"reply","what":"done"}]}' }))
  const rows = await Promise.all([c.win.NOIMPTY_SEARCH.loadJournal(), c.win.NOIMPTY_SEARCH.loadJournal()])
  assert.equal(c.calls.length, 1)
  assert.equal(rows[0][0].id, 'log')
})


await check('无基准的离线草稿在恢复联网后只增加任务，不删除远端原有任务', async () => {
  const cached = { ...schedule([task('draft')]), _dirty: true, _base: null }
  const b = bootSchedule({ cached, remote: schedule([task('remote')]) })
  await flush()
  assert.deepEqual(Array.from(b.api.data().days[DAY], t => t.id).sort(), ['draft', 'remote'])
  assert.equal(b.api.baseline()[DAY][0].id, 'remote')
  assert.equal(b.api.dirty(), true)
})

const bootToc = ({ reduce = false, withScrollTo = true } = {}) => {
  const frames = new Map(), timers = new Map(), observers = [], scrolls = []
  let sequence = 0
  const events = () => {
    const handlers = new Map()
    return {
      handlers,
      addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn) },
      removeEventListener(type, fn) { handlers.get(type)?.delete(fn) },
      emit(type) { for (const fn of [...handlers.get(type) || []]) fn() },
      count(type) { return handlers.get(type)?.size || 0 }
    }
  }
  const motion = Object.assign(events(), { matches: reduce })
  const win = Object.assign(events(), {
    innerHeight: 900,
    matchMedia: () => motion,
    requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id)
  })
  const page = () => {
    const article = new Element(), toc = new Element(), image = new Element()
    const headings = [0, 500].map((top, index) => ({ id: `标题-${index}`, top, getBoundingClientRect() { return { top: this.top } } }))
    const parents = headings.map(() => Object.assign(new Element('li'), { parentElement: toc, matches: selector => selector === 'li' }))
    const links = headings.map((heading, index) => {
      const link = new Element('a')
      link.parentElement = parents[index]
      link.getAttribute = () => '#' + encodeURIComponent(heading.id)
      link.contentTop = 400 + index * 80
      link.getBoundingClientRect = () => ({ top: 100 + link.contentTop - toc.scrollTop, bottom: 120 + link.contentTop - toc.scrollTop })
      link.offsetTop = 5 // relative to a positioned nested ancestor, not the TOC
      return link
    })
    article.querySelectorAll = selector => selector === 'img' ? [image] : headings
    toc.querySelectorAll = selector => selector === '.toc-link' ? links
      : (selector === '.toc-link.active' ? links : [...links, ...parents]).filter(node => node.classes.has('active'))
    toc.getBoundingClientRect = () => ({ top: 100, bottom: 300 })
    toc.scrollTop = 100
    toc.clientHeight = 200
    toc.scrollHeight = 1000
    if (withScrollTo) toc.scrollTo = value => scrolls.push({ ...value })
    return { article, toc, links, headings, image, parents }
  }
  let current = page()
  const document = Object.assign(events(), {
    readyState: 'complete',
    getElementById: () => current?.article,
    querySelector: () => current?.toc
  })
  const ctx = vm.createContext({ window: win, document, ResizeObserver: class {
    constructor(fn) { this.fn = fn; this.disconnected = false; observers.push(this) }
    observe() {}
    disconnect() { this.disconnected = true }
  } })
  const execute = () => vm.runInContext(source('toc-sync'), ctx)
  execute()
  return {
    win, motion, frames, timers, observers, scrolls, execute,
    get page() { return current },
    nextPage() { current = page(); return current },
    noArticle() { current = null },
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()) },
    timer(delay) { const callbacks = [...timers].filter(([, item]) => item.delay === delay); callbacks.forEach(([id, item]) => { timers.delete(id); item.fn() }) }
  }
}

await check('目录使用可视位置，原生平滑滚动途中不会被同一目标反复重启', async () => {
  const b = bootToc()
  b.frame()
  assert.equal(b.scrolls[0].top, 316)
  assert.equal(b.scrolls[0].behavior, 'smooth')
  for (const position of [105, 125, 150, 170]) {
    b.page.toc.scrollTop = position
    for (let i = 0; i < 8; i++) b.win.emit('scroll')
    assert.equal(b.frames.size, 1)
    b.frame()
  }
  b.timer(140); b.frame()
  assert.equal(b.scrolls.length, 1, 'the stable destination must not restart the browser animation')
  assert.equal(b.page.links[0].classes.has('active'), true)
  assert.equal(b.page.parents[0].classes.has('active'), true)
})

await check('目录目标变化仍高亮并滚动，主题延迟改写后恢复正确目录', async () => {
  const b = bootToc()
  b.frame()
  b.page.headings[1].top = 30
  b.win.emit('scroll'); b.frame()
  assert.equal(b.scrolls.length, 2)
  assert.equal(b.scrolls[1].top, 396)
  assert.equal(b.page.links[1].classes.has('active'), true)
  assert.equal(b.page.parents[1].classes.has('active'), true)
  assert.equal(b.page.links[0].classes.has('active'), false)
  // Simulate Butterfly's asynchronous IntersectionObserver selecting an older heading.
  b.page.links[1].classes.delete('active')
  b.page.links[0].classes.add('active')
  b.timer(140); b.frame()
  assert.equal(b.page.links[1].classes.has('active'), true)
  assert.equal(b.page.links[0].classes.has('active'), false)
  assert.equal(b.scrolls.length, 2)
  b.page.headings.forEach(heading => { heading.top = 500 })
  b.win.emit('scroll'); b.frame()
  assert.equal(b.page.toc.querySelectorAll('.active').length, 0)
})

await check('手机点击目录停在约 70px 时高亮目标章节，不停留在上一节', async () => {
  const b = bootToc()
  b.win.innerHeight = 844
  b.frame()
  assert.equal(b.page.links[0].classes.has('active'), true)
  // Actual final heading position from the 390 x 844 mobile browser.
  b.page.headings[1].top = 69.927
  b.win.emit('scroll'); b.frame()
  b.timer(140); b.frame()
  assert.equal(b.page.links[1].classes.has('active'), true)
  assert.equal(b.page.parents[1].classes.has('active'), true)
  assert.equal(b.page.links[0].classes.has('active'), false)
})

await check('减少动态效果使用即时目录滚动，动态改动偏好会终止正在进行的滚动', async () => {
  const b = bootToc({ reduce: true })
  b.frame()
  assert.equal(b.scrolls[0].behavior, 'instant')
  const c = bootToc()
  c.frame()
  c.page.toc.scrollTop = 250 // the active link is already in view while the trip is unfinished
  c.motion.matches = true
  c.motion.emit('change'); c.frame()
  assert.equal(c.scrolls.length, 2)
  assert.deepEqual(c.scrolls[1], { top: 250, behavior: 'instant' })
  const d = bootToc({ withScrollTo: false })
  d.frame()
  assert.equal(d.page.toc.scrollTop, 316)
})

await check('PJAX 开始即清理旧目录，重复完成和过期回调不会恢复旧监听', async () => {
  const b = bootToc()
  const old = b.page
  const oldFrame = [...b.frames.values()][0]
  b.win.emit('scroll')
  b.win.emit('pjax:send')
  assert.equal(b.win.count('scroll'), 0)
  assert.equal(b.frames.size, 0)
  assert.equal(b.timers.size, 1, 'only the coalesced refresh of the current article remains')
  assert.equal([...b.timers.values()][0].delay, 0)
  assert.equal(old.image.events.has('load'), false)
  assert.equal(b.motion.count('change'), 0)
  assert.equal(b.observers[0].disconnected, true)
  oldFrame(); b.observers[0].fn()
  assert.equal(b.scrolls.length, 0)
  assert.equal(b.frames.size, 0)
  b.nextPage()
  b.win.emit('pjax:complete')
  const staleInitialize = [...b.timers.values()][0].fn
  b.win.emit('pjax:complete')
  assert.equal(b.timers.size, 1)
  b.win.emit('pjax:send')
  staleInitialize()
  assert.equal(b.frames.size, 0)
  assert.equal(b.win.count('scroll'), 0)
  b.win.emit('pjax:complete'); b.timer(0); b.frame()
  assert.equal(b.win.count('scroll'), 1)
  assert.equal(b.observers.length, 2)
  assert.equal(b.page.links[0].classes.has('active'), true)
  assert.equal(old.links[0].classes.has('active'), false)
  b.win.emit('pjax:send'); b.noArticle()
  b.win.emit('pjax:complete'); b.timer(0)
  assert.equal(b.win.count('scroll'), 0)
})

await check('PJAX 失败、取消或没有终止事件时仍恢复当前文章，迟到完成可安全换页', async () => {
  for (const ending of [null, 'pjax:error', 'pjax:abort', 'pjax:cancel']) {
    const b = bootToc()
    b.frame()
    const oldPage = b.page
    const oldObserver = b.observers[0]
    b.win.emit('pjax:send')
    if (ending) b.win.emit(ending)
    // A canceled request is allowed to have no complete event at all.
    b.timer(0); b.frame()
    assert.equal(b.win.count('scroll'), 1, String(ending))
    assert.equal(b.motion.count('change'), 1)
    assert.equal(b.observers.length, 2)
    assert.equal(oldObserver.disconnected, true)
    oldPage.headings[1].top = 30
    b.win.emit('scroll'); b.frame()
    assert.equal(oldPage.links[1].classes.has('active'), true, String(ending))
    assert.equal(oldPage.links[0].classes.has('active'), false)
    oldObserver.fn()
    assert.equal(b.frames.size, 0, 'an observer from before send must remain disposed')

    const resumedObserver = b.observers[1]
    b.nextPage()
    b.win.emit('pjax:complete'); b.timer(0); b.frame()
    assert.equal(resumedObserver.disconnected, true)
    assert.equal(b.win.count('scroll'), 1)
    assert.equal(b.observers.length, 3)
    assert.equal(b.page.links[0].classes.has('active'), true)
    resumedObserver.fn()
    assert.equal(b.frames.size, 0)
  }
})

await check('晚加载布局可重新定位目录，隐藏移动目录不滚动，脚本重复执行不叠监听', async () => {
  const b = bootToc()
  b.frame()
  b.page.links[0].contentTop += 40
  b.page.image.emit('load'); b.frame()
  assert.equal(b.scrolls[1].top, 356)
  b.execute()
  assert.equal(b.win.count('scroll'), 1)
  assert.equal(b.win.count('pjax:send'), 1)
  assert.equal(b.win.count('pjax:complete'), 1)
  b.page.toc.getBoundingClientRect = () => ({ top: 300, bottom: 300 })
  b.page.headings[1].top = 30
  b.win.emit('scroll'); b.frame()
  assert.equal(b.scrolls.length, 2)
  assert.equal(b.page.links[1].classes.has('active'), true)
})

console.log('\n' + passed + ' frontend regression cases passed')
