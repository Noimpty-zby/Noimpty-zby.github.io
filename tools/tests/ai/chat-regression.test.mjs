// Exercise browser chat code with local streams and small DOM doubles; no service calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const providerSource = readFileSync(new URL('../../../source/js/nanaly-provider.js', import.meta.url), 'utf8')
const source = readFileSync(new URL('../../../source/js/noimpty-ai.js', import.meta.url), 'utf8')
const cut = (start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `Missing source boundary: ${start}`)
  return source.slice(from, to)
}
const run = (code, globals = {}, names = []) => {
  const context = vm.createContext({ TextEncoder, TextDecoder, AbortController, DOMException,
    setTimeout, clearTimeout, URL, workspace: null, vision: null, fileTray: null, voiceController: null, voiceUI: null, shell: null, activeTurn: null, research: null, history: [], HISTORY_MAX: 22, window: {}, ...globals })
  vm.runInContext(code + '\nglobalThis.subject = {' + names.join(',') + '}', context)
  return context.subject
}
let passed = 0
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { console.error('  ✗ ' + name, error); process.exitCode = 1 }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const abortableCode = cut('  const abortable =', '  /* 忙的时候')
const streamCode = cut('  const stream =', '  const send =')
const speechCode = cut('  const speechMetadata =', '  const stopSpeak =')
const sse = (content, eol = '\n') => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + eol + eol

const streamHarness = fetch => run(providerSource + '\n' + abortableCode + '\n' + streamCode, {
  fetch, lastUsage: null,
  cfg: { model: 'mock', reasonModel: 'mock-reason', baseURL: 'https://example.invalid' },
  DEFAULTS: { reasonModel: 'mock-reason', reasonEffort: 'high' },
  secrets: { apiKey: 'test-placeholder' }
}, ['stream'])

await test('SSE handles every UTF-8 byte split, CRLF, usage and final event without newline', async () => {
  const raw = sse('你好', '\r\n') + 'data: ' + JSON.stringify({ choices: [{ delta: { content: '喵' }, finish_reason: 'stop' }] })
  const bytes = new TextEncoder().encode(raw)
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } }))
  const { stream } = streamHarness(async () => response)
  const deltas = []
  assert.equal(await stream([], text => deltas.push(text), false, new AbortController().signal), '你好喵')
  assert.deepEqual(deltas, ['你好', '你好喵'])
})

await test('[DONE] closes an otherwise open connection promptly', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(sse('done') + 'data: [DONE]\n\n'))
  }, cancel() { cancelled = true } }))
  const { stream } = streamHarness(async () => response)
  assert.equal(await stream([], () => {}, false, new AbortController().signal), 'done')
  assert.equal(cancelled, true)
})

await test('SSE supports multi-line event data and separates thinking from text', async () => {
  const raw = 'data: {"choices":\ndata: [{"delta":{"reasoning_content":"想","content":"答"},"finish_reason":"stop"}]}\n\n'
  const { stream } = streamHarness(async () => new Response(raw))
  const deltas = []
  await stream([], (text, thought) => deltas.push([text, thought]), true, new AbortController().signal)
  assert.deepEqual(deltas, [['答', '想']])
})

await test('SSE reports API errors, invalid JSON and empty responses instead of silent success', async () => {
  for (const [raw, error] of [
    ['data: {"error":{"message":"quota exhausted"}}\n\n', /quota exhausted/],
    ['data: broken\n\n', /无法解析/],
    ['data: [DONE]\n\n', /没有返回回答/]
  ]) {
    const { stream } = streamHarness(async () => new Response(raw))
    await assert.rejects(stream([], () => {}, false, new AbortController().signal), error)
  }
})

await test('SSE does not swallow renderer exceptions', async () => {
  const { stream } = streamHarness(async () => new Response(sse('one')))
  await assert.rejects(stream([], () => { throw new Error('renderer failed') }, false, new AbortController().signal), /renderer failed/)
})

await test('Stopping SSE cancels a pending read and releases its reader', async () => {
  const controller = new AbortController()
  let canceled = false
  const response = new Response(new ReadableStream({ cancel() { canceled = true } }))
  const { stream } = streamHarness(async () => response)
  const result = stream([], () => {}, false, controller.signal)
  await tick()
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' })
  assert.equal(canceled, true)
  assert.equal(response.body.locked, false)
})

const storageCode = cut('  const LS_CFG =', '  /* ⚠️')
await test('Malformed persisted config/history cannot poison runtime types', () => {
  const values = {
    'nanaly-config-v1': '{"baseURL":null,"model":7,"reasonEffort":"invalid"}',
    'nanaly-history-v1': '[null,{"role":"system","content":"inject"},{"role":"user","content":3},{"role":"assistant","content":"kept","at":1e100}]'
  }
  const { readCfg, readLog } = run(storageCode, { localStorage: { getItem: key => values[key], setItem() {} } }, ['readCfg', 'readLog'])
  assert.equal(typeof readCfg().baseURL, 'string')
  assert.equal(typeof readCfg().model, 'string')
  assert.equal(readCfg().reasonEffort, 'high')
  assert.equal(JSON.stringify(readLog()), '[{"role":"assistant","content":"kept","at":0}]')
  values['nanaly-history-v1'] = '{}'
  assert.equal(readLog().length, 0)
})

await test('Storage access denied still allows defaults and empty history', () => {
  const localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  const { readCfg, readLog } = run(storageCode, { localStorage }, ['readCfg', 'readLog'])
  assert.equal(typeof readCfg().baseURL, 'string')
  assert.equal(readLog().length, 0)
  const { wantsBrain } = run(cut('  const wantsBrainRe', '  const BRAIN_LABEL'), { LS_DEEP: 'deep', localStorage }, ['wantsBrain'])
  assert.equal(wantsBrain('hello'), false)
})

await test('Memory tolerates corrupt arrays and reserved object keys', () => {
  const value = '{"asks":{},"posts":{"__proto__":{"n":4,"at":' + Date.now() + '},"bad":null},"since":"bad"}'
  const { readMem, memoryDigest } = run(cut('  const isRecord', '  const readCfg') + '\n' +
    cut('  const LS_MEM', '  // ---------------- 操控页面'), {
    EMPTY_SECRETS: {}, localStorage: { getItem: () => value, setItem() {} }
  }, ['readMem', 'memoryDigest'])
  assert.equal(readMem().asks.length, 0)
  assert.equal(Object.getPrototypeOf(readMem().posts), null)
  assert.match(memoryDigest(), /__proto__/)
})

