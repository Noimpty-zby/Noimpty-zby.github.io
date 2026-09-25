import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/nanaly-workspace.js', 'utf8')
const KEY = 'nanaly-workspace-v1', LEGACY = 'nanaly-history-v1'
const plain = value => JSON.parse(JSON.stringify(value))
const storage = seed => ({ values: new Map(Object.entries(seed || {})), denied: false,
  getItem(key) { if (this.denied) throw new Error('denied'); return this.values.get(key) ?? null },
  setItem(key, value) { if (this.denied) throw new Error('quota'); this.values.set(key, value) } })
class Element {
  constructor(tag, document) {
    this.tagName = tag; this.document = document; this.children = []; this.attributes = new Map(); this.listeners = new Map()
    this.className = ''; this.value = ''; this.style = {}; this.parentNode = null; this.hidden = false; this.textContent = ''
    this.classList = { toggle: name => { const parts = new Set(this.className.split(/\s+/).filter(Boolean)); const on = !parts.has(name); on ? parts.add(name) : parts.delete(name); this.className = [...parts].join(' '); return on } }
  }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list) }
  dispatchEvent(event) { for (const fn of this.listeners.get(event.type) || []) fn(event) }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)) }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node }
  insertBefore(node, before) { node.parentNode = this; const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, node) }
  replaceChildren(...nodes) { this.children.forEach(n => { n.parentNode = null }); this.children = []; this.append(...nodes) }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1))
    if (selector === 'input[type="search"]') return this.tagName === 'input' && this.type === 'search'
    return this.tagName === selector
  }
  querySelectorAll(selector) { return this.children.flatMap(n => [...(selector.split(',').some(s => n.matches(s.trim())) ? [n] : []), ...n.querySelectorAll(selector)]) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  focus() { this.document.activeElement = this }
  setSelectionRange() {}
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click', preventDefault() {} }) }
}
const boot = (saved = storage()) => {
  let clock = 1000, next = 0
  const timers = new Map(), listeners = new Map()
  const document = { activeElement: null, createElement: tag => new Element(tag, document) }
  const window = { localStorage: saved, crypto: { randomUUID: () => 'id-' + (++next) },
    setTimeout: callback => { timers.set(++next, callback); return next }, clearTimeout: id => timers.delete(id),
    addEventListener: (type, fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list) },
    Event: class { constructor(type) { this.type = type } } }
  vm.runInNewContext(source, { window, document })
  const workspace = window.NANALY_WORKSPACE.create({ now: () => clock })
  return { workspace, saved, window, document, timers, listeners,
    advance: ms => { clock += ms },
    mount(extra = {}) {
      const panel = document.createElement('div'), body = document.createElement('div'), input = document.createElement('textarea')
      panel.append(body, input)
      const calls = { history: [], send: [] }
      const adapter = { panel, body, input, isBusy: () => false, isLocked: () => false,
        onHistoryChange: value => calls.history.push(plain(value)), send: (...args) => calls.send.push(plain(args)), ...extra }
      assert.equal(workspace.mount(adapter), true)
      return { panel, body, input, calls, adapter }
    }
  }
}
let passed = 0
const check = async (label, fn) => { await fn(); passed++; console.log('  ✓ ' + label) }
const user = (content, at = 10) => ({ role: 'user', content, at })
const assistant = (content, at = 11) => ({ role: 'assistant', content, at })

