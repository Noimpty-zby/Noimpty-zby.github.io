// Offline behavior checks for the real presentation controller and chat success hooks.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import postcss from 'postcss'

const source = readFileSync(new URL('../../source/js/noimpty-ai.js', import.meta.url), 'utf8')
const providerSource = readFileSync(new URL('../../source/js/nanaly-provider.js', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../../source/js/nanaly-workspace.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../source/css/nanaly-delight.css', import.meta.url), 'utf8')
const cut = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `Missing source boundary: ${start}`)
  return source.slice(from, to)
}
const run = (code, globals = {}, names = []) => {
  const context = vm.createContext({ TextEncoder, TextDecoder, AbortController, DOMException,
    setTimeout, clearTimeout, URL, fileTray: null, voiceController: null, voiceUI: null, shell: null, activeTurn: null, ...globals })
  vm.runInContext(code + '\nglobalThis.subject = {' + names.join(',') + '}', context)
  return context.subject
}
class Events {
  constructor() { this.listeners = new Map() }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || new Set()
    list.add(fn); this.listeners.set(type, list)
  }
  emit(type) { for (const fn of this.listeners.get(type) || []) fn({ type }) }
}
const element = () => {
  const attributes = new Map(), classes = new Set()
  return { isConnected: true, inert: false, hidden: false,
    classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key),
      toggle: (key, on) => on ? classes.add(key) : classes.delete(key) },
    setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
    rect: { width: 384, height: 300, top: 40, left: 20, right: 404, bottom: 340 },
    getBoundingClientRect() { return this.rect }
  }
}
const boot = ({ reduce = false, saveData = false, media = true } = {}) => {
  const window = new Events(), document = Object.assign(new Events(), { hidden: false })
  const reduced = Object.assign(new Events(), { matches: reduce })
  const connection = Object.assign(new Events(), { saveData })
  const launcher = element(), panel = element(), timers = new Map()
  let now = 0, next = 0
  window.navigator = { connection }
  window.innerWidth = 1280; window.innerHeight = 720
  window.getComputedStyle = () => panel.computed || { visibility: 'visible', display: 'flex' }
  if (media) window.matchMedia = () => reduced
  window.setTimeout = (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id }
  window.clearTimeout = id => timers.delete(id)
  window.fetch = () => { throw new Error('Real network is forbidden') }
  const { createNanalyDelight } = run(cut('  const createNanalyDelight =', '  const launcher ='), { window, document }, ['createNanalyDelight'])
  const delight = createNanalyDelight(launcher, panel)
  const advance = ms => {
    now += ms
    for (;;) {
      const ready = [...timers].find(([, value]) => value.at <= now)
      if (!ready) break
      timers.delete(ready[0]); ready[1].fn()
    }
  }
  return { window, document, reduced, connection, launcher, panel, delight, timers, advance,
    mood: () => panel.getAttribute('data-nanaly-mood'),
    open() { panel.inert = false; panel.classList.add('is-open'); delight.open() },
    close() { panel.classList.remove('is-open'); panel.inert = true; delight.close() }
  }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

await test('opening greets once, repeated open does not replay, and transient timers expire', () => {
  const h = boot()
  h.delight.busy(true); h.advance(1000); h.delight.busy(false, true)
  assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
  h.open(); assert.equal(h.mood(), 'welcome')
  const timer = [...h.timers.keys()][0]
  h.open(); assert.equal([...h.timers.keys()][0], timer)
  h.advance(1100); assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
  h.close(); h.open(); assert.equal(h.mood(), 'welcome')
})

await test('thinking is delayed and abort clears it immediately without a success replay', () => {
  const h = boot(), controller = new AbortController()
  h.open(); h.delight.busy(true, false, controller.signal)
  h.advance(239); assert.equal(h.mood(), 'idle')
  h.advance(1); assert.equal(h.mood(), 'thinking')
  controller.abort(); assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
  h.delight.busy(false, true); assert.equal(h.mood(), 'idle')
})

await test('only explicit completion celebrates and a new turn cancels the old sparkle timer', () => {
  const h = boot(); h.open()
  h.delight.busy(true); h.delight.busy(false, false); assert.equal(h.mood(), 'idle')
  h.delight.busy(true); h.delight.busy(false, true); assert.equal(h.mood(), 'success')
  const old = [...h.timers.keys()][0]
  h.delight.busy(true); assert.ok(!h.timers.has(old))
  h.advance(1200); assert.equal(h.mood(), 'thinking')
  h.delight.busy(false, true); h.advance(1200); assert.equal(h.mood(), 'idle')
})

await test('reduced motion, Save-Data and missing media APIs keep a static recognizable face', () => {
  for (const options of [{ reduce: true }, { saveData: true }, { media: false }]) {
    const h = boot(options); h.open(); h.delight.busy(true); h.advance(500); h.delight.busy(false, true)
    assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
  }
})

await test('background, blur and changing preferences stop effects; hidden completion never replays', () => {
  for (const [off, on] of [
    [h => { h.document.hidden = true; h.document.emit('visibilitychange') }, h => { h.document.hidden = false; h.document.emit('visibilitychange') }],
    [h => h.window.emit('blur'), h => h.window.emit('focus')],
    [h => { h.reduced.matches = true; h.reduced.emit('change') }, h => { h.reduced.matches = false; h.reduced.emit('change') }],
    [h => { h.connection.saveData = true; h.connection.emit('change') }, h => { h.connection.saveData = false; h.connection.emit('change') }]
  ]) {
    const h = boot(); h.open(); h.delight.busy(true); h.advance(250)
    assert.equal(h.mood(), 'thinking'); off(h); assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
    h.delight.busy(false, true); on(h); h.advance(2000)
    assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
  }
})

await test('offscreen, disconnected and CSS-hidden panels do not animate', () => {
  for (const hide of [
    h => { h.panel.rect = { ...h.panel.rect, top: 800, bottom: 1100 } },
    h => { h.panel.isConnected = false },
    h => { h.panel.computed = { visibility: 'hidden', display: 'flex' } }
  ]) {
    const h = boot(); hide(h); h.open(); h.delight.busy(true); h.advance(300); h.delight.busy(false, true)
    assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
  }
})

await test('cancelled or failed PJAX without complete cannot leave a permanent expression lock', () => {
  const h = boot(); h.open(); h.window.emit('pjax:send')
  assert.equal(h.mood(), 'idle')
  // A failed route leaves the old page in place, with no complete event.
  h.close(); h.open(); assert.equal(h.mood(), 'welcome')
  h.delight.busy(true); h.advance(250); assert.equal(h.mood(), 'thinking')
  h.delight.busy(false, true); assert.equal(h.mood(), 'success')
})

class Bubble {
  constructor() { this.children = []; this.innerHTML = ''; this.className = ''; this.removed = false }
  contains(node) { return this.children.includes(node) }
  replaceChildren(...nodes) { this.children = nodes }
  remove() { this.removed = true }
}
const abortableCode = cut('  const abortable =', '  /* 忙的时候')
const busyCode = cut('  const setBusy =', '  const addMsg =')
const sse = (text, reason = null) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: reason }] }) + '\n\n'
const sendHarness = (fetch, action) => {
  const h = boot(), logs = [], bubbles = []
  h.open(); h.advance(1100)
  run(providerSource, { window: h.window })
  const store = new Map(), workspaceWindow = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } }
  run(workspaceSource, { window: workspaceWindow })
  const workspace = { ...workspaceWindow.NANALY_WORKSPACE.create(), refresh() {}, decorateMessage() {} }
  h.panel.contains = () => false
  const logCode = cut('  const logTurn =', '  const locked =').replace('const at = Date.now()', 'logs.push([userText, herText]); const at = Date.now()')
  const subject = run(abortableCode + logCode + busyCode + cut('  const stream =', '  const send =') +
    cut('  const send =', '  // ---------------- 事件') + cut('  const closePanel =', '  launcher.addEventListener'), {
    delight: h.delight, window: h.window, document: h.document, panel: h.panel, launcher: h.launcher,
    workspace, vision: null, history: [], HISTORY_MAX: 22, logs, writeLog: log => workspace.writeLog(log), stopSpeak() {}, backToChat() {},
    fetch, busy: false, view: 'chat', activeTurn: null, abortCtl: null, uiRevision: 0,
    cfg: { baseURL: 'https://example.invalid', model: 'mock' }, DEFAULTS: {}, lastUsage: null,
    secrets: { apiKey: 'offline-placeholder' }, input: { value: 'question', style: {} },
    sendBtn: { ...element(), innerHTML: '' }, body: element(), brain: 'off', subLine: {}, followScroll: false,
    currentArticle: () => null, rememberAsk() {},
    addMsg: () => { const node = new Bubble(); bubbles.push(node); return node }, el: () => new Bubble(),
    buildMessages: async () => [], wantsBrain: () => false, mdToHtml: text => text, escapeHtml: text => text,
    enhance: async () => {}, hideActFragment: text => text, splitAction: text => ({ text, act: action ? { do: 'music', op: 'play' } : null }),
    runAction: action,
    showUsage() {}, addSpeakBtn() {}, scrollBottom() {}, renderSources() {}, setSubLine() {}
  }, ['send', 'stopStream', 'closePanel'])
  return { ...h, ...subject, logs, bubbles, workspace }
}