await test('Inline code preserves Markdown/math and URL placeholders stay inside href', () => {
  const { mdToHtml } = run(cut('  const escapeHtml', '  const ROOT') + '\n' +
    cut('  const mdToHtml', '  // 渲染完成后'), {}, ['mdToHtml'])
  assert.equal(mdToHtml('`**literal** $x$ [site](https://a.test)`'), '<p><code>**literal** $x$ [site](https://a.test)</code></p>')
  const result = mdToHtml('[site](https://a.test/$$x$$)')
  assert.equal(result, '<p><a href="https://a.test/$$x$$" target="_blank" rel="noopener noreferrer">site</a></p>')
  assert.ok(!mdToHtml('<img src=x onerror=alert(1)>').includes('<img'))
  assert.ok(!mdToHtml('[bad](javascript:alert(1))').includes('<a'))
  assert.doesNotThrow(() => mdToHtml('@@NCODE9@@ @@NINLINE3@@ @@NMATH2@@'))
})

class Bubble {
  constructor() { this.children = []; this.innerHTML = ''; this.className = ''; this.removed = false; this.dataset = {} }
  contains(node) { return this.children.includes(node) }
  replaceChildren(...children) { this.children = children }
  remove() { this.removed = true }
}
const sendHarness = (buildMessages, stream, extra = {}) => {
  const logs = [], bubbles = [], busyStates = []
  const controller = run(speechCode + '\n' + abortableCode + '\n' + cut('  const stopStream =', '  const addMsg =') + '\n' +
    cut('  const send =', '  // ---------------- 事件'), {
    busy: false, view: 'chat', activeTurn: null, abortCtl: null, uiRevision: 0,
    writeLog() {}, renderSources() {}, panel: { classList: { contains: () => true } }, launcher: { classList: { add() {} } },
    secrets: { apiKey: 'test-placeholder' }, input: { value: 'question', style: {} },
    brain: 'off', subLine: {}, followScroll: false, currentArticle: () => null,
    rememberAsk() {}, addMsg: () => { const node = new Bubble(); bubbles.push(node); return node },
    el: () => new Bubble(), buildMessages, stream, wantsBrain: () => false,
    setBusy: value => busyStates.push(value), mdToHtml: text => text, escapeHtml: text => text,
    enhance: async () => {}, hideActFragment: text => text, splitAction: text => ({ text, act: null }),
    showUsage() {}, addSpeakBtn() {}, scrollBottom() {}, logTurn: (...args) => logs.push(args), setSubLine() {}, ...extra
  }, ['send', 'stopStream', 'speechPayload', 'chatBridge', 'contextAction'])
  return { ...controller, logs, bubbles, busyStates }
}

await test('Stop during index lookup prevents later paid model request', async () => {
  const pending = deferred()
  let requests = 0
  const h = sendHarness(() => pending.promise, async () => { requests++; return 'bad' })
  const result = h.send('question', 'site')
  h.stopStream()
  await result
  pending.resolve([])
  await tick()
  assert.equal(requests, 0)
  assert.deepEqual(h.busyStates, [true, false])
  assert.equal(h.bubbles[1].removed, true)
})