await check('legacy history migrates safely and retains the original backup', () => {
  const original = JSON.stringify([null, { role: 'system', content: 'no' }, user('你好'), assistant('回答'), { role: 'user', content: 1 }])
  const saved = storage({ [LEGACY]: original }), app = boot(saved)
  assert.deepEqual(plain(app.workspace.readLog()), [user('你好'), assistant('回答')])
  app.workspace.flush()
  assert.equal(saved.getItem(LEGACY), original)
  assert.deepEqual(plain(boot(saved).workspace.readLog()), [user('你好'), assistant('回答')])
})
await check('corrupt and future-format records are never overwritten by fallback history', () => {
  for (const raw of ['{broken', '{"v":9,"sessions":[]}', 'null']) {
    const saved = storage({ [KEY]: raw, [LEGACY]: JSON.stringify([user('recoverable')]) }), app = boot(saved)
    app.workspace.beginTurn('new')
    assert.equal(saved.getItem(KEY), raw)
    assert.ok(app.workspace.getProblem())
    assert.equal(app.workspace.readLog()[0].content, 'recoverable')
  }
})
await check('denied and full storage leave working in-memory messages and an honest warning', () => {
  const saved = storage(), app = boot(saved)
  saved.denied = true
  const token = app.workspace.beginTurn('saved only in memory')
  app.workspace.updateTurn(token, 'partial')
  assert.equal(app.workspace.readLog()[0].content, 'saved only in memory')
  assert.match(app.workspace.getProblem(), /本地存储未成功/)
  assert.doesNotThrow(() => boot(saved))
  saved.denied = false
  assert.equal(app.workspace.flush(), true)
  assert.equal(app.workspace.getProblem(), '')
})
await check('pending questions and attachment references survive a reload without a response', () => {
  const saved = storage(), app = boot(saved), image = { id: 'image-local', name: '题目.png', type: 'image/png', data: 'must-not-persist' }
  app.workspace.beginTurn('看图', 'vision', { attachments: [image] })
  const restored = boot(saved).workspace, log = plain(restored.readLog())
  assert.equal(log.length, 1)
  assert.deepEqual(log[0].attachments, [{ id: image.id, name: image.name, type: image.type }])
  assert.equal(restored.snapshot().sessions[0].pending.status, 'interrupted')
  assert.equal(saved.getItem(KEY).includes('must-not-persist'), false)
})
await check('partial checkpoints recover once, including at the history capacity boundary', () => {
  const saved = storage(), app = boot(saved)
  app.workspace.writeLog(Array.from({ length: 120 }, (_, i) => user('old-' + i, i + 1)))
  const token = app.workspace.beginTurn('new question')
  app.workspace.updateTurn(token, 'half an answer')
  app.workspace.flush()
  const recovered = boot(saved).workspace
  assert.equal(recovered.readLog().filter(m => m.content === 'new question').length, 1)
  assert.equal(recovered.readLog().filter(m => m.content.includes('half an answer')).length, 1)
  recovered.flush()
  assert.equal(boot(saved).workspace.readLog().filter(m => m.content.includes('half an answer')).length, 1)
})
await check('turn tokens cannot mutate a replacement turn or resurrect a cleared conversation', () => {
  const app = boot(), old = app.workspace.beginTurn('old')
  app.workspace.clear()
  const fresh = app.workspace.beginTurn('new')
  assert.equal(app.workspace.updateTurn(old, 'late text'), false)
  assert.equal(app.workspace.finishTurn(old, { status: 'failed' }), false)
  app.workspace.finishTurn(fresh, { status: 'completed' })
  assert.equal(app.workspace.snapshot().sessions[0].pending, null)
  assert.deepEqual(plain(app.workspace.readLog().map(m => m.content)), ['new'])
})
await check('a turn token stays bound to its original topic and completion never duplicates assistant messages', () => {
  const app = boot(), w = app.workspace, first = w.snapshot().activeId
  const token = w.beginTurn('original question')
  w.writeLog([...w.readLog(), assistant('complete reply')])
  w.createSession('second')
  assert.equal(w.updateTurn(token, 'final partial'), true)
  assert.equal(w.readLog().length, 0)
  assert.equal(w.finishTurn(token, { status: 'completed' }), true)
  w.switchSession(first)
  assert.equal(w.readLog().filter(m => m.role === 'assistant').length, 1)
  assert.equal(w.snapshot().sessions.find(s => s.id === first).pending, null)
})
await check('sessions, drafts and searched text stay separate and returned values cannot mutate state', () => {
  const app = boot(), first = app.workspace.snapshot().activeId
  app.workspace.writeLog([user('<script>literal</script>'), assistant('First answer')])
  app.workspace.setDraft('first draft')
  const second = app.workspace.createSession('Second topic')
  app.workspace.writeLog([user('Different question')])
  assert.equal(app.workspace.search('first answer')[0].id, first)
  assert.equal(app.workspace.search('second topic')[0].id, second)
  app.workspace.switchSession(first)
  assert.equal(app.workspace.snapshot().sessions.find(s => s.id === first).draft, 'first draft')
  const list = app.workspace.readLog(); list[0].content = 'mutated'
  assert.equal(app.workspace.readLog()[0].content, '<script>literal</script>')
})
await check('clear is undoable after reload, but never overwrites later messages or expires silently', () => {
  const saved = storage(), app = boot(saved)
  app.workspace.writeLog([user('keep me')]); app.workspace.clear()
  const reloaded = boot(saved).workspace
  assert.equal(reloaded.undoClear(), true)
  assert.equal(reloaded.readLog()[0].content, 'keep me')
  reloaded.clear(); reloaded.writeLog([user('newer')])
  assert.equal(reloaded.undoClear(), false)
  assert.equal(reloaded.readLog()[0].content, 'newer')
  const expired = boot(); expired.workspace.writeLog([user('old')]); expired.workspace.clear(); expired.advance(900001)
  assert.equal(expired.workspace.undoClear(), false)
})
await check('another tab cannot be silently overwritten by a stale workspace', () => {
  const saved = storage(), first = boot(saved), second = boot(saved)
  first.workspace.writeLog([user('tab one')])
  const existing = saved.getItem(KEY)
  second.workspace.writeLog([user('tab two')])
  assert.equal(saved.getItem(KEY), existing)
  assert.match(second.workspace.getProblem(), /另一个标签页/)
})
await check('only explicitly confirmed structured memories enter model context and can be corrected/deleted', () => {
  const app = boot(), w = app.workspace
  assert.equal(w.confirmMemory({ kind: 'fact', text: 'inferred' }), false)
  assert.equal(w.confirmMemory({ kind: '__proto__', text: 'bad', confirmed: true }), false)
  assert.equal(w.memoryPrompt(), '')
  const id = w.confirmMemory({ kind: 'preference', text: '请先给简短说明', confirmed: true })
  assert.ok(w.memoryPrompt().includes('请先给简短说明'))
  assert.equal(w.confirmMemory({ id, kind: 'preference', text: '先举例', confirmed: true }), id)
  assert.equal(w.snapshot().memories.length, 1)
  assert.equal(w.memoryPrompt().includes('请先给简短说明'), false)
  w.deleteMemory(id)
  assert.equal(w.memoryPrompt(), '')
})
await check('sources and attachments preserve only bounded safe metadata through storage', () => {
  const app = boot(), w = app.workspace
  w.writeLog([{ ...assistant('sourced'), taskId: 'task-12345678', sources: [{ id: 'S1', title: 'source', url: '/notes/a/', quote: 'excerpt', kind: 'blog', section: '小节', secret: 'no' },
    { id: 'bad', url: 'javascript:alert(1)' }, { id: 'bad2', url: '//evil.test' }] }])
  assert.equal(w.readLog()[0].taskId, 'task-12345678')
  assert.deepEqual(plain(w.readLog()[0].sources), [{ id: 'S1', title: 'source', url: '/notes/a/', quote: 'excerpt', kind: 'blog', section: '小节' }])
  w.writeLog([{ ...assistant('invalid task'), taskId: '../secret' }])
  assert.equal(w.readLog()[0].taskId, undefined)
})
await check('retry restores pre-turn history and the original image references; continue preserves the partial answer', () => {
  const app = boot(), w = app.workspace, ui = app.mount({ send: (...args) => { ui.calls.send.push(plain(args)); w.beginTurn(...args) } })
  w.writeLog([user('before'), assistant('prior')])
  const image = { id: 'image1', name: 'one.png', type: 'image/png' }
  const token = w.beginTurn('question', 'vision', { attachments: [image] })
  w.writeLog([...w.readLog(), assistant('partial')]); w.finishTurn(token, { status: 'failed', partial: 'partial' })
  assert.equal(w.retry('retry'), true)
  assert.deepEqual(ui.calls.send[0], ['question', 'vision', { attachments: [image], files: [] }])
  assert.deepEqual(ui.calls.history.at(-1), [user('before'), assistant('prior')])
  const retryToken = w.beginTurn('question', 'vision', { attachments: [image] })
  w.finishTurn(retryToken, { status: 'interrupted', partial: 'second partial' })
  assert.equal(w.retry('continue'), true)
  assert.equal(w.readLog().filter(m => m.content.includes('second partial')).length, 1)
  assert.match(ui.calls.send.at(-1)[0], /接着上一条/)
})
await check('busy or locked UI blocks topic changes/retry and hides stored memory/history drawers', () => {
  const app = boot(), w = app.workspace
  let busy = false, locked = false
  const ui = app.mount({ isBusy: () => busy, isLocked: () => locked })
  const before = w.snapshot().activeId
  busy = true; w.refresh()
  assert.equal(w.createSession('blocked'), null)
  assert.equal(w.switchSession('missing'), false)
  assert.equal(w.snapshot().activeId, before)
  busy = false
  ui.panel.querySelector('.nanaly-workspace-bar').children.find(b => b.textContent === '记忆').click()
  assert.equal(ui.panel.querySelector('.nanaly-workspace-drawer').hidden, false)
  locked = true; w.refresh()
  assert.equal(ui.panel.querySelector('.nanaly-workspace-drawer').hidden, true)
  assert.equal(ui.panel.querySelector('.nanaly-workspace-drawer').children.length, 0)
  assert.equal(w.handleMemoryCommand('记住：do not save'), false)
  assert.equal(w.snapshot().memories.length, 0)
})
await check('memory commands only stage confirmation, and correction keeps the proposed replacement', () => {
  const app = boot(), w = app.workspace, ui = app.mount()
  assert.equal(w.handleMemoryCommand('记住：喜欢具体例子'), true)
  assert.equal(w.snapshot().memories.length, 0)
  const form = ui.panel.querySelector('.nanaly-memory-form')
  form.dispatchEvent({ type: 'submit', preventDefault() {} })
  assert.equal(w.snapshot().memories[0].text, '喜欢具体例子')
  assert.equal(w.handleMemoryCommand('更正：更喜欢简短例子'), true)
  ui.panel.querySelector('.nanaly-memory-item').children.find(n => n.tagName === 'button' && n.textContent === '编辑').click()
  assert.equal(ui.panel.querySelector('.nanaly-memory-form').querySelector('textarea').value, '更喜欢简短例子')
  assert.equal(w.snapshot().memories[0].text, '喜欢具体例子')
})
await check('message tools preserve literal content and image editing metadata without duplicating controls', () => {
  const app = boot(), w = app.workspace
  const edited = []
  const ui = app.mount({ editQuestion: value => edited.push(value) })
  const bubble = app.document.createElement('div'), message = { ...user('<b>question</b>'), attachments: [{ id: 'pic', name: 'x.png', type: 'image/png' }] }
  w.decorateMessage(bubble, message); w.decorateMessage(bubble, message)
  assert.equal(bubble.querySelectorAll('.nanaly-message-tools').length, 1)
  bubble.querySelector('.nanaly-message-tools').children.find(b => b.textContent === '修改问题').click()
  assert.equal(ui.input.value, '<b>question</b>')
  assert.deepEqual(plain(edited[0].attachments), message.attachments)
  bubble.querySelector('.nanaly-message-tools').children.find(b => b.textContent === '引用').click()
  assert.ok(ui.input.value.includes('> <b>question</b>'))
  assert.equal(ui.input.children.length, 0)
})
await check('routine refresh keeps unsaved topic names, search input and memory edits intact', () => {
  const app = boot(), w = app.workspace, ui = app.mount()
  w.writeLog([user('a topic to rename')])
  ui.panel.querySelector('.nanaly-workspace-bar').children.find(b => b.textContent === '话题').click()
  ui.panel.querySelector('.nanaly-session-menu').children.find(b => b.textContent === '重命名').click()
  const rename = ui.panel.querySelector('.nanaly-session-rename').querySelector('input')
  rename.value = 'not submitted yet'; rename.focus()
  const search = ui.panel.querySelector('input[type="search"]'); search.value = 'search draft'
  for (let i = 0; i < 5; i++) w.refresh()
  assert.equal(ui.panel.querySelector('.nanaly-session-rename').querySelector('input'), rename)
  assert.equal(rename.value, 'not submitted yet')
  assert.equal(app.document.activeElement, rename)
  assert.equal(ui.panel.querySelector('input[type="search"]'), search)
  assert.equal(search.value, 'search draft')
  w.handleMemoryCommand('记住：draft memory')
  const area = ui.panel.querySelector('.nanaly-memory-form').querySelector('textarea'); area.value = 'unsaved edit'
  w.refresh(); w.refresh()
  assert.equal(ui.panel.querySelector('.nanaly-memory-form').querySelector('textarea'), area)
  assert.equal(area.value, 'unsaved edit')
})

