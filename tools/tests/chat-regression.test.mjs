// Exercise browser chat code with local streams and small DOM doubles; no service calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../source/js/noimpty-ai.js', import.meta.url), 'utf8')
const cut = (start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `Missing source boundary: ${start}`)
  return source.slice(from, to)
}
const run = (code, globals = {}, names = []) => {
  const context = vm.createContext({ TextEncoder, TextDecoder, AbortController, DOMException,
    setTimeout, clearTimeout, URL, ...globals })
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
const sse = (content, eol = '\n') => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + eol + eol

const streamHarness = fetch => run(abortableCode + '\n' + streamCode, {
  fetch, lastUsage: null,
  cfg: { model: 'mock', reasonModel: 'mock-reason', baseURL: 'https://example.invalid' },
  DEFAULTS: { reasonModel: 'mock-reason', reasonEffort: 'high' },
  secrets: { apiKey: 'test-placeholder' }
}, ['stream'])

await test('SSE handles every UTF-8 byte split, CRLF, usage and final event without newline', async () => {
  const raw = sse('你好', '\r\n') + 'data: ' + JSON.stringify({ choices: [{ delta: { content: '喵' } }] })
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
  const raw = 'data: {"choices":\ndata: [{"delta":{"reasoning_content":"想","content":"答"}}]}\n\n'
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
  const value = '{"asks":{},"posts":{"__proto__":{"n":4,"at":1},"bad":null},"since":"bad"}'
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
  constructor() { this.children = []; this.innerHTML = ''; this.className = ''; this.removed = false }
  contains(node) { return this.children.includes(node) }
  replaceChildren(...children) { this.children = children }
  remove() { this.removed = true }
}
const sendHarness = (buildMessages, stream) => {
  const logs = [], bubbles = [], busyStates = []
  const controller = run(abortableCode + '\n' + cut('  const stopStream =', '  const addMsg =') + '\n' +
    cut('  const send =', '  // ---------------- 事件'), {
    busy: false, view: 'chat', activeTurn: null, abortCtl: null, uiRevision: 0,
    secrets: { apiKey: 'test-placeholder' }, input: { value: 'question', style: {} },
    brain: 'off', subLine: {}, followScroll: false, currentArticle: () => null,
    rememberAsk() {}, addMsg: () => { const node = new Bubble(); bubbles.push(node); return node },
    el: () => new Bubble(), buildMessages, stream, wantsBrain: () => false,
    setBusy: value => busyStates.push(value), mdToHtml: text => text, escapeHtml: text => text,
    enhance: async () => {}, hideActFragment: text => text, splitAction: text => ({ text, act: null }),
    showUsage() {}, addSpeakBtn() {}, scrollBottom() {}, logTurn: (...args) => logs.push(args), setSubLine() {}
  }, ['send', 'stopStream'])
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
  const { buildMessages } = run(cut('  const WEB_PREFIX', '  /* 这几条消息的') + '\n' +
    cut('  const buildMessages', '  // 模型把指令'), {
    PERSONA: 'persona', TIME_RULES: 'time', currentArticle: () => null, postDigest: async () => 'posts', selfLog: async () => 'journal',
    searchCorpus: async () => { throw new Error('SEARCH_LOCKED') }, window: { NOIMPTY_SEARCH: { explain: () => '还没有解锁' } },
    getSiteMap: async () => [], location: { pathname: '/' }, history: [], historyAnchor: 0,
    historyWindow: () => ({ list: [], anchorAt: 0 }), withTimeMarks: () => [], memoryDigest: () => '', nowLine: () => 'now'
  }, ['buildMessages'])
  const messages = await buildMessages('全站搜：递归', 'site', new AbortController().signal)
  const all = messages.map(message => message.content).join('\n')
  assert.match(all, /还没有解锁/)
  assert.doesNotMatch(all, /本次关键词没有检索到|这个话题他还没写过/)
})

await test('Wrong vault password never replaces the current in-memory keys or settings', async () => {
  const fields = Object.fromEntries(['apiKey', 'tavilyKey', 'ghToken', 'pass', 'baseURL', 'model', 'reasonModel', 'reasonEffort']
    .map(name => [name, { value: '' }]))
  let click
  const box = { isConnected: true, querySelector: selector => fields[selector.match(/"([^"]+)"/)[1]],
    querySelectorAll: () => [], addEventListener: (_, fn) => { click = fn } }
  const originalCfg = { baseURL: 'https://api.example.test', model: 'old-model', reasonModel: 'old-reason', reasonEffort: 'high' }
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
  const fields = Object.fromEntries(['apiKey', 'tavilyKey', 'ghToken', 'pass', 'baseURL', 'model', 'reasonModel', 'reasonEffort']
    .map(name => [name, { value: '' }]))
  let click, writes = 0
  const box = { isConnected: true, querySelector: selector => fields[selector.match(/"([^"]+)"/)[1]],
    querySelectorAll: () => [], addEventListener: (_, fn) => { click = fn } }
  const cfg = { baseURL: 'https://api.example.test', model: 'old-model', reasonModel: 'old-reason', reasonEffort: 'high' }
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

const searchSource = readFileSync(new URL('../../source/js/noimpty-search.js', import.meta.url), 'utf8')
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
  Object.assign(h.context, { searchRevision: 0, postDigestCache: 'old posts', selfLogCache: 'old journal', siteMap: ['old url'], stopStream: discard => { assert.equal(discard, undefined) } })
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

console.log(`\n${passed} chat regression checks passed`)