await test('Stop after a text delta preserves visible partial answer and history', async () => {
  const ready = deferred()
  const h = sendHarness(async () => [], async (_, delta, deep, signal) => {
    delta('partial answer', '')
    ready.resolve()
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const result = h.send('question', 'article')
  await ready.promise
  h.stopStream()
  await result
  assert.equal(h.logs.length, 1)
  assert.match(h.logs[0][1], /partial answer.*\n（这句被打断了/)
  assert.match(h.bubbles[1].children[0].innerHTML, /partial answer/)
  assert.equal(h.bubbles[1].removed, false)
  assert.equal(h.speechPayload(h.bubbles[1]).rawText, h.logs[0][1])
  assert.equal(h.speechPayload(h.bubbles[1]).context, 'question')
})

await test('Reset/lock discards an active partial reply instead of restoring cleared history', async () => {
  const ready = deferred()
  const h = sendHarness(async () => [], async (_, delta, deep, signal) => {
    delta('must not return', '')
    ready.resolve()
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const result = h.send('question', 'article')
  await ready.promise
  h.stopStream(true)
  await result
  assert.deepEqual(h.logs, [])
  assert.deepEqual(h.busyStates, [true, false])
})

await test('Lookup failure does not also tell the model that the subject was never written', async () => {
  const { buildMessages } = run(abortableCode + '\n' + cut('  const WEB_PREFIX', '  /* 这几条消息的') + '\n' +
    cut('  const attachmentContent =', '  const generateTopicTitle =') + '\n' + cut('  const buildMessages', '  // 模型把指令'), {
    PERSONA: 'persona', TIME_RULES: 'time', currentArticle: () => null, postDigest: async () => 'posts', selfLog: async () => 'journal',
    research: { prepare: async ({ query, mode, signal }) => {
      assert.equal(query, '递归'); assert.equal(mode, 'site'); assert.equal(signal.aborted, false)
      return { context: '站内索引读不出来：还没有解锁；这不是没有检索到。', sources: [] }
    } }, activeTurn: null, secrets: {}, window: {},
    getSiteMap: async () => [], location: { pathname: '/' }, history: [], HISTORY_MAX: 22, historyAnchor: 0,
    historyWindow: () => ({ list: [], anchorAt: 0 }), withTimeMarks: () => [], memoryDigest: () => '', nowLine: () => 'now'
  }, ['buildMessages'])
  const messages = await buildMessages('全站搜：递归', 'site', new AbortController().signal)
  const all = messages.map(message => message.content).join('\n')
  assert.match(all, /还没有解锁/)
  assert.doesNotMatch(all, /本次关键词没有检索到|这个话题他还没写过/)
})

await test('Wrong vault password never replaces the current in-memory keys or settings', async () => {
  const fields = Object.fromEntries(['apiKey', 'tavilyKey', 'ghToken', 'visionKey', 'backendToken', 'pass', 'baseURL', 'model', 'reasonModel', 'reasonEffort', 'visionBaseURL', 'visionModel', 'proactive']
    .map(name => [name, { value: '' }]))
  let click
  const box = { isConnected: true, querySelector: selector => fields[selector.match(/"([^"]+)"/)[1]],
    querySelectorAll: () => [], addEventListener: (_, fn) => { click = fn } }
  const originalCfg = { baseURL: 'https://api.example.test', model: 'old-model', reasonModel: 'old-reason', reasonEffort: 'high', visionBaseURL: 'https://api.siliconflow.cn/v1', visionModel: 'vision-test' }
  const originalSecrets = { apiKey: 'original', tavilyKey: '', ghToken: '' }
  let error = ''
  let sealed = 0
  const { showSetup, getState } = run(cut('  const showSetup =', '  const addSetupError') +
    '\nconst getState = () => ({ cfg, secrets })', {
    cfg: originalCfg, secrets: originalSecrets, DEFAULTS: originalCfg,
    readCfg: () => originalCfg, setupShell: () => box, escapeHtml: text => text,
    hasCrypto: () => true, hasVault: () => true, openSecrets: async () => { throw new Error('wrong') },
    sealSecrets: async () => { sealed++ }, uiRevision: 0, addSetupError: (_, message) => { error = message }
  }, ['showSetup', 'getState'])
  showSetup()
  fields.apiKey.value = 'replacement'
  fields.model.value = 'replacement-model'
  fields.pass.value = 'wrong-password'
  await click({ target: { closest: () => ({ dataset: { a: 'save' } }) } })
  assert.equal(getState().cfg, originalCfg)
  assert.equal(getState().secrets, originalSecrets)
  assert.equal(sealed, 0)
  assert.match(error, /打不开/)
})

await test('Double submit during local navigation lookup cannot issue duplicate requests', async () => {
  const pending = deferred()
  let lookups = 0, sends = 0
  const { submit } = run(abortableCode + '\nconst setBusy = on => { busy = on }\n' +
    cut('  const WEB_PREFIX', '  /* 这几条消息的') + '\n' + cut('  const submit =', '  sendBtn.addEventListener'), {
    input: { value: 'look up this page', style: {} }, busy: false, view: 'chat', activeTurn: null, abortCtl: null,
    tryLocalCommand: () => { lookups++; return pending.promise }, modeOf: () => 'article', send: () => { sends++ }, addMsg() {}
  }, ['submit'])
  const first = submit()
  await submit()
  pending.resolve(false)
  await first
  assert.equal(lookups, 1)
  assert.equal(sends, 1)
})

await test('Locking while vault encryption is pending cannot save or unlock keys afterward', async () => {
  const pending = deferred(), started = deferred()
  const fields = Object.fromEntries(['apiKey', 'tavilyKey', 'ghToken', 'visionKey', 'backendToken', 'pass', 'baseURL', 'model', 'reasonModel', 'reasonEffort', 'visionBaseURL', 'visionModel', 'proactive']
    .map(name => [name, { value: '' }]))
  let click, writes = 0
  const box = { isConnected: true, querySelector: selector => fields[selector.match(/"([^"]+)"/)[1]],
    querySelectorAll: () => [], addEventListener: (_, fn) => { click = fn } }
  const cfg = { baseURL: 'https://api.example.test', model: 'old-model', reasonModel: 'old-reason', reasonEffort: 'high', visionBaseURL: 'https://api.siliconflow.cn/v1', visionModel: 'vision-test' }
  const secrets = { apiKey: 'original', tavilyKey: '', ghToken: '' }
  const { showSetup, leave, getState } = run(cut('  const showSetup =', '  const addSetupError') +
    '\nconst leave = () => { uiRevision++ }; const getState = () => ({ cfg, secrets })', {
    cfg, secrets, DEFAULTS: cfg, readCfg: () => cfg, setupShell: () => box, escapeHtml: text => text,
    hasCrypto: () => true, hasVault: () => true, openSecrets: async () => secrets,
    sealSecrets: () => { started.resolve(); return pending.promise }, uiRevision: 0,
    localStorage: { setItem: () => { writes++ } }, addSetupError() {}
  }, ['showSetup', 'leave', 'getState'])
  showSetup()
  fields.apiKey.value = 'replacement'
  fields.pass.value = 'correct-password'
  const result = click({ target: { closest: () => ({ dataset: { a: 'save' } }) } })
  await started.promise
  leave()
  pending.resolve('encrypted-payload')
  await result
  assert.equal(writes, 0)
  assert.equal(getState().secrets, secrets)
})


const setupHarness = overrides => {
  const fields = Object.fromEntries(['apiKey', 'tavilyKey', 'ghToken', 'visionKey', 'backendToken', 'pass', 'baseURL', 'model', 'reasonModel', 'reasonEffort', 'visionBaseURL', 'visionModel', 'proactive']
    .map(name => [name, { value: '' }]))
  let click
  const box = { isConnected: true, querySelector: selector => fields[selector.match(/"([^"]+)"/)[1]],
    querySelectorAll: () => [], addEventListener: (_, fn) => { click = fn } }
  const cfg = { baseURL: 'https://api.example.test', model: 'm', reasonModel: 'r', reasonEffort: 'high', visionBaseURL: 'https://api.siliconflow.cn/v1', visionModel: 'v' }
  const calls = { sealed: [], connects: [], errors: [] }
  const subject = run(cut('  const showSetup =', '  const addSetupError') + '\nconst getSecrets = () => secrets', {
    cfg, secrets: { apiKey: 'k' }, DEFAULTS: cfg, readCfg: () => cfg, setupShell: () => box, escapeHtml: text => text,
    hasCrypto: () => true, hasVault: () => false, openSecrets: async () => null,
    sealSecrets: async value => { calls.sealed.push(value); return 'sealed' }, uiRevision: 0,
    LS_VAULT: 'nanaly-vault-v1', voiceController: null, localStorage: { setItem() {} }, writeCfg() {}, writeSession() {}, markOwnerIfMine() {}, backToChat() {}, resetDwell() {}, addMsg() {},
    connectBackend: options => { calls.connects.push(options) }, addSetupError: (_, message) => { calls.errors.push(message) }, ...overrides
  }, ['showSetup', 'getSecrets'])
  subject.showSetup()
  return { fields, calls, getSecrets: subject.getSecrets, save: () => click({ target: { closest: () => ({ dataset: { a: 'save' } }) } }) }
}

await test('Vault saves the personal backend token encrypted and connects right after saving', async () => {
  const setup = setupHarness()
  const backend = 'b'.repeat(64)
  setup.fields.apiKey.value = 'k'
  setup.fields.pass.value = 'vault-pass'
  setup.fields.backendToken.value = backend
  await setup.save()
  assert.deepEqual(setup.calls.errors, [])
  assert.equal(setup.calls.sealed.length, 1)
  assert.equal(setup.calls.sealed[0].backendToken, backend)
  assert.equal(setup.getSecrets().backendToken, backend)
  assert.equal(setup.calls.connects.length, 1)
  assert.equal(setup.calls.connects[0].explicit, true)
})

await test('Vault rejects a malformed backend token before encrypting anything', async () => {
  for (const bad of ['too-short', 'has space in the middle of a long token value']) {
    const setup = setupHarness()
    setup.fields.apiKey.value = 'k'
    setup.fields.pass.value = 'vault-pass'
    setup.fields.backendToken.value = bad
    await setup.save()
    assert.equal(setup.calls.sealed.length, 0)
    assert.equal(setup.calls.connects.length, 0)
    assert.match(setup.calls.errors.at(-1), /个人后端令牌/)
  }
})

await test('Backend auto-connect needs the site gate and a stored token, and respects manual disconnects', () => {
  const connectCode = cut('  const BACKEND_DEFAULT', '  // 深度思考')
  const harness = ({ token = 't'.repeat(64), gate = true, configured = false, connecting = false, off = false, url = null } = {}) => {
    const connects = []
    const agent = { configured: () => configured, snapshot: () => ({ connection: connecting ? 'connecting' : 'disconnected' }),
      manuallyDisconnected: () => off, connect: (...args) => { connects.push(args); return Promise.resolve() } }
    const { connectBackend } = run(connectCode, {
      secrets: { backendToken: token }, localStorage: { getItem: () => url },
      window: { NANALY_AGENT: agent, NOIMPTY_GATE: { unlocked: () => gate } }
    }, ['connectBackend'])
    return { connectBackend, connects }
  }
  let h = harness(); h.connectBackend()
  assert.deepEqual(h.connects, [['https://api.noimpty-zby.cn', 't'.repeat(64)]])
  h = harness({ url: 'https://other.example' }); h.connectBackend()
  assert.equal(h.connects[0][0], 'https://other.example')
  for (const blocked of [{ token: '' }, { gate: false }, { configured: true }, { connecting: true }, { off: true }]) {
    h = harness(blocked); h.connectBackend(); assert.equal(h.connects.length, 0, JSON.stringify(blocked))
  }
  h = harness({ off: true }); h.connectBackend({ explicit: true })
  assert.equal(h.connects.length, 1)
  h = harness({ gate: false }); h.connectBackend({ explicit: true })
  assert.equal(h.connects.length, 0)
})

await test('SSE length/content_filter termination rejects while preserving the received delta', async () => {
  for (const reason of ['length', 'content_filter']) {
    const raw = sse('partial answer') + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] }) + '\n\ndata: [DONE]\n\n'
    const { stream } = streamHarness(async () => new Response(raw))
    const deltas = []
    await assert.rejects(stream([], text => deltas.push(text), false, new AbortController().signal), /尚未完成/)
    assert.deepEqual(deltas, ['partial answer'])
  }
})

await test('Chat ignores invalid journal rows even if a stale search script returns them', async () => {
  const { selfLog } = run(cut('  const JOURNAL_WHO =', '  /* 怎么读时间'), {
    searchRevision: 0, window: { NOIMPTY_SEARCH: { loadJournal: async () => [null, { at: '9-19 10:00', who: 'reply', what: 'valid entry' }, { what: [] }] } }
  }, ['selfLog'])
  assert.match(await selfLog(), /valid entry/)
  assert.doesNotMatch(await selfLog(), /undefined/)
})

const searchSource = readFileSync(new URL('../../../source/js/noimpty-search.js', import.meta.url), 'utf8')
const searchHarness = fetchImpl => {
  const timers = new Map(), events = new EventTarget()
  let id = 0
  const window = {
    fetch: fetchImpl, location: { origin: 'https://example.test' },
    addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events)
  }
  const context = vm.createContext({ window, URL, Response, AbortController, DOMException, Event,
    setTimeout: fn => { timers.set(++id, fn); return id }, clearTimeout: key => timers.delete(key),
    DOMParser: class { parseFromString() { return { querySelector: () => null, querySelectorAll: () => [{ querySelector: key => ({ textContent: key === 'url' ? '/post/' : 'valid' }) }] } } }
  })
  vm.runInContext(searchSource, context)
  return { window, context, timers }
}