await check('retry and continue preserve the original question and partial answer when sending cannot start', async () => {
  for (const kind of ['retry', 'continue']) {
    for (const send of [() => undefined, async () => undefined, () => { throw new Error('not ready') }, async () => { throw new Error('not ready') }]) {
      const saved = storage(), app = boot(saved), w = app.workspace, ui = app.mount({ send })
      w.writeLog([user('before'), assistant('prior')])
      const token = w.beginTurn('recover this question')
      w.writeLog([...w.readLog(), assistant('recover this partial')])
      w.finishTurn(token, { status: 'interrupted', partial: 'recover this partial' })
      const original = plain(w.readLog())
      w.retry(kind)
      await Promise.resolve(); await Promise.resolve()
      assert.deepEqual(plain(w.readLog()), original, kind)
      assert.deepEqual(ui.calls.history.at(-1), original, kind)
      assert.deepEqual(plain(boot(saved).workspace.readLog()), original, kind)
      assert.equal(w.snapshot().sessions[0].pending.id, token.turnId)
      assert.match(w.getProblem(), /重试未能开始/)
    }
  }
})
await check('late retry failure restores only its own untouched conversation', async () => {
  for (const next of ['new turn', 'other topic', 'new history']) {
    const app = boot(), w = app.workspace
    let rejectSend
    const ui = app.mount({ send: () => new Promise((_, reject) => { rejectSend = reject }) })
    w.writeLog([user('before')])
    const token = w.beginTurn('old failed question')
    w.writeLog([...w.readLog(), assistant('old partial')])
    w.finishTurn(token, { status: 'failed', partial: 'old partial' })
    const original = plain(w.readLog()), oldId = w.snapshot().activeId
    w.retry('retry')
    if (next === 'new turn') w.beginTurn('new question')
    if (next === 'other topic') w.createSession('other')
    if (next === 'new history') w.writeLog([user('newer content')])
    const current = plain(w.readLog()), lastHistory = ui.calls.history.at(-1)
    rejectSend(new Error('late failure'))
    await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(plain(w.readLog()), current, next)
    assert.deepEqual(ui.calls.history.at(-1), lastHistory, next)
    if (next === 'other topic') {
      assert.deepEqual(plain(w.snapshot().sessions.find(s => s.id === oldId).messages), original)
    }
  }
})
await check('a fresh memory form never retains a hidden target from an abandoned edit', () => {
  for (const leave of ['close', 'switch tab', 'delete another']) {
    const app = boot(), w = app.workspace, ui = app.mount()
    const original = w.confirmMemory({ kind: 'fact', text: 'existing fact', confirmed: true })
    w.confirmMemory({ kind: 'goal', text: 'other memory', confirmed: true })
    const toolbar = ui.panel.querySelector('.nanaly-workspace-bar')
    const clickTab = label => toolbar.children.find(b => b.textContent === label).click()
    clickTab('记忆')
    ui.panel.querySelector('.nanaly-memory-item').children.find(b => b.textContent === '编辑').click()
    if (leave === 'close') { clickTab('记忆'); clickTab('记忆') }
    if (leave === 'switch tab') { clickTab('话题'); clickTab('记忆') }
    if (leave === 'delete another') ui.panel.querySelectorAll('.nanaly-memory-item')[1].children.find(b => b.textContent === '删除').click()
    const form = ui.panel.querySelector('.nanaly-memory-form')
    assert.equal(form.querySelector('textarea').value, '')
    assert.equal(form.querySelector('button').textContent, '确认记住')
    form.querySelector('textarea').value = 'a new preference'
    form.dispatchEvent({ type: 'submit', preventDefault() {} })
    const memories = plain(w.snapshot().memories)
    assert.equal(memories.find(m => m.id === original).text, 'existing fact', leave)
    assert.equal(memories.filter(m => m.text === 'a new preference').length, 1, leave)
  }
})