await test('the actual send path celebrates a completed offline SSE reply exactly once', async () => {
  let calls = 0
  const h = sendHarness(async () => { calls++; return new Response(sse('你好喵') + 'data: [DONE]\n\n') })
  await h.send('question', 'article')
  assert.equal(calls, 1); assert.equal(h.mood(), 'success'); assert.equal(h.logs.length, 1)
  h.advance(1200); assert.equal(h.mood(), 'idle')
})

await test('truncated, filtered, malformed and failed replies never celebrate', async () => {
  for (const response of [
    () => new Response(sse('部分回答', 'length')),
    () => new Response(sse('部分回答', 'content_filter')),
    () => new Response('data: broken\n\n'),
    () => new Response('{"error":{"message":"offline error"}}', { status: 500 })
  ]) {
    const h = sendHarness(async () => response())
    await h.send('question', 'article')
    assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
  }
})

await test('stopping or locking an offline stream clears the ears immediately and never celebrates', async () => {
  for (const discard of [false, true]) {
    const h = sendHarness(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(sse('还没说完')))
    } })))
    const pending = h.send('question', 'article')
    await tick(); h.advance(250); assert.equal(h.mood(), 'thinking')
    h.stopStream(discard); assert.equal(h.mood(), 'idle')
    await pending; assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
    assert.equal(h.logs.length, discard ? 0 : 1)
  }
})