await test('Shared corpus/journal body timeout rejects and permits a fresh retry', async () => {
  for (const kind of ['loadCorpus', 'loadJournal']) {
    let requests = 0, signal
    const pending = deferred()
    const h = searchHarness(async (_, init) => {
      requests++; signal = init.signal
      return { ok: true, status: 200, text: () => requests === 1 ? pending.promise : Promise.resolve(kind === 'loadCorpus' ? '<search>valid</search>' : '{"entries":[]}') }
    })
    const request = h.window.NOIMPTY_SEARCH[kind]()
    const rejected = assert.rejects(request, /SEARCH_TIMEOUT/)
    await tick()
    h.timers.values().next().value()
    await rejected
    assert.equal(signal.aborted, true)
    assert.equal(h.timers.size, 0)
    await h.window.NOIMPTY_SEARCH[kind]()
    assert.equal(requests, 2)
    assert.equal(h.timers.size, 0)
  }
})

await test('Journal loader drops malformed rows before caching', async () => {
  const h = searchHarness(async () => new Response(JSON.stringify({ entries: [null, 3, {}, { at: 'today', who: 'reply', what: 'valid' }] })))
  const rows = await h.window.NOIMPTY_SEARCH.loadJournal()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].what, 'valid')
})

await test('Search reset also invalidates chat article, map and journal summaries', () => {
  const h = searchHarness(async () => new Response('<search>valid</search>'))
  Object.assign(h.context, { searchRevision: 0, postDigestCache: 'old posts', selfLogCache: 'old journal', siteMap: ['old url'], research: null, stopStream: discard => { assert.equal(discard, undefined) } })
  vm.runInContext(cut("  window.addEventListener('noimpty:search-reset'", '  // 供控制台'), h.context)
  h.window.NOIMPTY_SEARCH.reset()
  assert.equal(h.context.postDigestCache, null)
  assert.equal(h.context.selfLogCache, null)
  assert.equal(h.context.siteMap, null)
})


await test('An older in-flight journal summary cannot repopulate chat caches after reset', async () => {
  const pending = deferred()
  let calls = 0
  const { selfLog, invalidate } = run(cut('  const JOURNAL_WHO =', '  /* 怎么读时间') +
    '\nconst invalidate = () => { searchRevision++; selfLogCache = null }', {
    searchRevision: 0, window: { NOIMPTY_SEARCH: {
      explain: message => message,
      loadJournal: () => ++calls === 1 ? pending.promise : Promise.resolve([{ at: 'now', who: 'reply', what: 'fresh journal' }])
    } }
  }, ['selfLog', 'invalidate'])
  const stale = selfLog()
  invalidate()
  pending.resolve([{ at: 'before', who: 'reply', what: 'stale journal' }])
  assert.doesNotMatch(await stale, /stale journal/)
  assert.match(await selfLog(), /fresh journal/)
  assert.equal(calls, 2)
})