const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const complete = (w, question = '请解释事件循环') => {
  const token = w.beginTurn(question)
  w.writeLog([...w.readLog(), assistant('先执行同步任务，然后依次处理微任务。')])
  assert.equal(w.finishTurn(token, { status: 'completed' }), true)
  return token
}
const file = { id: 'document-12345678', name: '学习计划.pdf', type: 'pdf', size: 512,
  pageCount: 3, readPages: [1, 2, 3], imagePages: [], truncated: false, summary: '3 页文档' }

await check('new-topic clicks reuse an empty slot and empty slots never appear as history', () => {
  const app = boot(), w = app.workspace, original = w.snapshot().activeId
  for (let i = 0; i < 5; i++) assert.equal(w.createSession(), original)
  assert.equal(w.snapshot().sessions.length, 1)
  assert.deepEqual(plain(w.search('')), [])
  complete(w)
  const next = w.createSession()
  assert.notEqual(next, original)
  for (let i = 0; i < 5; i++) assert.equal(w.createSession(), next)
  assert.equal(w.snapshot().sessions.length, 2)
  assert.equal(w.search('').length, 1)
  w.setDraft('不要丢掉的草稿')
  const third = w.createSession()
  assert.notEqual(third, next)
  assert.equal(w.search('草稿')[0].id, next)
  assert.equal(w.snapshot().sessions.find(s => s.id === next).draft, '不要丢掉的草稿')
})

