/* Real core + workspace + research + provider, with offline network/storage adapters. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'

const read = name => readFileSync(new URL('../../source/js/' + name + '.js', import.meta.url), 'utf8')
const core = read('noimpty-ai')
const cut = (start, end) => {
  const a = core.indexOf(start), b = core.indexOf(end, a)
  assert.ok(a >= 0 && b > a, 'Missing integration boundary: ' + start)
  return core.slice(a, b)
}
// Reuse the existing small DOM fixture; browser rendering is covered separately.
const existingFixture = readFileSync(new URL('./nanaly-workspace.test.mjs', import.meta.url), 'utf8')
const Element = vm.runInNewContext(existingFixture.slice(existingFixture.indexOf('class Element'), existingFixture.indexOf('\nconst boot =')) + '\nElement')
// Match the DOM behavior that removes the current settings view when history is redrawn.
class UIElement extends Element {
  constructor(tag, document) { super(tag, document); this.dataset = {} }
  set innerHTML(value) { this.markup = String(value); this.replaceChildren() }
  get innerHTML() { return this.markup || '' }
}
const storage = initial => ({ values: new Map(Object.entries(initial || {})),
  getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) } })
const plain = value => JSON.parse(JSON.stringify(value))
const corpus = [{ title: '矩阵转置', url: '/matrix/', text: '非方阵转置时，行数和列数互换。', sections: [{ title: '转置', id: 'transpose-real', text: '非方阵转置时，行数和列数互换。' }] }]
const cfg = { baseURL: 'https://api.deepseek.com', model: 'saved-text-model', reasonModel: 'saved-reason-model', reasonEffort: 'high', visionBaseURL: 'https://api.siliconflow.cn/v1', visionModel: 'saved-vision-model', proactive: 'off' }
const keys = { apiKey: 'offline-text-placeholder', visionKey: 'offline-vision-placeholder' }
const picture = { id: 'picture-core-001', name: '矩阵.png', type: 'image/jpeg' }
const imageURL = 'data:image/jpeg;base64,AA=='

const harness = ({ saved = storage({ 'nanaly-deep-v1': 'off' }), imageEntries = [], failFinal = false, article = null, credentials = keys } = {}) => {
  const requests = [], bubbles = [], usage = [], jobs = []
  const document = { activeElement: null, createElement: tag => new UIElement(tag, document) }
  const images = new Map(imageEntries)
  const indexedDB = { open() {
    const request = { result: { transaction() {
      const tx = { objectStore: () => ({ get(id) { const result = { result: images.get(id) }; queueMicrotask(() => tx.oncomplete()); return result } }) }
      return tx
    } } }
    queueMicrotask(() => request.onsuccess())
    return request
  } }
  const window = { localStorage: saved, crypto: { randomUUID }, location: { origin: 'https://blog.test' }, indexedDB,
    setTimeout, clearTimeout, addEventListener() {}, Event,
    NOIMPTY_SEARCH: { loadCorpus: async () => corpus, loadJournal: async () => [], explain: x => x } }
  const panel = document.createElement('div'), body = document.createElement('div'), input = document.createElement('textarea')
  panel.append(body, input)
  const quick = document.createElement('div'), sendBtn = document.createElement('button')
  panel.classList.contains = () => true
  let context
  const responseState = { failFinal }
  const fetch = async (url, init) => {
    const payload = JSON.parse(init.body)
    requests.push({ url, auth: init.headers.Authorization, payload, workspaceAtRequest: plain(window.workspace.snapshot()) })
    if (!payload.stream) {
      assert.ok(payload.tools && payload.tools.some(t => t.function.name === 'search_blog'))
      const observedTool = payload.messages.some(m => m.role === 'tool')
      const message = observedTool
        ? { role: 'assistant', content: '证据已足够', reasoning_content: '根据实际片段回答' }
        : { role: 'assistant', content: '查博客', reasoning_content: '需要核对原文', tool_calls: [{ id: 'offline-search-1', type: 'function', function: { name: 'search_blog', arguments: '{"query":"非方阵转置"}' } }] }
      return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 0, completion_tokens: 0 } }), { status: 200 })
    }
    if (responseState.failFinal) return new Response(JSON.stringify({ error: { message: 'offline simulated outage' } }), { status: 503 })
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: '行列互换。[S1]' } }] }) + '\n\ndata: [DONE]\n\n')
  }
  context = vm.createContext({ window, document, indexedDB, localStorage: saved, URL, Response, Event, AbortController, DOMException, TextEncoder, TextDecoder, setTimeout, clearTimeout, fetch,
    cfg: { ...cfg }, secrets: { ...credentials }, busy: false, view: 'chat', activeTurn: null, abortCtl: null, uiRevision: 0,
    research: null, vision: null, input, panel, body, quick, sendBtn, delight: { clear() {} }, subLine: {}, followScroll: false, lastUsage: null,
    currentArticle: () => article, canReadPageContext: () => true, location: { origin: 'https://blog.test', pathname: '/', href: 'https://blog.test/' },
    getSiteMap: async () => [], addUsage: value => usage.push(value),
    addMsg: (role, value) => { const node = document.createElement('div'); node.innerHTML = value; node.contains = x => node.children.includes(x); bubbles.push(node); body.appendChild(node); return node },
    el: (tag, className = '', html) => { const node = document.createElement(tag); node.className = className; if (html !== undefined) node.innerHTML = html; node.contains = x => node.children.includes(x); return node },
    setBusy: on => { context.busy = on; window.workspace.refresh() },
    enhance: async () => {}, renderSources() {}, showUsage() {}, addSpeakBtn() {}, scrollBottom() {}, setSubLine() {},
    mdToHtml: x => x, escapeHtml: x => x, launcher: { classList: { add() {} } },
    stopSpeak() {}, refreshContext() {}, hasVault: () => false, locked: () => false,
    showSetup: () => {
      const box = context.subject.setupShell('')
      const field = document.createElement('input')
      field.type = 'password'; field.className = 'setup-api-key'
      box.appendChild(field)
      return box
    }
  })
  for (const name of ['nanaly-workspace', 'nanaly-provider', 'nanaly-vision', 'nanaly-research']) vm.runInContext(read(name), context)
  Object.assign(context, { history: [], historyAnchor: 0, LS_DEEP: 'nanaly-deep-v1' })
  const pieces = [
    cut('  const LS_CFG =', '  /* ⚠️'),
    cut('  const HISTORY_SEND', '  // 送进模型之前'),
    cut('  const logTurn =', '  const locked ='),
    cut('  const wantsBrainRe', '  const BRAIN_LABEL'),
    cut('  const PERSONA =', '  // ---------------- 工具'),
    cut('  const WEEKDAY =', '  /* 跨文章检索'),
    cut('  const loadCorpus =', '  const searchCorpus ='),
    cut('  const searchWeb =', '  // ---------------- 长期记忆'),
    cut('  const LS_MEM', '  // ---------------- 操控页面'),
    cut('  const abortable =', '  /* 忙的时候'),
    cut('  const stopStream =', '  const addMsg ='),
    cut('  const renderHistory =', '  // 首次设置：'),
    cut('  const showKeyUI =', '  // ---------------- Token 账'),
    cut('  const WEB_PREFIX', '  // 模型把指令'),
    cut('  const ACT_RE =', '  const checkArticleLinks =')
  ]
  vm.runInContext(pieces.join('\n') + '\nthis.subject = { send, buildMessages, stream, stopStream, workspace, setupShell, backToChat }', context)
  const workspace = context.subject.workspace
  window.workspace = workspace
  context.history = workspace.readLog()
  const adapterStart = core.indexOf('    onHistoryChange: log => {', core.indexOf('  workspace?.mount({'))
  const adapterEnd = core.indexOf('    send:', adapterStart)
  assert.ok(adapterStart >= 0 && adapterEnd > adapterStart, 'Missing real workspace history adapter')
  const historyAdapter = vm.runInContext('({' + core.slice(adapterStart, adapterEnd) + '})', context)
  assert.equal(workspace.mount({ panel, body, input, isBusy: () => context.busy, isLocked: () => context.view !== 'chat',
    onHistoryChange: historyAdapter.onHistoryChange,
    send: (...args) => { const job = context.subject.send(...args); jobs.push(job); return job }
  }), true)
  return { ...context.subject, workspace, saved, context, requests, usage, bubbles, jobs, responseState, body, input,
    finalRequests: () => requests.filter(r => r.payload.stream), planningRequests: () => requests.filter(r => !r.payload.stream) }
}
let passed = 0
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name, error) }
}

await test('beginTurn persists immediately but final request and stored history each contain the question once', async () => {
  const h = harness()
  const question = '非方阵可以转置吗？'
  await h.send(question, 'article')
  assert.equal(h.planningRequests().length, 2, 'must execute the real research loop')
  const initial = h.planningRequests()[0].workspaceAtRequest.sessions[0]
  assert.equal(initial.pending.text, question, 'question must be saved before the first model request')
  assert.equal(initial.messages.filter(m => m.role === 'user' && m.content === question).length, 1)
  assert.equal(h.planningRequests()[0].payload.messages.filter(m => m.role === 'user' && m.content.includes(question)).length, 1)
  const request = h.finalRequests()[0]
  assert.ok(request, 'core must reach the actual stream/provider request')
  assert.equal(request.payload.messages.filter(m => m.role === 'user' && m.content === question).length, 1)
  const history = h.workspace.readLog()
  assert.equal(history.filter(m => m.role === 'user' && m.content === question).length, 1)
  assert.equal(history.filter(m => m.role === 'assistant').length, 1)
  assert.equal(h.workspace.snapshot().sessions[0].pending, null)
  assert.equal(request.auth, 'Bearer ' + keys.apiKey)
  assert.equal(request.payload.model, cfg.model)
  assert.ok(history[1].sources.some(s => s.url === 'https://blog.test/matrix/#transpose-real'))
  assert.ok(request.payload.messages.some(m => typeof m.content === 'string' && m.content.includes('非方阵转置时')))
})
await test('confirmed memory reaches the final request while an unconfirmed proposal does not', async () => {
  const h = harness()
  assert.equal(h.workspace.confirmMemory({ kind: 'goal', text: '必须排除的未确认内容', confirmed: false }), false)
  assert.ok(h.workspace.confirmMemory({ kind: 'preference', text: '解释矩阵时先给一个二乘三的例子', confirmed: true }))
  await h.send('非方阵怎么转置', 'article')
  const all = h.finalRequests()[0].payload.messages.map(m => typeof m.content === 'string' ? m.content : '').join('\n')
  assert.match(all, /本机明确确认/)
  assert.match(all, /二乘三的例子/)
  assert.doesNotMatch(all, /必须排除的未确认内容/)
})
await test('historical image follow-up uses visual credentials while a new image-free conversation returns to the original text configuration', async () => {
  const h = harness({ imageEntries: [[picture.id, { dataURL: imageURL }]] })
  h.workspace.writeLog([{ role: 'user', content: '解释图片中的矩阵', at: Date.now() - 3000, attachments: [picture] }, { role: 'assistant', content: '先看这两行', at: Date.now() - 2000 }])
  h.context.history = h.workspace.readLog()
  await h.send('第二行呢？', 'article')
  const request = h.finalRequests()[0]
  assert.equal(request.auth, 'Bearer ' + keys.visionKey)
  assert.equal(request.payload.model, cfg.visionModel)
  assert.ok(request.payload.messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url' && p.image_url.url === imageURL)))
  assert.ok(h.workspace.createSession('文字话题'))
  await h.send('你好', 'article')
  const plainRequest = h.finalRequests()[1]
  assert.equal(plainRequest.payload.model, cfg.model)
  assert.equal(plainRequest.auth, 'Bearer ' + keys.apiKey)
  assert.ok(plainRequest.payload.messages.every(m => typeof m.content === 'string'))
})
await test('zero-response failure persists the user question across reload and retry does not duplicate it', async () => {
  const h = harness({ failFinal: true })
  const question = '非方阵转置的步骤是什么？'
  await h.send(question, 'article')
  assert.equal(h.workspace.readLog().length, 1)
  assert.equal(h.workspace.readLog()[0].content, question)
  const pending = h.workspace.snapshot().sessions[0].pending
  assert.equal(pending.status, 'failed')
  assert.equal(pending.partial, '')
  assert.match(pending.error, /offline simulated outage/)
  const restored = harness({ saved: h.saved })
  assert.equal(restored.workspace.readLog().length, 1)
  assert.equal(restored.workspace.readLog()[0].content, question)
  assert.equal(restored.workspace.retry('retry'), true)
  await Promise.all(restored.jobs)
  const log = restored.workspace.readLog()
  assert.equal(log.filter(m => m.role === 'user' && m.content === question).length, 1)
  assert.equal(log.filter(m => m.role === 'assistant').length, 1)
  assert.equal(restored.workspace.snapshot().sessions[0].pending, null)
  assert.equal(restored.finalRequests()[0].payload.messages.filter(m => m.role === 'user' && m.content === question).length, 1)
})
await test('persisted verified sources are reintroduced after a new page runtime for a follow-up', async () => {
  const first = harness()
  await first.send('非方阵能否转置？', 'article')
  const oldSource = first.workspace.readLog().find(m => m.role === 'assistant').sources[0]
  const restored = harness({ saved: first.saved })
  await restored.send('那这个依据的条件呢？', 'article')
  const firstPlan = restored.planningRequests()[0].payload.messages.map(m => m.content).join('\n')
  assert.ok(firstPlan.includes('[' + oldSource.id + ']'))
  assert.ok(firstPlan.includes(oldSource.url))
  assert.ok(firstPlan.includes(oldSource.quote))
  assert.ok(restored.workspace.readLog().at(-1).sources.some(s => s.id === oldSource.id && s.url === oldSource.url))
})


await test('a retry without API credentials restores history without removing the settings view', async () => {
  for (const kind of ['retry', 'continue']) {
    const h = harness({ credentials: {} })
    h.workspace.writeLog([{ role: 'user', content: '此前的问题', at: 1 }, { role: 'assistant', content: '此前的回答', at: 2 }])
    const token = h.workspace.beginTurn('保留这个未完成的问题', 'article')
    h.workspace.writeLog([...h.workspace.readLog(), { role: 'assistant', content: '保留这段未完成的回答', at: 3 }])
    h.workspace.finishTurn(token, { status: 'interrupted', partial: '保留这段未完成的回答' })
    const original = plain(h.workspace.readLog())
    assert.equal(h.workspace.retry(kind), true)
    const setup = h.body.querySelector('.nanaly-setup')
    assert.ok(setup, 'missing credentials must open the real settings shell')
    const keyField = setup.querySelector('.setup-api-key')
    assert.ok(keyField, 'the API key field must be present')
    keyField.value = 'unsaved-local-placeholder'
    await Promise.all(h.jobs)
    await Promise.resolve()
    assert.equal(h.context.view, 'setup')
    assert.equal(h.body.querySelector('.nanaly-setup'), setup, 'history recovery must not replace the settings UI')
    assert.equal(keyField.value, 'unsaved-local-placeholder', 'the user must retain an in-progress setting edit')
    assert.equal(h.input.disabled, true, 'the composer remains disabled while setup is visible')
    assert.deepEqual(plain(h.workspace.readLog()), original)
    assert.deepEqual(plain(h.context.history), original)
    assert.equal(h.workspace.snapshot().sessions[0].pending.id, token.turnId)
    assert.equal(h.requests.length, 0, 'an unconfigured retry must never reach any model service')
    h.backToChat()
    assert.equal(h.context.view, 'chat')
    assert.equal(h.input.disabled, false)
    assert.equal(h.body.querySelector('.nanaly-setup'), null)
    assert.deepEqual(plain(h.context.history), original)
  }
})

console.log(`\n${passed} core upgrade integration cases passed`)