const pageContextCode = cut('  const canReadPageContext =', '  /* ---------------- 「现在」') + '\n'
  + cut('  const currentHeading =', '  const POKE_LINES =')

const pageContextHarness = (gate, pageLocked = false) => {
  const state = { locked: pageLocked, reads: 0, visits: [], subLine: {}, buttons: [{ style: {} }, { style: {} }] }
  const text = '可读取的文章正文。'.repeat(8)
  const clone = { nodeType: 1, tagName: 'DIV', childNodes: [{ nodeType: 3, textContent: text }], querySelectorAll: () => [], innerText: text }
  const box = {
    cloneNode: () => clone,
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ top: 10 }), textContent: '1. 当前小节' }]
  }
  const document = {
    documentElement: { classList: { contains: name => name === 'noimpty-private-locked' && state.locked } },
    getElementById() { state.reads++; return box },
    querySelector() { state.reads++; return { textContent: '当前文章标题' } },
    get title() { state.reads++; return '页面标题 | 站点' }
  }
  const window = { NOIMPTY_GATE: gate, innerHeight: 800, getSelection: () => null }
  const functions = run(pageContextCode + '\n' + cut('  const setSubLine =', '  if (window.NANALY_VISION) vision ='), {
    window, document, subLine: state.subLine, brain: 'off', location: { href: 'https://example.test/post/' },
    quick: { querySelectorAll: () => state.buttons }, rememberVisit: title => state.visits.push(title)
  }, ['currentArticle', 'currentHeading', 'refreshContext'])
  return { ...functions, state, window, text }
}

await test('Locked, missing or failed gates block article/title/heading DOM reads and visit memory', () => {
  for (const [gate, classLocked] of [
    [undefined, false], [{}, false], [{ unlocked: () => false }, false],
    [{ unlocked: () => { throw new Error('denied') } }, false],
    [{ unlocked: () => 'true' }, false], [{ unlocked: () => true }, true]
  ]) {
    const h = pageContextHarness(gate, classLocked)
    assert.equal(h.currentArticle(), null)
    assert.equal(h.currentHeading(), '')
    h.refreshContext()
    assert.equal(h.state.reads, 0, 'must decide before looking up article elements or titles')
    assert.deepEqual(h.state.visits, [])
    assert.equal(h.state.subLine.textContent, '省钱模式 · Noimpty 的学习搭子')
    assert.ok(h.state.buttons.every(button => button.style.display === 'none'))
  }
})

await test('Explicit unlock restores article, heading and current-page context normally', () => {
  let unlocked = false
  const h = pageContextHarness({ unlocked: () => unlocked })
  assert.equal(h.currentArticle(), null)
  unlocked = true
  assert.equal(h.currentArticle().title, '当前文章标题')
  assert.equal(h.currentArticle().text, h.text)
  assert.equal(h.currentHeading(), '当前小节')
  h.refreshContext()
  assert.deepEqual(h.state.visits, ['当前文章标题'])
  assert.equal(h.state.subLine.textContent, '省钱模式 · 正在读：当前文章标题')
  assert.ok(h.state.buttons.every(button => button.style.display === ''))
  h.state.locked = true
  const before = h.state.reads
  h.refreshContext()
  assert.equal(h.state.reads, before)
  assert.equal(h.state.subLine.textContent, '省钱模式 · Noimpty 的学习搭子')
})

const selectionHarness = (unlocked = false) => {
  const state = { unlocked, locked: false, reads: 0, opens: 0, clicks: new Map(), classes: new Set() }
  const anchor = { nodeType: 1 }
  const selBtn = {
    style: {}, classList: { add: name => state.classes.add(name), remove: name => state.classes.delete(name) },
    addEventListener: (name, fn) => state.clicks.set(name, fn), contains: () => false
  }
  const window = {
    NOIMPTY_GATE: { unlocked: () => state.unlocked }, addEventListener() {}, innerWidth: 375, scrollY: 0,
    getSelection: () => {
      state.reads++
      return { isCollapsed: false, rangeCount: 1, anchorNode: anchor, toString: () => '文章里的选中片段',
        getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 0, top: 60, width: 80 }) }), removeAllRanges() {} }
    }
  }
  const input = { value: '', dispatchEvent() {}, focus() {}, setSelectionRange() {} }
  const document = {
    documentElement: { classList: { contains: () => state.locked } }, addEventListener() {},
    getElementById: () => { state.reads++; return { contains: node => node === anchor } }
  }
  const functions = run(cut('  const canReadPageContext =', '  // 取当前文章正文') + '\n' +
    cut("  let selText = ''", '  // ---------------- 主动冒泡') + '\nconst selectedText = () => selText', {
    window, document, selBtn, input, Event, setTimeout: () => 0,
    openPanel: () => { state.opens++ }, stopStream() {}
  }, ['maybeShowSel', 'selectedText'])
  return { ...functions, state, input, window }
}

await test('Locked selection entry never reads browser selection or article DOM', () => {
  const h = selectionHarness()
  h.maybeShowSel()
  h.state.clicks.get('click')()
  assert.equal(h.state.reads, 0)
  assert.equal(h.state.classes.has('is-on'), false)
  assert.equal(h.selectedText(), '')
  h.window.NOIMPTY_GATE = undefined
  h.maybeShowSel()
  assert.equal(h.state.reads, 0)
})

await test('Selection requires unlock again at click time and clears stale captured text', () => {
  const h = selectionHarness(true)
  h.maybeShowSel()
  assert.equal(h.selectedText(), '文章里的选中片段')
  assert.equal(h.state.classes.has('is-on'), true)
  const reads = h.state.reads
  h.state.locked = true
  h.state.clicks.get('click')()
  assert.equal(h.state.reads, reads)
  assert.equal(h.input.value, '')
  assert.equal(h.state.opens, 0)
  assert.equal(h.selectedText(), '')
  assert.equal(h.state.classes.has('is-on'), false)
  h.state.locked = false
  h.maybeShowSel()
  h.state.clicks.get('click')()
  assert.match(h.input.value, /文章里的选中片段/)
  assert.equal(h.state.opens, 1)
})