await check('legacy empty placeholders are removed while pending, drafts, named topics and real history survive', () => {
  const make = (id, extra = {}) => ({ id, title: '新的话题', createdAt: 1, updatedAt: 1, messages: [], pending: null, draft: '', ...extra })
  const raw = { v: 1, activeId: 'blank-active', sessions: [
    make('blank-active'), make('blank-old'), make('blank-older'),
    make('draft-keep', { draft: '准备发送的内容' }),
    make('named-keep', { title: '我亲自起的名字' }),
    make('history-keep', { messages: [user('旧问题'), assistant('旧回答')] }),
    make('pending-keep', { pending: { id: 'pending-id', text: '未完成问题', at: 2, attachments: [], files: [file] } })
  ], memories: [], undo: null }
  const saved = storage({ [KEY]: JSON.stringify(raw) }), app = boot(saved), state = app.workspace.snapshot()
  assert.deepEqual(plain(state.sessions.map(s => s.id)), ['blank-active', 'draft-keep', 'named-keep', 'history-keep', 'pending-keep'])
  assert.equal(state.sessions.find(s => s.id === 'named-keep').titleSource, 'manual')
  assert.equal(state.sessions.find(s => s.id === 'pending-keep').messages[0].files[0].name, file.name)
  assert.equal(app.workspace.search('').length, 4)
  app.workspace.flush()
  assert.equal(boot(saved).workspace.snapshot().sessions.length, 5)
})

await check('local names appear immediately from a question or filename and preserve chosen names', () => {
  const app = boot(), w = app.workspace
  w.beginTurn('  **这是一个清楚的问题**\n请解释一下  ')
  assert.equal(w.snapshot().sessions[0].title, '这是一个清楚的问题 请解释一下')
  w.createSession()
  w.beginTurn('请分析文件', '', { files: [file] })
  assert.equal(w.snapshot().sessions[0].title, file.name)
  w.createSession('我的特别标题')
  w.beginTurn('这句话不能替换我的标题')
  assert.equal(w.snapshot().sessions[0].title, '我的特别标题')
  assert.equal(w.snapshot().sessions[0].titleSource, 'manual')
})

await check('the first completed reply asynchronously gets one short automatic title and keeps it after reload', async () => {
  const saved = storage(), app = boot(saved), w = app.workspace, calls = []
  app.mount({ generateTitle: async args => { calls.push(args); return '标题：“事件循环的运行顺序”\nignored trailing text' } })
  complete(w)
  assert.equal(w.snapshot().sessions[0].title, '请解释事件循环')
  await drain()
  assert.equal(w.snapshot().sessions[0].title, '事件循环的运行顺序')
  assert.equal(w.snapshot().sessions[0].titleSource, 'generated')
  assert.deepEqual(plain(calls[0].messages.map(m => m.role)), ['user', 'assistant'])
  complete(w, '那 Promise 呢')
  await drain()
  assert.equal(calls.length, 1)
  assert.equal(boot(saved).workspace.snapshot().sessions[0].title, '事件循环的运行顺序')
})

await check('title errors and empty output leave the usable local title without failing chat', async () => {
  for (const generateTitle of [async () => { throw new Error('offline') }, async () => '']) {
    const app = boot(), w = app.workspace
    app.mount({ generateTitle })
    complete(w); await drain()
    assert.equal(w.snapshot().sessions[0].title, '请解释事件循环')
    assert.equal(w.snapshot().sessions[0].pending, null)
    assert.equal(w.readLog().at(-1).role, 'assistant')
    assert.equal(w.getProblem(), '')
  }
})