const localHarness = (player, text = '暂停音乐') => {
  const h = boot(), messages = []
  h.open(); h.advance(1100); h.window.NOIMPTY_MUSIC_PLAYER = player
  const subject = run(abortableCode + busyCode + cut('  const runAction =', '  // 跳转之后') +
    cut('  const NAV_RE =', '  // ---------------- 界面') + cut('  const submit =', '  sendBtn.addEventListener'), {
    delight: h.delight, window: h.window, document: h.document, workspace: null, vision: null,
    busy: false, view: 'chat', activeTurn: null, abortCtl: null, uiRevision: 0,
    input: { value: text, style: {} }, sendBtn: { ...element(), innerHTML: '' }, body: element(),
    WEB_PREFIX: /^上网搜[：:]/, SITE_PREFIX: /^全站搜[：:]/,
    addMsg: (role, text) => messages.push({ role, text }), logTurn() {},
    modeOf: () => 'article', send: () => { throw new Error('Local music must not call a model') }
  }, ['submit', 'stopStream'])
  return { ...h, ...subject, messages }
}

await test('local music completion celebrates without an API; missing player is an ordinary error', async () => {
  let pauses = 0
  const good = localHarness({ pause() { pauses++ } })
  await good.submit(); assert.equal(pauses, 1); assert.equal(good.mood(), 'success')
  const missing = localHarness(null)
  await missing.submit(); assert.equal(missing.mood(), 'idle')
  assert.match(missing.messages.at(-1).text, /没找到播放器/)
})


await test('playback must return strict true; denied or legacy undefined playback does not celebrate', async () => {
  for (const result of [true, false, undefined]) {
    const h = localHarness({ play: async () => result }, '播放音乐')
    await h.submit()
    assert.equal(h.mood(), result === true ? 'success' : 'idle')
    assert.match(h.messages.at(-1).text, result === true ? /放上了/ : /还没能开始播放/)
  }
})

await test('cancelled local playback cannot append a late reply or replay success', async () => {
  let resolve
  const pending = new Promise(yes => { resolve = yes })
  const h = localHarness({ play: () => pending }, '播放音乐')
  const result = h.submit()
  h.stopStream(); await result
  resolve(true); await tick()
  assert.equal(h.mood(), 'idle'); assert.equal(h.messages.length, 0)
})