await test('Default greeting has no private categories and saved chat history is preserved', () => {
  const saved = [{ role: 'user', content: '我之前保存的问题' }, { role: 'assistant', content: '之前的回答' }]
  for (const history of [[], saved]) {
    const messages = []
    const { renderHistory } = run(cut('  const renderHistory =', '  // ---------------- 设置界面'), {
      stopSpeak() {}, followScroll: false, quick: { style: {} }, body: {}, history,
      addMsg: (role, text) => messages.push({ role, text })
    }, ['renderHistory'])
    renderHistory()
    if (history.length) assert.deepEqual(messages.map(message => message.text), saved.map(message => message.content))
    else {
      assert.match(messages[0].text, /我是娜娜莉.*想聊点什么/)
      assert.doesNotMatch(messages[0].text, /课内|课外|AI Infra|数据结构|Linux|Git|UE5|图形学/)
    }
  }
})


await test('Closing the panel hides it without cancelling the active answer', () => {
  const controller = new AbortController()
  let stopped = 0, spoken = 0, closed = 0
  const attributes = new Map()
  const panel = { contains: () => false, classList: { remove: name => { assert.equal(name, 'is-open'); closed++ } }, setAttribute: (name, value) => attributes.set(name, value), inert: false }
  const { closePanel } = run(cut('  const closePanel =', "  launcher.addEventListener('click'"), {
    uiRevision: 0, view: 'chat', activeTurn: { controller }, panel,
    document: { activeElement: null }, launcher: { setAttribute() {}, focus() {} }, delight: { close() {} },
    stopStream: () => { stopped++; controller.abort() }, stopSpeak: () => { spoken++ }
  }, ['closePanel'])
  closePanel()
  assert.equal(controller.signal.aborted, false)
  assert.equal(stopped, 0)
  assert.equal(closed, 1)
  assert.equal(spoken, 1)
  assert.equal(panel.inert, true)
  assert.equal(attributes.get('aria-hidden'), 'true')
})

await test('Old behavioral memory expires from the prompt without diagnosing the user as stuck', () => {
  const old = Date.now() - 40 * 86400000
  const value = JSON.stringify({ asks: Array.from({ length: 5 }, () => ({ t: '旧问题', on: '旧文章', at: old })), posts: { '旧文章': { n: 8, at: old } } })
  const { memoryDigest } = run(cut('  const isRecord', '  const readCfg') + '\n' + cut('  const LS_MEM', '  // ---------------- 操控页面'), {
    EMPTY_SECRETS: {}, localStorage: { getItem: () => value, setItem() {} }
  }, ['memoryDigest'])
  assert.equal(memoryDigest(), '')
})


await test('manual reading retains raw stage directions and the reply-specific question after DOM decoration', () => {
  const calls = []
  const node = { dataset: {}, querySelector: () => null, appendChild(button) { this.button = button }, cloneNode() { throw new Error('Must not read decorated DOM when raw metadata exists') } }
  const { rememberSpeech, addSpeakBtn } = run(speechCode + '\n' + cut('  const addSpeakBtn =', '  const renderHistory ='), {
    synth: null, window: { NANALY_VOICE: true }, crypto: { randomUUID: () => 'fixture-speech-id' },
    voiceController: { state: () => null, speak: (raw, options) => calls.push({ raw, options }) },
    el: () => ({ type: '', title: '', setAttribute() {}, addEventListener(type, callback) { this[type] = callback } })
  }, ['rememberSpeech', 'addSpeakBtn'])
  const raw = '[轻轻叹气] 今天确实不容易。\n\n```js\nprivateCode()\n```\n我们慢慢来。[S1]'
  const question = '这一条对应的问题' + '甲'.repeat(1400)
  rememberSpeech(node, raw, question)
  addSpeakBtn(node)
  node.innerHTML = 'unrelated decorations and source cards'
  node.button.click()
  assert.equal(calls[0].raw, raw, 'voice planner receives raw text before stage directions are stripped')
  assert.equal(calls[0].options.context, question.slice(0, 1200))
  assert.equal(calls[0].options.context.length, 1200)
  assert.equal(calls[0].options.id, 'voice-fixture-speech-id')
})

await test('history speech context follows each reply instead of the last question in the conversation', () => {
  const firstQuestion = '旧问题' + '甲'.repeat(1500)
  const history = [
    { role: 'assistant', content: '独立问候' },
    { role: 'user', content: firstQuestion, files: [{ name: '不要加入语气上下文.pdf' }] },
    { role: 'assistant', content: '[笑] 旧回答' },
    { role: 'assistant', content: '旧回答的补充' },
    { role: 'user', content: '新的问题' },
    { role: 'assistant', content: '新的回答' }
  ]
  const rendered = []
  const { renderHistory } = run(cut('  const renderHistory =', '  // ---------------- 设置界面'), {
    stopSpeak() {}, followScroll: false, quick: { style: {} }, body: {}, history,
    addMsg: (role, text, options) => rendered.push({ role, text, options })
  }, ['renderHistory'])
  renderHistory()
  assert.deepEqual(rendered.filter(m => m.role === 'her').map(m => m.options.voiceContext), ['', firstQuestion.slice(0, 1200), firstQuestion.slice(0, 1200), '新的问题'])
  assert.ok(rendered.filter(m => m.role === 'her').every(m => !m.options.voiceContext.includes('.pdf')))
})

await test('automatic and manual reading share exactly the streamed raw reply and current-question context', async () => {
  const calls = []
  const raw = '[勉强忍住笑] 笨蛋，这次做得很棒。\n```js\nexample()\n```\n请看这里。[S1]'
  const question = '我是不是又做错了？' + '问'.repeat(1300)
  const h = sendHarness(async () => [], async (_, delta) => { delta(raw, ''); return raw }, {
    window: { NANALY_VOICE: true }, crypto: { randomUUID: () => 'streamed-speech' },
    voiceController: { chime() {}, speak: (text, options) => calls.push({ text, options }) }
  })
  await h.send(question, 'article')
  assert.equal(calls.length, 1)
  const payload = h.speechPayload(h.bubbles[1])
  assert.equal(calls[0].text, payload.rawText)
  assert.equal(calls[0].text, raw)
  assert.equal(calls[0].options.context, payload.context)
  assert.equal(payload.context, question.slice(0, 1200))
  assert.equal(calls[0].options.automatic, true)
})

await test('failed partial replies retain their own raw emotion cues and question for later reading', async () => {
  const h = sendHarness(async () => [], async (_, delta) => { delta('[担心地看着你] 我听见了。', ''); throw new Error('offline stream failed') })
  await h.send('这道题让我很难过', 'article')
  const payload = h.speechPayload(h.bubbles[1])
  assert.equal(payload.rawText, '[担心地看着你] 我听见了。\n（回答未完成）')
  assert.equal(payload.context, '这道题让我很难过')
})