await check('late title results cannot overwrite renaming, clearing, deletion, switching or replacement generations', async () => {
  for (const action of ['rename', 'clear', 'delete', 'new topic', 'switch topic', 'replacement']) {
    const app = boot(), w = app.workspace
    let resolveTitle
    app.mount({ generateTitle: () => new Promise(resolve => { resolveTitle = resolve }) })
    if (action === 'switch topic') { w.createSession('备用话题'); w.createSession() }
    complete(w); await drain()
    const sourceId = w.snapshot().activeId
    if (action === 'rename') w.renameSession(sourceId, '用户决定的标题')
    if (action === 'clear' || action === 'replacement') w.clear()
    if (action === 'delete') w.deleteSession(sourceId)
    if (action === 'new topic') w.createSession()
    if (action === 'switch topic') w.switchSession(w.search('备用话题')[0].id)
    if (action === 'replacement') w.beginTurn('替代的新问题')
    const before = JSON.stringify(w.snapshot())
    resolveTitle('已经过期的标题'); await drain()
    assert.equal(JSON.stringify(w.snapshot()), before, action)
    assert.equal(w.snapshot().sessions.some(s => s.title === '已经过期的标题'), false, action)
  }
})

await check('an automatic title cannot overwrite a concurrent storage update from another tab', async () => {
  const saved = storage(), app = boot(saved), w = app.workspace
  let resolveTitle
  app.mount({ generateTitle: () => new Promise(resolve => { resolveTitle = resolve }) })
  complete(w); await drain()
  const other = boot(saved)
  other.workspace.renameSession(other.workspace.snapshot().activeId, '另一页的新名称')
  const raw = saved.getItem(KEY)
  resolveTitle('迟到的标题'); await drain()
  assert.equal(saved.getItem(KEY), raw)
  assert.equal(w.snapshot().sessions[0].title, '请解释事件循环')
  assert.match(w.getProblem(), /另一个标签页/)
})

await check('deleting and restoring a topic preserves messages, draft, file refs and other topic contents after reload', () => {
  const saved = storage(), app = boot(saved), w = app.workspace
  const first = w.snapshot().activeId
  const token = w.beginTurn('请分析文件', '', { files: [file], attachments: [{ id: 'pic-keep', name: 'picture.png', type: 'image/png' }] })
  w.updateTurn(token, '未完成回答'); w.finishTurn(token, { status: 'interrupted', partial: '未完成回答' })
  w.setDraft('仍未发送的补充问题')
  const second = w.createSession('其他话题')
  w.writeLog([user('另一个问题')])
  assert.equal(w.deleteSession(first), true)
  assert.equal(w.snapshot().activeId, second)
  assert.equal(w.readLog()[0].content, '另一个问题')
  assert.equal(w.snapshot().undo.messages[0].files[0].id, file.id)
  const reload = boot(saved).workspace
  assert.equal(reload.undoDelete(), true)
  assert.equal(reload.snapshot().activeId, first)
  assert.equal(reload.readLog()[0].files[0].name, file.name)
  assert.equal(reload.snapshot().sessions.find(s => s.id === first).draft, '仍未发送的补充问题')
  assert.equal(reload.snapshot().sessions.find(s => s.id === first).pending.status, 'interrupted')
  assert.equal(reload.snapshot().sessions.find(s => s.id === second).messages[0].content, '另一个问题')
})

await check('deleting the last topic opens an empty chat and undo never replaces a newer chat', () => {
  const app = boot(), w = app.workspace, original = w.snapshot().activeId
  complete(w)
  assert.equal(w.deleteSession(original), true)
  assert.equal(w.readLog().length, 0)
  assert.equal(w.search('').length, 0)
  const fresh = w.snapshot().activeId
  complete(w, '新聊天的问题')
  w.setDraft('新聊天的草稿')
  assert.equal(w.undoDelete(), true)
  assert.equal(w.snapshot().sessions.find(s => s.id === fresh).messages[0].content, '新聊天的问题')
  assert.equal(w.snapshot().sessions.find(s => s.id === fresh).draft, '新聊天的草稿')
  assert.equal(w.snapshot().activeId, original)
})

await check('delete undo expires honestly and stale-tab undo cannot replace persisted state', () => {
  const app = boot(), w = app.workspace
  complete(w); w.deleteSession(w.snapshot().activeId); app.advance(900001)
  assert.equal(w.undoDelete(), false)
  assert.match(w.getProblem(), /撤销期限已过/)
  const saved = storage(), one = boot(saved), local = one.workspace
  complete(local); local.deleteSession(local.snapshot().activeId)
  const other = boot(saved); other.workspace.beginTurn('另一页的消息')
  const raw = saved.getItem(KEY), before = JSON.stringify(local.snapshot())
  assert.equal(local.undoDelete(), false)
  assert.equal(saved.getItem(KEY), raw)
  assert.equal(JSON.stringify(local.snapshot()), before)
})

