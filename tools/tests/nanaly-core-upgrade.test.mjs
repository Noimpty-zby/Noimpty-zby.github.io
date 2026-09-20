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

const harness = ({ saved = storage({ 'nanaly-deep-v1': 'off' }), imageEntries = [], fileEntries = [], failFinal = false, article = null, credentials = keys, titleReply = null } = {}) => {
  const requests = [], bubbles = [], usage = [], jobs = []
  const document = { activeElement: null, createElement: tag => new UIElement(tag, document) }
  const images = new Map(imageEntries), documents = new Map(fileEntries)
  const indexedDB = { open(name) {
    const entries = name === 'nanaly-files-v1' ? documents : images
    const request = { result: { transaction() {
      const tx = { objectStore: () => ({ get(id) { const result = { result: entries.get(id) }; queueMicrotask(() => tx.oncomplete()); return result } }) }
      return tx
    } } }
    queueMicrotask(() => request.onsuccess())
    return request
  } }
  const window = { localStorage: saved, crypto: { randomUUID }, location: { origin: 'https://blog.test' }, indexedDB,
    setTimeout, clearTimeout, addEventListener() {}, Event, AbortController,
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
    if (!payload.stream && !payload.tools) {
      if (titleReply) return titleReply({ url, init, payload })
      return new Response(JSON.stringify({ choices: [{ message: { content: '矩阵转置与行列关系' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }), { status: 200 })
    }
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
    research: null, vision: null, fileTray: null, voiceController: null, voiceUI: null, shell: null, input, panel, body, quick, sendBtn, delight: { clear() {} }, subLine: {}, followScroll: false, lastUsage: null,
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
  for (const name of ['nanaly-files', 'nanaly-workspace', 'nanaly-provider', 'nanaly-vision', 'nanaly-research']) vm.runInContext(read(name), context)
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
  vm.runInContext(pieces.join('\n') + '\nthis.subject = { send, buildMessages, attachmentContent, generateTopicTitle, stream, stopStream, workspace, setupShell, backToChat }', context)
  const workspace = context.subject.workspace
  window.workspace = workspace
  context.history = workspace.readLog()
  const adapterStart = core.indexOf('    onHistoryChange:', core.indexOf('  workspace?.mount({'))
  const adapterEnd = core.indexOf('    send:', adapterStart)
  assert.ok(adapterStart >= 0 && adapterEnd > adapterStart, 'Missing real workspace history adapter')
  const historyAdapter = vm.runInContext('({' + core.slice(adapterStart, adapterEnd) + '})', context)
  assert.equal(workspace.mount({ panel, body, input, isBusy: () => context.busy, isLocked: () => context.view !== 'chat',
    onHistoryChange: historyAdapter.onHistoryChange, generateTitle: context.subject.generateTopicTitle,
    send: (...args) => { const job = context.subject.send(...args); jobs.push(job); return job }
  }), true)
  return { ...context.subject, workspace, saved, context, requests, usage, bubbles, jobs, responseState, body, input,
    finalRequests: () => requests.filter(r => r.payload.stream), planningRequests: () => requests.filter(r => !r.payload.stream && r.payload.tools),
    titleRequests: () => requests.filter(r => !r.payload.stream && !r.payload.tools) }
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


const tick = () => new Promise(resolve => setImmediate(resolve))
const textFile = { id: 'document-core-text-001', name: '复习笔记.md', type: 'text', size: 200,
  pageCount: null, readPages: [], imagePages: [], truncated: false, summary: '已提取全部文字。' }
const textRecord = { ...textFile, text: '只在发送时读取的文件正文：矩阵 A 的形状为二乘三。', images: [], at: 1 }
const scanFile = { id: 'document-core-scan-001', name: '扫描讲义.pdf', type: 'pdf', size: 400,
  pageCount: 4, readPages: [], imagePages: [1, 2], truncated: true, summary: '共 4 页；扫描图 2 页（第 1、2 页）。第 3、4 页未读取。' }
const scanImages = [{ page: 1, dataURL: 'data:image/jpeg;base64,AQ==' }, { page: 2, dataURL: 'data:image/jpeg;base64,Ag==' }]
const scanRecord = { ...scanFile, text: '', images: scanImages, at: 1 }
const flattenText = messages => messages.map(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : m.content).join('\n')
const requestImages = request => request.payload.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url') : [])

await test('real file-only send takes composer files, supplies a useful question and sends local text with SiliconFlow credentials', async () => {
  const h = harness({ fileEntries: [[textFile.id, textRecord]] })
  let selected = [textFile], taken = 0
  h.context.fileTray = { refs: () => selected, loading: () => false, take() { taken++; selected = [] }, clear() { selected = [] }, restore(refs) { selected = refs }, refresh() {} }
  await h.send('', 'article')
  await tick()
  const final = h.finalRequests()[0]
  assert.equal(taken, 1)
  assert.equal(final.auth, 'Bearer ' + keys.visionKey)
  assert.equal(final.payload.model, cfg.visionModel)
  assert.ok(final.payload.messages.every(m => typeof m.content === 'string'), 'a text document does not invent image parts')
  assert.match(flattenText(final.payload.messages), /只在发送时读取的文件正文/)
  assert.match(flattenText(h.planningRequests()[0].payload.messages), /只在发送时读取的文件正文/)
  const log = h.workspace.readLog()
  assert.match(log[0].content, /请阅读这些文件/)
  assert.equal(log[0].files[0].name, textFile.name)
  assert.equal(h.saved.getItem('nanaly-workspace-v1').includes(textRecord.text), false, 'document bytes stay out of localStorage')
  const title = h.titleRequests()[0]
  assert.ok(title, 'real workspace completion must invoke the real title generator')
  assert.match(flattenText(title.payload.messages), /文件：复习笔记.md/)
  assert.equal(flattenText(title.payload.messages).includes(textRecord.text), false, 'naming needs a filename, not the document body')
})

await test('scan pages and directly attached images share two slots with explicit unread-page notices in planning and final requests', async () => {
  const secondPicture = { ...picture, id: 'picture-core-002', name: '补充.png' }
  for (const count of [0, 1, 2]) {
    const attachments = [picture, secondPicture].slice(0, count)
    const h = harness({ fileEntries: [[scanFile.id, scanRecord]], imageEntries: attachments.map(p => [p.id, { dataURL: imageURL }]) })
    await h.send('阅读扫描讲义并结合图片解释', 'article', { attachments, files: [scanFile] })
    for (const request of [...h.planningRequests(), ...h.finalRequests()]) {
      const images = requestImages(request)
      assert.equal(images.length, 2, 'combined current-turn budget with ' + count + ' direct images')
      assert.equal(images.filter(p => scanImages.some(scan => scan.dataURL === p.image_url.url)).length, 2 - count)
      const text = flattenText(request.payload.messages)
      assert.match(text, /第 3、4 页未读取/)
      if (count === 1) assert.match(text, /第 2 页扫描图未发送、未读取/)
      if (count === 2) assert.match(text, /第 1、2 页扫描图未发送、未读取/)
      assert.equal(request.auth, 'Bearer ' + keys.visionKey)
      assert.equal(request.payload.model, cfg.visionModel)
    }
    assert.equal(h.workspace.readLog()[0].files[0].truncated, true)
  }
})

await test('real failed document send preserves refs across reload and retry rereads its body without duplicate questions', async () => {
  const first = harness({ fileEntries: [[textFile.id, textRecord]], failFinal: true })
  const question = '文件里矩阵 A 的形状是什么？'
  await first.send(question, 'article', { files: [textFile] })
  assert.equal(first.workspace.snapshot().sessions[0].pending.status, 'failed')
  assert.equal(first.workspace.snapshot().sessions[0].pending.files[0].id, textFile.id)
  const restored = harness({ saved: first.saved, fileEntries: [[textFile.id, textRecord]] })
  assert.equal(restored.workspace.retry('retry'), true)
  await Promise.all(restored.jobs)
  assert.equal(restored.workspace.readLog().filter(m => m.role === 'user' && m.content === question).length, 1)
  assert.equal(restored.workspace.readLog().filter(m => m.role === 'assistant').length, 1)
  assert.equal(restored.workspace.readLog()[0].files[0].id, textFile.id)
  assert.match(flattenText(restored.finalRequests()[0].payload.messages), /只在发送时读取的文件正文/)
  assert.equal(restored.workspace.snapshot().sessions[0].pending, null)
})

await test('a missing retried document fails clearly and keeps the question and file ref recoverable', async () => {
  const first = harness({ fileEntries: [[textFile.id, textRecord]], failFinal: true })
  await first.send('读取文件里的矩阵', 'article', { files: [textFile] })
  const restored = harness({ saved: first.saved })
  assert.equal(restored.workspace.retry('retry'), true)
  await Promise.all(restored.jobs)
  assert.equal(restored.finalRequests().length, 0)
  assert.equal(restored.workspace.readLog().filter(m => m.role === 'user').length, 1)
  assert.equal(restored.workspace.readLog()[0].files[0].id, textFile.id)
  const pending = restored.workspace.snapshot().sessions[0].pending
  assert.equal(pending.status, 'failed')
  assert.match(pending.error, /已不在本机.*重新附加/)
})

await test('historical documents are reread only with the file provider credential and absence is stated honestly', async () => {
  for (const credentials of [keys, { apiKey: keys.apiKey }]) {
    const h = harness({ fileEntries: [[textFile.id, textRecord]], credentials })
    h.workspace.writeLog([{ role: 'user', content: '分析这份文件', at: 1, files: [textFile] }, { role: 'assistant', content: '矩阵有两行', at: 2 }])
    h.context.history = h.workspace.readLog()
    await h.send('列数呢', 'article')
    const final = h.finalRequests()[0], combined = flattenText(final.payload.messages)
    if (credentials.visionKey) {
      assert.match(combined, /只在发送时读取的文件正文/)
      assert.equal(final.auth, 'Bearer ' + keys.visionKey)
    } else {
      assert.doesNotMatch(combined, /只在发送时读取的文件正文/)
      assert.match(combined, /本轮未重新读取/)
      assert.equal(final.auth, 'Bearer ' + keys.apiKey)
    }
  }
})

await test('real automatic title requests use the configured provider, disable streaming/tools and bound their output', async () => {
  for (const credentials of [keys, { apiKey: keys.apiKey }]) {
    const h = harness({ credentials })
    await h.send('非方阵可以转置吗？', 'article'); await tick()
    const titles = h.titleRequests()
    assert.equal(titles.length, 1)
    const request = titles[0]
    assert.equal(request.payload.stream, false)
    assert.equal(request.payload.tools, undefined)
    assert.equal(request.payload.max_tokens, 80)
    assert.equal(request.payload.model, credentials.visionKey ? cfg.visionModel : cfg.model)
    assert.equal(request.auth, 'Bearer ' + (credentials.visionKey || credentials.apiKey))
    assert.ok(request.payload.messages.every(m => typeof m.content === 'string'))
    assert.equal(h.workspace.snapshot().sessions[0].title, '矩阵转置与行列关系')
    await h.send('那三乘四呢', 'article'); await tick()
    assert.equal(h.titleRequests().length, 1, 'later answers must not bill another automatic title')
  }
})

await test('real title HTTP failure preserves the completed conversation and local title', async () => {
  const h = harness({ titleReply: async () => new Response('temporarily unavailable', { status: 503 }) })
  await h.send('我的清楚问题', 'article'); await tick()
  assert.equal(h.titleRequests().length, 1)
  assert.equal(h.workspace.snapshot().sessions[0].title, '我的清楚问题')
  assert.equal(h.workspace.snapshot().sessions[0].pending, null)
  assert.equal(h.workspace.readLog().filter(m => m.role === 'assistant').length, 1)
  assert.equal(h.workspace.getProblem(), '')
})

await test('topic rename or deletion aborts the real in-flight title request and blocks a late title', async () => {
  for (const action of ['rename', 'delete']) {
    let requestSignal, finish
    const h = harness({ titleReply: ({ init }) => {
      requestSignal = init.signal
      return new Promise(resolve => { finish = resolve })
    } })
    await h.send('请讨论新的话题', 'article'); await tick()
    assert.equal(requestSignal.aborted, false)
    const id = h.workspace.snapshot().activeId
    if (action === 'rename') h.workspace.renameSession(id, '我自己决定的名字')
    else h.workspace.deleteSession(id)
    assert.equal(requestSignal.aborted, true)
    finish(new Response(JSON.stringify({ choices: [{ message: { content: '迟到的自动标题' } }] })))
    await tick()
    assert.equal(h.workspace.snapshot().sessions.some(s => s.title === '迟到的自动标题'), false)
    if (action === 'rename') assert.equal(h.workspace.snapshot().sessions.find(s => s.id === id).title, '我自己决定的名字')
    else assert.equal(h.workspace.snapshot().sessions.some(s => s.id === id), false)
    const requestsBefore = h.requests.length, aborted = new AbortController(); aborted.abort()
    assert.equal(await h.generateTopicTitle({ messages: [{ role: 'user', content: '不发请求' }], signal: aborted.signal }), '')
    assert.equal(h.requests.length, requestsBefore)
  }
})



await test('four 60,000-character files share one request budget, prioritize current files and retain every reading warning', async () => {
  const marks = ['\uE001', '\uE002', '\uE003', '\uE004']
  const docs = marks.map((mark, i) => ({ ...textFile, id: 'budget-document-000' + i, name: (i < 2 ? '历史' : '当前') + i + '.txt',
    summary: '本机已提取 60000 字符；附件里的图表未读取。', body: mark.repeat(60000) }))
  const h = harness({ fileEntries: docs.map(doc => [doc.id, { ...doc, text: doc.body, images: [] }]) })
  h.workspace.writeLog([{ role: 'user', content: '此前两份文件', at: 1, files: docs.slice(0, 2) }, { role: 'assistant', content: '已经记下此前的问题', at: 2 }])
  h.context.history = h.workspace.readLog()
  await h.send('请优先分析这次新增的两份文件', 'article', { files: docs.slice(2) })
  assert.ok(h.finalRequests().length)
  for (const request of [...h.planningRequests(), ...h.finalRequests()]) {
    const content = flattenText(request.payload.messages)
    const counts = marks.map(mark => content.split(mark).length - 1)
    assert.deepEqual(counts, [0, 0, 24000, 24000], 'each planning/final request must share its own 48k body budget')
    assert.equal(counts.reduce((a, b) => a + b, 0), 48000)
    const fileContext = (content.match(/<附加文件 name=[\s\S]*?<\/附加文件>/g) || []).join('\n')
    assert.ok(fileContext.length < 60000, 'metadata and reading notices also fit beneath 60k file-context characters')
    assert.match(content, /本轮正文仅发送前 24000 \/ 60000 字符/)
    assert.match(content, /附件里的图表未读取/)
  }
  const final = flattenText(h.finalRequests()[0].payload.messages)
  assert.equal((final.match(/此文件正文未重传、未读取/g) || []).length, 2)
  for (const doc of docs) assert.ok(final.includes(doc.name), 'every file remains identifiable after truncation')
  assert.equal(h.workspace.readLog()[0].files.length, 2)
  assert.equal(h.workspace.readLog().filter(m => m.role === 'user').at(-1).files.length, 2)
})

await test('short current documents leave a measured remainder for historical files', async () => {
  const marks = ['\uE011', '\uE012', '\uE013', '\uE014']
  const docs = marks.map((mark, i) => ({ ...textFile, id: 'budget-remainder-000' + i, name: '预算文件' + i + '.txt',
    body: mark.repeat(i < 2 ? 60000 : 10000) }))
  const h = harness({ fileEntries: docs.map(doc => [doc.id, { ...doc, text: doc.body, images: [] }]) })
  h.workspace.writeLog([{ role: 'user', content: '旧文件', at: 1, files: docs.slice(0, 2) }])
  h.context.history = h.workspace.readLog()
  await h.send('对比新旧文件', 'article', { files: docs.slice(2) })
  const final = flattenText(h.finalRequests()[0].payload.messages)
  assert.deepEqual(marks.map(mark => final.split(mark).length - 1), [14000, 14000, 10000, 10000])
  assert.match(final, /本轮正文仅发送前 14000 \/ 60000 字符/)
})

await test('text budgeting preserves short documents, Unicode boundaries and the exact scan image payload', async () => {
  const unicodeFile = { ...scanFile, id: 'budget-unicode-001', name: '字符边界.pdf' }
  const h = harness({ fileEntries: [[unicodeFile.id, { ...scanRecord, text: 'A😀B😀C', images: [scanImages[0]] }]] })
  const budget = { remaining: 5 }
  const parts = await h.attachmentContent('查看文件', [], [unicodeFile], { fileBudget: budget })
  assert.ok(Array.isArray(parts))
  const text = flattenText([{ content: parts }])
  assert.equal(text.isWellFormed(), true)
  assert.match(text, /本轮正文仅发送前 4 \/ 7 字符/)
  assert.ok(text.includes('A😀B'))
  assert.equal(budget.remaining, 1)
  assert.equal(parts.find(part => part.type === 'image_url').image_url.url, scanImages[0].dataURL)
  const marks = ['\uE021', '\uE022']
  const docs = marks.map((mark, i) => ({ ...textFile, id: 'budget-fair-000' + i, name: '长短文件' + i + '.txt', body: mark.repeat(i ? 10 : 60000) }))
  const fair = harness({ fileEntries: docs.map(doc => [doc.id, { ...doc, text: doc.body, images: [] }]) })
  const content = await fair.attachmentContent('读文件', [], docs)
  assert.deepEqual(marks.map(mark => content.split(mark).length - 1), [47990, 10], 'a short second document must not leave half the allowance unused')
})


console.log(`\n${passed} core upgrade integration cases passed`)