await test('voice connection exposes the configured semantic model and reports planning as a cancellable loading state', () => {
  let createOptions, subscriber
  const toggles = new Map(), attributes = new Map(), usages = []
  const button = { parentNode: { dataset: { voiceId: 'the-reply' } }, classList: { toggle: (name, on) => toggles.set(name, on) }, setAttribute: (name, value) => attributes.set(name, value) }
  const addUsage = value => usages.push(value)
  run(cut('  if (window.NANALY_VOICE) {', '  refreshContext()\n  resetDwell()'), {
    cfg: { visionBaseURL: 'https://api.siliconflow.cn/v1', visionModel: 'saved-semantic-model' }, secrets: { visionKey: 'offline-placeholder' },
    panel: {}, body: { querySelectorAll: () => [button] }, addUsage, addMsg() {}, showKeyUI() {},
    window: { NANALY_VOICE: {
      create(options) { createOptions = options; return { subscribe(callback) { subscriber = callback } } }, mount: () => ({})
    } }
  })
  assert.equal(createOptions.getConnection().model, 'saved-semantic-model')
  assert.equal(createOptions.onUsage, addUsage)
  const usage = { prompt_tokens: 12, completion_tokens: 4 }
  createOptions.onUsage(usage)
  assert.equal(usages[0], usage)
  subscriber({ id: 'the-reply', phase: 'planning' })
  assert.equal(toggles.get('is-loading'), true)
  assert.match(button.title, /理解语气.*点击停止/)
  assert.equal(attributes.get('aria-label'), button.title)
  subscriber({ id: 'the-reply', phase: 'playing' })
  assert.equal(toggles.get('is-loading'), false)
  assert.equal(button.title, '停止朗读')
  subscriber(null)
  assert.equal(attributes.get('aria-pressed'), 'false')
})


await test('the real addMsg path registers raw metadata before attaching the reading button', () => {
  const makeNode = (tag, className = '', html = '') => ({ tag, className, innerHTML: html, children: [], dataset: {},
    querySelector(selector) { return this.children.find(child => selector === '.' + child.className) || null },
    appendChild(child) { this.children.push(child); child.parentNode = this },
    setAttribute() {}, addEventListener(type, callback) { this[type] = callback }
  })
  const calls = []
  const { addMsg, speechPayload } = run(speechCode + '\n' + cut('  const addMsg =', '  // ---------------- 朗读') + '\n' + cut('  const addSpeakBtn =', '  const renderHistory ='), {
    synth: null, window: { NANALY_VOICE: true }, crypto: { randomUUID: () => 'normal-message' },
    voiceController: { state: () => null, speak: (raw, options) => calls.push({ raw, options }) },
    body: { appendChild() {} }, el: makeNode, mdToHtml: text => 'rendered: ' + text, escapeHtml: text => text,
    enhance() {}, renderSources() {}, scrollBottom() {}
  }, ['addMsg', 'speechPayload'])
  const node = addMsg('her', '[蹭蹭] 我陪你。', { voiceContext: '今天有点难过' })
  node.querySelector('.nanaly-speak').click()
  assert.equal(calls[0].raw, '[蹭蹭] 我陪你。')
  assert.equal(calls[0].options.context, '今天有点难过')
  assert.equal(speechPayload(addMsg('her', '你好')).context, '')
})

await test('navigation follow-up captures the triggering question before its deferred message', () => {
  let callback
  const messages = []
  const { afterNav } = run(cut('  const afterNav =', '  // 本地快速通道'), {
    uiRevision: 1, view: 'chat', setTimeout: fn => { callback = fn }, refreshContext() {},
    location: { pathname: '/archive/' }, SECTIONS: [{ url: '/archive/' }], currentArticle: () => null,
    addMsg: (role, text, options) => messages.push({ role, text, options }), logHer() {}
  }, ['afterNav'])
  afterNav('带我去归档'); callback()
  assert.equal(messages[0].options.voiceContext, '带我去归档')
})


await test('EOF without a completion marker rejects and preserves the last streamed text', async () => {
  const deltas = []
  const { stream } = streamHarness(async () => new Response(sse('partial answer')))
  await assert.rejects(stream([], value => deltas.push(value), false, new AbortController().signal), /完成前结束/)
  assert.deepEqual(deltas, ['partial answer'])
})
await test('a stop finish_reason permits EOF even when a compatible gateway omits DONE', async () => {
  const raw = sse('complete') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
  const { stream } = streamHarness(async () => new Response(raw))
  assert.equal(await stream([], () => {}, false, new AbortController().signal), 'complete')
})
await test('oversize SSE events, answer and reasoning stop reading and release the stream', async () => {
  for (const raw of [
    'data: ' + ' '.repeat(300000),
    sse('x'.repeat(70000)) + sse('x'.repeat(70000)),
    Array.from({ length: 5 }, () => 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'x'.repeat(60000) } }] }) + '\n\n').join('')
  ]) {
    let cancelled = false
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(raw)) }, cancel() { cancelled = true } }))
    const { stream } = streamHarness(async () => response)
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1000)
    try { await assert.rejects(stream([], () => {}, true, controller.signal), /大小限制/) }
    finally { clearTimeout(timer) }
    assert.equal(cancelled, true)
    assert.equal(response.body.locked, false)
  }
})
await test('model requests never follow redirects or attach browser cookies', async () => {
  const { stream } = streamHarness(async (_, init) => {
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.cache, 'no-store')
    return new Response(sse('done') + 'data: [DONE]\n\n')
  })
  assert.equal(await stream([], () => {}, false, new AbortController().signal), 'done')
})