await check('undo clear protects a newly typed draft and preserves the original name after normal restoration', () => {
  const app = boot(), w = app.workspace
  complete(w); const original = w.snapshot().sessions[0].title
  w.clear()
  w.setDraft('新的草稿')
  assert.equal(w.undoClear(), false)
  assert.equal(w.snapshot().sessions[0].draft, '新的草稿')
  w.setDraft('')
  assert.equal(w.undoClear(), true)
  assert.equal(w.snapshot().sessions[0].title, original)
})

await check('topic drawer starts with an honest empty state and keeps naming optional behind an operation menu', () => {
  const app = boot(), w = app.workspace, ui = app.mount()
  const topics = ui.panel.querySelector('.nanaly-workspace-bar').children.find(b => b.textContent === '话题')
  topics.click()
  assert.ok(ui.panel.querySelector('.nanaly-session-empty'))
  assert.equal(ui.panel.querySelector('.nanaly-session-rename'), null)
  w.closeDrawer()
  assert.equal(ui.panel.querySelector('.nanaly-workspace-drawer').hidden, true)
  complete(w); topics.click()
  assert.equal(ui.panel.querySelector('.nanaly-session-rename'), null)
  ui.panel.querySelector('.nanaly-session-menu').children.find(b => b.textContent === '重命名').click()
  const form = ui.panel.querySelector('.nanaly-session-rename')
  form.querySelector('input').value = '自己选的可爱标题'
  form.dispatchEvent({ type: 'submit', preventDefault() {} })
  assert.equal(w.search('自己选的可爱标题').length, 1)
  assert.equal(ui.panel.querySelector('.nanaly-session-rename'), null)
  ui.panel.querySelector('.nanaly-session-delete').click()
  assert.equal(w.search('').length, 0)
  assert.equal(ui.panel.querySelector('.nanaly-workspace-undo').hidden, false)
  ui.panel.querySelector('.nanaly-workspace-undo').querySelector('button').click()
  assert.equal(w.search('自己选的可爱标题').length, 1)
})

await check('busy and locked sessions reject deletion and manual renaming', () => {
  for (const extra of [{ isBusy: () => true }, { isLocked: () => true }]) {
    const app = boot(), w = app.workspace
    complete(w); const id = w.snapshot().activeId
    app.mount(extra)
    assert.equal(w.deleteSession(id), false)
    assert.equal(w.renameSession(id, 'not allowed'), false)
    assert.equal(w.snapshot().sessions.length, 1)
  }
})

await check('document refs stay bounded through recovery, retries and message editing without persisting file bodies', () => {
  const saved = storage(), app = boot(saved), w = app.workspace
  const ui = app.mount({ send: (...args) => { ui.calls.send.push(plain(args)); w.beginTurn(...args) } })
  const token = w.beginTurn('文档内容是什么', '', { files: [{ ...file, content: 'secret-file-payload', readPages: [1, 1, -1, '2', 3] }, { id: '../invalid', type: 'pdf', name: 'bad.pdf' }] })
  w.finishTurn(token, { status: 'failed' })
  const ref = plain(w.readLog()[0].files[0])
  assert.deepEqual(ref.readPages, [1, 3])
  assert.equal(w.readLog()[0].files.length, 1)
  assert.equal(saved.getItem(KEY).includes('secret-file-payload'), false)
  assert.deepEqual(plain(boot(saved).workspace.readLog()[0].files[0]), ref)
  assert.equal(w.retry('retry'), true)
  assert.deepEqual(ui.calls.send[0][2].files, [ref])
})


await check('title requests expose an abort signal and are canceled on a manual rename', async () => {
  const app = boot(), w = app.workspace
  app.window.AbortController = AbortController
  let signal
  app.mount({ generateTitle: args => { signal = args.signal; return new Promise(() => {}) } })
  complete(w); await drain()
  assert.equal(signal.aborted, false)
  w.renameSession(w.snapshot().activeId, '用户命名优先')
  assert.equal(signal.aborted, true)
})

await check('legacy names are preserved even when they happen to match the first question', async () => {
  const saved = storage({ [KEY]: JSON.stringify({ v: 1, activeId: 'old-topic', sessions: [
    { id: 'old-topic', title: '这是我想保留的名字', messages: [user('这是我想保留的名字'), assistant('旧回答')], draft: '', pending: null }
  ], memories: [], undo: null }) })
  const app = boot(saved), w = app.workspace
  let titleCalls = 0
  app.mount({ generateTitle: async () => { titleCalls++; return '不应覆盖的自动标题' } })
  complete(w, '新问题'); await drain()
  assert.equal(w.snapshot().sessions[0].title, '这是我想保留的名字')
  assert.equal(titleCalls, 0)
})


