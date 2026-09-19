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
const check = (label, fn) => { fn(); passed++; console.log('  ✓ ' + label) }
const user = (content, at = 10) => ({ role: 'user', content, at })
const assistant = (content, at = 11) => ({ role: 'assistant', content, at })

check('legacy history migrates safely and retains the original backup', () => {
  const original = JSON.stringify([null, { role: 'system', content: 'no' }, user('你好'), assistant('回答'), { role: 'user', content: 1 }])
  const saved = storage({ [LEGACY]: original }), app = boot(saved)
  assert.deepEqual(plain(app.workspace.readLog()), [user('你好'), assistant('回答')])
  app.workspace.flush()
  assert.equal(saved.getItem(LEGACY), original)
  assert.deepEqual(plain(boot(saved).workspace.readLog()), [user('你好'), assistant('回答')])
})
check('corrupt and future-format records are never overwritten by fallback history', () => {
  for (const raw of ['{broken', '{"v":9,"sessions":[]}', 'null']) {
    const saved = storage({ [KEY]: raw, [LEGACY]: JSON.stringify([user('recoverable')]) }), app = boot(saved)
    app.workspace.beginTurn('new')
    assert.equal(saved.getItem(KEY), raw)
    assert.ok(app.workspace.getProblem())
    assert.equal(app.workspace.readLog()[0].content, 'recoverable')
  }
})
check('denied and full storage leave working in-memory messages and an honest warning', () => {
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
check('pending questions and attachment references survive a reload without a response', () => {
  const saved = storage(), app = boot(saved), image = { id: 'image-local', name: '题目.png', type: 'image/png', data: 'must-not-persist' }
  app.workspace.beginTurn('看图', 'vision', { attachments: [image] })
  const restored = boot(saved).workspace, log = plain(restored.readLog())
  assert.equal(log.length, 1)
  assert.deepEqual(log[0].attachments, [{ id: image.id, name: image.name, type: image.type }])
  assert.equal(restored.snapshot().sessions[0].pending.status, 'interrupted')
  assert.equal(saved.getItem(KEY).includes('must-not-persist'), false)
})
check('partial checkpoints recover once, including at the history capacity boundary', () => {
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
check('turn tokens cannot mutate a replacement turn or resurrect a cleared conversation', () => {
  const app = boot(), old = app.workspace.beginTurn('old')
  app.workspace.clear()
  const fresh = app.workspace.beginTurn('new')
  assert.equal(app.workspace.updateTurn(old, 'late text'), false)
  assert.equal(app.workspace.finishTurn(old, { status: 'failed' }), false)
  app.workspace.finishTurn(fresh, { status: 'completed' })
  assert.equal(app.workspace.snapshot().sessions[0].pending, null)
  assert.deepEqual(plain(app.workspace.readLog().map(m => m.content)), ['new'])
})
check('a turn token stays bound to its original topic and completion never duplicates assistant messages', () => {
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
check('sessions, drafts and searched text stay separate and returned values cannot mutate state', () => {
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
check('clear is undoable after reload, but never overwrites later messages or expires silently', () => {
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
check('another tab cannot be silently overwritten by a stale workspace', () => {
  const saved = storage(), first = boot(saved), second = boot(saved)
  first.workspace.writeLog([user('tab one')])
  const existing = saved.getItem(KEY)
  second.workspace.writeLog([user('tab two')])
  assert.equal(saved.getItem(KEY), existing)
  assert.match(second.workspace.getProblem(), /另一个标签页/)
})
check('only explicitly confirmed structured memories enter model context and can be corrected/deleted', () => {
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
check('sources and attachments preserve only bounded safe metadata through storage', () => {
  const app = boot(), w = app.workspace
  w.writeLog([{ ...assistant('sourced'), taskId: 'task-12345678', sources: [{ id: 'S1', title: 'source', url: '/notes/a/', quote: 'excerpt', kind: 'blog', section: '小节', secret: 'no' },
    { id: 'bad', url: 'javascript:alert(1)' }, { id: 'bad2', url: '//evil.test' }] }])
  assert.equal(w.readLog()[0].taskId, 'task-12345678')
  assert.deepEqual(plain(w.readLog()[0].sources), [{ id: 'S1', title: 'source', url: '/notes/a/', quote: 'excerpt', kind: 'blog', section: '小节' }])
  w.writeLog([{ ...assistant('invalid task'), taskId: '../secret' }])
  assert.equal(w.readLog()[0].taskId, undefined)
})
check('retry restores pre-turn history and the original image references; continue preserves the partial answer', () => {
  const app = boot(), w = app.workspace, ui = app.mount()
  w.writeLog([user('before'), assistant('prior')])
  const image = { id: 'image1', name: 'one.png', type: 'image/png' }
  const token = w.beginTurn('question', 'vision', { attachments: [image] })
  w.writeLog([...w.readLog(), assistant('partial')]); w.finishTurn(token, { status: 'failed', partial: 'partial' })
  assert.equal(w.retry('retry'), true)
  assert.deepEqual(ui.calls.send[0], ['question', 'vision', { attachments: [image] }])
  assert.deepEqual(ui.calls.history.at(-1), [user('before'), assistant('prior')])
  const retryToken = w.beginTurn('question', 'vision', { attachments: [image] })
  w.finishTurn(retryToken, { status: 'interrupted', partial: 'second partial' })
  assert.equal(w.retry('continue'), true)
  assert.equal(w.readLog().filter(m => m.content.includes('second partial')).length, 1)
  assert.match(ui.calls.send.at(-1)[0], /接着上一条/)
})
check('busy or locked UI blocks topic changes/retry and hides stored memory/history drawers', () => {
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
check('memory commands only stage confirmation, and correction keeps the proposed replacement', () => {
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
check('message tools preserve literal content and image editing metadata without duplicating controls', () => {
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
check('routine refresh keeps unsaved topic names, search input and memory edits intact', () => {
  const app = boot(), w = app.workspace, ui = app.mount()
  ui.panel.querySelector('.nanaly-workspace-bar').children.find(b => b.textContent === '话题').click()
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
console.log(`\n${passed} workspace regression groups passed`)