await test('real new chat turns broadcast short answer state and completion without extra speech', async () => {
  const events = [], speech = []
  const window = { CustomEvent, dispatchEvent: event => events.push(event.detail), NANALY_VOICE: {} }
  const h = sendHarness(async () => [], async (_, delta) => {
    delta('前段\n\n' + '尾'.repeat(220), 'PRIVATE REASONING')
    return '前段\n\n' + '尾'.repeat(220)
  }, { window, canReadPageContext: () => true, crypto,
    el: () => Object.assign(new Bubble(), { querySelector: () => ({}) }),
    voiceController: { chime: value => speech.push(['chime', value]), speak: () => speech.push(['speak']) } })
  assert.equal(h.chatBridge.snapshot().phase, 'idle')
  assert.equal(events.length, 0, 'restored/initial state must not celebrate')
  await h.send('question', 'article')
  assert.deepEqual(events.map(event => event.phase), ['thinking', 'streaming', 'complete'])
  assert.equal(new Set(events.map(event => event.turnId)).size, 1)
  assert.ok(events.every(event => event.text.length <= 180 && !event.text.includes('PRIVATE REASONING')))
  assert.equal(events.at(-1).text, '尾'.repeat(180))
  assert.deepEqual(speech, [['chime', 'done'], ['speak']], 'bridge must not add another speech request')
  const snapshot = h.chatBridge.snapshot(); snapshot.text = 'changed'
  assert.equal(h.chatBridge.snapshot().text, '尾'.repeat(180))
  h.chatBridge.clear()
  assert.equal(events.at(-1).phase, 'idle')
})
await test('stream state coalesces at 250ms and terminal state cancels queued text immediately', () => {
  let now = 0, nextId = 0, unlocked = true
  const events = [], jobs = new Map()
  const { chatBridge } = run(cut('  const chatBridge =', '  /* 忙的时候'), {
    Date: class extends Date { static now() { return now } },
    canReadPageContext: () => unlocked,
    window: { CustomEvent, dispatchEvent: event => events.push({ at: now, ...event.detail }) },
    setTimeout: (fn, delay) => { jobs.set(++nextId, { fn, at: now + delay }); return nextId },
    clearTimeout: id => jobs.delete(id)
  }, ['chatBridge'])
  const turn = { controller: new AbortController() }
  chatBridge.begin(turn)
  for (let i = 0; i < 300; i++) chatBridge.publish(turn, 'streaming', '片段' + i)
  assert.equal(events.filter(event => event.phase === 'streaming').length, 1)
  assert.equal(jobs.size, 1)
  now = 250
  for (const [id, job] of [...jobs]) { jobs.delete(id); job.fn() }
  assert.equal(events.at(-1).text, '片段299')
  chatBridge.publish(turn, 'streaming', 'queued private')
  turn.controller.abort()
  assert.equal(events.at(-1).phase, 'cancelled')
  assert.equal(events.at(-1).text, '')
  assert.equal(jobs.size, 0)
  chatBridge.publish(turn, 'complete', 'late result')
  assert.equal(events.at(-1).phase, 'cancelled')
  const next = { controller: new AbortController() }; chatBridge.begin(next)
  chatBridge.publish(next, 'streaming', 'private')
  unlocked = false
  assert.equal(chatBridge.snapshot().text, '')
  chatBridge.publish(next, 'complete', 'private complete')
  assert.equal(events.at(-1).text, '')
})
await test('actual cancellation, discard and failure publish the correct immediate terminal state', async () => {
  for (const discard of [false, true]) {
    const waiting = deferred(), events = []
    const h = sendHarness(() => waiting.promise, async () => 'must not run', {
      canReadPageContext: () => true, window: { CustomEvent, dispatchEvent: event => events.push(event.detail) }
    })
    const pending = h.send('question', 'article')
    h.stopStream(discard)
    assert.ok(events.some(event => event.phase === 'cancelled'), 'cancel must be synchronous')
    assert.equal(events.at(-1).text, '')
    await pending
    waiting.resolve([])
    assert.equal(events.at(-1).phase, discard ? 'idle' : 'cancelled')
    assert.ok(!events.some(event => event.phase === 'complete'))
  }
  const events = []
  const h = sendHarness(async () => [], async () => { throw new Error('fixture outage') }, {
    canReadPageContext: () => true, window: { CustomEvent, dispatchEvent: event => events.push(event.detail) }
  })
  await h.send('question', 'article')
  assert.equal(events.at(-1).phase, 'error')
  assert.equal(events.at(-1).text, '')
})
await test('reading actions reuse send, bound selections and never inspect a locked page', async () => {
  const requests = [], notices = [], events = []
  let unlocked = true, selectionReads = 0
  const h = sendHarness(async text => { requests.push(text); return [] }, async () => '解释完成', {
    canReadPageContext: () => unlocked, currentArticle: () => ({ title: '文章' }), openPanel() {},
    addMsg: (role, text) => { if (role === 'sys') notices.push(text); return new Bubble() },
    window: { CustomEvent, dispatchEvent: event => events.push(event.detail),
      getSelection: () => { selectionReads++; return 'selected paragraph' } }
  })
  await h.contextAction('explain-selection', { text: '字'.repeat(6100) })
  assert.equal(requests.length, 1)
  assert.equal((requests[0].match(/字/g) || []).length, 6000)
  assert.ok(notices.some(text => /6000.*截取/.test(text)))
  await h.contextAction('summarize')
  assert.equal(requests.length, 2)
  assert.match(requests[1], /总结.*文章/)
  await h.contextAction('explain-selection', { text: '' })
  assert.ok(notices.some(text => /先选中/.test(text)))
  unlocked = false
  await h.contextAction('explain-selection')
  assert.equal(selectionReads, 0)
  assert.equal(requests.length, 2)
  assert.ok(notices.some(text => /先解锁站点/.test(text)))
})


await test('reading shortcuts preserve busy/key boundaries and do not send draft attachments', async () => {
  for (const busy of [false, true]) {
    let requested = 0, keyPrompts = 0
    const h = sendHarness(async () => { requested++; return [] }, async () => 'unused', {
      busy, secrets: {}, canReadPageContext: () => true, openPanel() {}, currentArticle: () => ({ title: 'article' }),
      showKeyUI: () => { keyPrompts++ },
      vision: { refs: () => [{ id: 'draft-photo' }], loading: () => false },
      fileTray: { refs: () => [{ id: 'draft-document' }], loading: () => false }
    })
    assert.equal(await h.contextAction('summarize'), false)
    assert.equal(requested, 0)
    assert.equal(keyPrompts, busy ? 0 : 1)
  }
  let attached
  const h = sendHarness(async (_text, _mode, _signal, _history, images, files) => {
    attached = [images, files]; return []
  }, async () => 'done', {
    canReadPageContext: () => true, openPanel() {}, currentArticle: () => ({ title: 'article' }),
    vision: { refs: () => [{ id: 'draft-photo' }], loading: () => false, take() { throw new Error('must retain draft') } },
    fileTray: { refs: () => [{ id: 'draft-document' }], loading: () => false, take() { throw new Error('must retain draft') } }
  })
  assert.equal(await h.contextAction('summarize'), true)
  assert.equal(attached[0].length, 0); assert.equal(attached[1].length, 0)
})

console.log(`\n${passed} chat regression checks passed`)