await check('attachment-only drafts survive topic switches, reloads and per-tray partial updates', () => {
  const app = boot(), ws = app.workspace, changes = []
  app.mount({ onHistoryChange: (log, draft) => changes.push(plain(draft)) })
  const first = ws.snapshot().activeId
  const doc = { id: 'draft-file-alpha', name: 'notes.pdf', type: 'pdf', size: 512, pageCount: 2, readPages: [1, 2], imagePages: [], summary: '2 pages', text: 'must not persist' }
  const image = { id: 'draft-image-alpha', name: 'cat.png', type: 'image/png', dataURL: 'must not persist' }
  ws.setDraftAttachments({ files: [doc] }); ws.setDraftAttachments({ attachments: [image] })
  assert.equal(ws.readDraftAttachments().files[0].id, doc.id)
  assert.equal(ws.readDraftAttachments().attachments[0].id, image.id)
  const returned = ws.readDraftAttachments(); returned.files.length = 0
  assert.equal(ws.readDraftAttachments().files.length, 1)
  const second = ws.createSession()
  assert.notEqual(second, first, 'a file-only draft is not an empty reusable placeholder')
  assert.equal(changes.at(-1).files.length, 0)
  ws.setDraftAttachments({ files: [{ ...doc, id: 'draft-file-beta', name: 'beta.txt', type: 'text' }] })
  assert.equal(ws.search('notes.pdf')[0].id, first)
  ws.switchSession(first)
  assert.equal(changes.at(-1).files[0].id, doc.id)
  assert.equal(changes.at(-1).attachments[0].id, image.id)
  ws.flush()
  assert.doesNotMatch(app.saved.getItem(KEY), /must not persist/)
  const reloaded = boot(app.saved).workspace
  assert.equal(reloaded.readDraftAttachments().files[0].id, doc.id)
  assert.equal(reloaded.readDraftAttachments().attachments[0].id, image.id)
  reloaded.switchSession(second)
  assert.equal(reloaded.readDraftAttachments().files[0].id, 'draft-file-beta')
})
await check('clear and delete undo restore attachment drafts but never overwrite a new attachment draft', () => {
  const app = boot(), ws = app.workspace
  const doc = { id: 'draft-undo-original', name: 'original.txt', type: 'text' }
  ws.setDraftAttachments({ files: [doc] })
  assert.equal(ws.clear(), true)
  assert.equal(ws.readDraftAttachments().files.length, 0)
  const loadedApp = boot(app.saved), loaded = loadedApp.workspace
  loadedApp.window.crypto.randomUUID = () => 'unique-placeholder-after-reload'
  loaded.setDraftAttachments({ files: [{ ...doc, id: 'draft-new-current' }] })
  assert.equal(loaded.undoClear(), false)
  assert.equal(loaded.readDraftAttachments().files[0].id, 'draft-new-current')
  loaded.setDraftAttachments({ files: [] })
  assert.equal(loaded.undoClear(), true)
  assert.equal(loaded.readDraftAttachments().files[0].id, doc.id)
  loaded.deleteSession(loaded.snapshot().activeId)
  const afterDelete = boot(app.saved).workspace
  assert.equal(afterDelete.undoDelete(), true)
  assert.equal(afterDelete.readDraftAttachments().files[0].id, doc.id)
})
await check('sending moves draft refs into the turn and malformed draft metadata is normalized on reload', () => {
  const app = boot(), ws = app.workspace
  const doc = { id: 'draft-send-file', name: 'code.js', type: 'text' }, picture = { id: 'draft-send-image', name: 'cat.png', type: 'image/png' }
  ws.setDraftAttachments({ files: [doc], attachments: [picture] })
  const token = ws.beginTurn('read', '', ws.readDraftAttachments())
  assert.equal(ws.readDraftAttachments().files.length, 0)
  assert.equal(ws.readDraftAttachments().attachments.length, 0)
  assert.equal(ws.readLog()[0].files[0].id, doc.id)
  ws.finishTurn(token, { status: 'failed' })
  const saved = JSON.parse(app.saved.getItem(KEY))
  saved.sessions[0].draftFiles = [{ id: 'bad', type: 'exe' }, { ...doc, text: 'raw-body', images: ['raw-image'] }]
  saved.sessions[0].draftAttachments = [null, { ...picture, dataURL: 'raw-image' }]
  app.saved.setItem(KEY, JSON.stringify(saved))
  const loaded = boot(app.saved).workspace
  assert.equal(loaded.readDraftAttachments().files.length, 1)
  assert.equal(loaded.readDraftAttachments().attachments.length, 1)
  loaded.flush()
  assert.doesNotMatch(app.saved.getItem(KEY), /raw-body|raw-image/)
})

await check('locking or opening settings aborts title generation and a late result cannot replace the local title', async () => {
  const app = boot(), w = app.workspace
  app.window.AbortController = AbortController
  let locked = false, signal, resolveTitle, calls = 0
  app.mount({ isLocked: () => locked, generateTitle: args => {
    calls++; signal = args.signal
    return new Promise(resolve => { resolveTitle = resolve })
  } })
  complete(w); await drain()
  assert.equal(signal.aborted, false)
  const originalTitle = w.snapshot().sessions[0].title
  locked = true; w.refresh()
  assert.equal(signal.aborted, true)
  resolveTitle('锁定后迟到的标题'); await drain()
  assert.equal(w.snapshot().sessions[0].title, originalTitle)
  assert.equal(w.snapshot().sessions[0].titleSource, 'local')
  locked = false; w.refresh()
  complete(w, '下一条问题'); await drain()
  assert.equal(calls, 1, 'unlocking must not restart the canceled title request')
})

console.log(`\n${passed} workspace regression groups passed`)