await test('failed or cancelled post-reply actions neither celebrate nor duplicate the completed answer', async () => {
  const failed = sendHarness(async () => new Response(sse('帮你播放音乐') + 'data: [DONE]\n\n'),
    async (_, report) => { report(false); return '还没能开始播放' })
  await failed.send('question', 'article')
  assert.equal(failed.mood(), 'idle'); assert.equal(failed.logs.length, 1)
  let started, resolve
  const ready = new Promise(yes => { started = yes })
  const waiting = new Promise(yes => { resolve = yes })
  const h = sendHarness(async () => new Response(sse('帮你播放音乐') + 'data: [DONE]\n\n'),
    async (_, report) => { started(); await waiting; report(true); return '放上了' })
  const result = h.send('question', 'article')
  await ready; h.stopStream(); await result
  assert.equal(h.mood(), 'idle'); assert.equal(h.logs.length, 1)
  assert.equal(h.logs[0][1], '帮你播放音乐')
  resolve(); await tick()
  assert.equal(h.mood(), 'idle'); assert.equal(h.logs.length, 1)
})

await test('restoring history never invokes success feedback or replaces stored content', () => {
  const h = boot(), messages = []
  h.open(); h.advance(1100)
  const history = [{ role: 'user', content: '之前的问题' }, { role: 'assistant', content: '之前的回答' }]
  const { renderHistory } = run(cut('  const renderHistory =', '  // ---------------- 设置界面'), {
    delight: h.delight, workspace: null, stopSpeak() {}, followScroll: false, quick: { style: {} }, body: {}, history,
    addMsg: (role, text) => messages.push(text)
  }, ['renderHistory'])
  renderHistory()
  assert.deepEqual(messages, history.map(m => m.content)); assert.equal(h.mood(), 'idle'); assert.equal(h.timers.size, 0)
})


await test('collapsing the real panel keeps the stream alive and marks the completed reply unread', async () => {
  let output
  const h = sendHarness(async () => new Response(new ReadableStream({ start(controller) {
    output = controller; controller.enqueue(new TextEncoder().encode(sse('前半句')))
  } })))
  const pending = h.send('question', 'article')
  await tick(); h.closePanel()
  assert.equal(h.panel.classList.contains('is-open'), false)
  assert.equal(h.workspace.snapshot().sessions[0].pending.status, 'pending')
  output.enqueue(new TextEncoder().encode(sse('后半句') + 'data: [DONE]\n\n')); output.close()
  await pending
  assert.equal(h.logs.length, 1)
  assert.equal(h.logs[0][1], '前半句后半句')
  assert.equal(h.workspace.snapshot().sessions[0].pending, null)
  assert.equal(h.launcher.classList.contains('has-news'), true)
  assert.equal(h.mood(), 'idle')
})

await test('clear during a pending stream cannot be undone by its late finally callback', async () => {
  const h = sendHarness(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(sse('旧的半句')))
  } })))
  const pending = h.send('question', 'article')
  await tick(); h.stopStream(true); h.workspace.clear()
  await pending
  assert.equal(h.workspace.readLog().length, 0)
  assert.equal(h.workspace.snapshot().sessions[0].pending, null)
  assert.equal(h.logs.length, 0)
  assert.equal(h.workspace.undoClear(), true)
  assert.equal(h.workspace.readLog()[0].content, 'question')
})

await test('the reusable face is decorative, has no external resources or duplicate IDs, and animations are bounded', () => {
  const { catFace } = run(cut('  const catFace =', '  // 纯展示状态'), {}, ['catFace'])
  const markup = catFace()
  assert.match(markup, /<svg[^>]+aria-hidden="true"[^>]+focusable="false"/)
  assert.match(markup, /nanaly-cat__ear/); assert.match(markup, /nanaly-cat__eyes/); assert.match(markup, /nanaly-cat__star/)
  assert.doesNotMatch(markup, /\b(?:id|href|src|on\w+)\s*=|<script/i)
  const ast = postcss.parse(css)
  ast.walkAtRules('keyframes', animation => animation.walkDecls(d => assert.ok(['transform', 'opacity'].includes(d.prop))))
  ast.walkDecls(/^animation/, d => assert.doesNotMatch(d.value, /infinite/))
})
