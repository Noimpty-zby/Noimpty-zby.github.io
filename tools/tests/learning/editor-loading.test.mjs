import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../../source/js/learning-lab.js', import.meta.url), 'utf8')
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map()
    this.dataset = {}; this.attributes = new Map(); this.style = { setProperty() {}, removeProperty() {} }
    this.className = ''; this.value = ''; this.hidden = false
    this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = 'forward'
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className += ' ' + names.join(' ') },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' ') }
    }
  }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child) } }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children) }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  addEventListener(name, listener, options) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(listener)
    options?.signal?.addEventListener('abort', () => this.listeners.get(name)?.delete(listener), { once: true })
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener) }
  fire(name, event = {}) { for (const listener of this.listeners.get(name) || []) listener({ target: this, preventDefault() {}, ...event }) }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.tagName.toLowerCase() === selector
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)])
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  contains(target) { return this === target || this.children.some(child => child.contains(target)) }
  focus() { this.focused = true }
  set textContent(text) { this.text = String(text); this.children = [] }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join('') }
}

const boot = ({ page = false } = {}) => {
  let pageHost = page ? new Element('main') : null
  const scripts = [], timers = new Map(), storage = new Map(), adapters = []
  let sequence = 0
  const document = new Element('document')
  Object.assign(document, {
    readyState: 'loading', documentElement: new Element('html'),
    createElement: tag => new Element(tag), createTextNode: text => { const node = new Element('text'); node.textContent = text; return node },
    getElementById: id => id === 'learning-lab' ? pageHost : id.endsWith('-src') ? ({ getAttribute: () => '/js/' + id.replace('-src', '.js') + '?v=fixture' }) : null,
    head: { append: script => scripts.push(script) }
  })
  const window = new Element('window')
  Object.assign(window, {
    NOIMPTY_GATE: { unlocked: () => true },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    matchMedia: () => ({ matches: false }),
    setTimeout: (callback, ms) => { const id = ++sequence; timers.set(id, { callback, ms }); return id },
    clearTimeout: id => timers.delete(id)
  })
  vm.runInNewContext(source.replace('Object.freeze({ createSession, createTerminalLink,', 'Object.freeze({ mountLab, createSession, createTerminalLink,'), {
    window, document, AbortController, DOMException, URL,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout
  })
  const mount = () => {
    const host = new Element('main')
    const lab = window.NOIMPTY_LEARNING.mountLab(host)
    return { ...lab, root: host.children[0], textarea: host.querySelector('.learning-editor'), select: host.querySelector('select') }
  }
  const resolveEditor = () => {
    window.NOIMPTY_CODE_EDITOR = { create: (host, options) => {
      const adapter = { options, value: options.value, language: options.language, focused: false, destroyed: false,
        setValue(value) { this.value = value }, setLanguage(value) { this.language = value },
        setDiagnostics() {}, focus() { this.focused = true }, destroy() { this.destroyed = true }
      }
      adapters.push(adapter); return adapter
    } }
    scripts.find(script => script.src.includes('learning-editor.js')).onload()
  }
  return { scripts, timers, adapters, window, document, mount, resolveEditor,
    mountPage: () => { window.NOIMPTY_LEARNING.mount(); return pageHost },
    setPage: value => { pageHost = value }
  }
}

test('offline article shell snippets expose the editor and Run action, including after connecting', async () => {
  for (const language of ['git', 'linux']) {
    const app = boot(), lab = app.mount()
    lab.select.value = language; lab.select.fire('change')
    assert.equal(lab.root.dataset.mode, 'terminal')
    lab.session.edit({ code: 'original shell draft' })
    const code = language === 'git' ? 'git status' : 'pwd'
    lab.runSnippet({ language, code })
    const run = lab.root.querySelector('.learning-run')
    assert.equal(lab.root.dataset.mode, 'script', language)
    assert.equal(lab.textarea.value, code)
    assert.equal(run.hidden, false)
    assert.equal(run.disabled, true, 'running waits for a backend connection')
    assert.equal(lab.session.state.backups[0].code, 'original shell draft')
    assert.match(lab.root.querySelector('.learning-status').textContent, /连接个人后端/)

    app.window.NANALY_AGENT = {
      configured: () => true,
      snapshot: () => ({ connection: 'connected' }),
      request: async path => path === '/api/workspaces' ? { workspaces: [] } : { runs: [] }
    }
    app.window.fire('nanaly:agent-configured'); await flush()
    assert.equal(lab.root.dataset.mode, 'script')
    assert.equal(run.hidden, false)
    assert.equal(run.disabled, false, 'the promised Run action becomes usable after connecting')
    lab.dispose()
  }
})

test('article program and SQL snippets keep their language-specific editor modes', () => {
  for (const [language, code, mode] of [
    ['c', 'int main(void) { return 0; }', 'code'],
    ['cpp', 'int main() { return 0; }', 'code'],
    ['go', 'package main\nfunc main() {}', 'code'],
    ['python', 'print(1)', 'code'],
    ['mysql', 'SELECT 1;', 'sql']
  ]) {
    const app = boot(), lab = app.mount()
    lab.runSnippet({ language, code })
    assert.equal(lab.root.dataset.mode, mode, language)
    assert.equal(lab.textarea.value, code)
    assert.equal(lab.root.querySelector('.learning-run').hidden, false)
    lab.dispose()
  }
})

test('late CodeMirror upgrade preserves typed draft, backwards selection and focus', async () => {
  const app = boot(), lab = app.mount()
  assert.equal(lab.textarea.hidden, false)
  lab.textarea.value = 'int main() { return 42; }'
  lab.textarea.selectionStart = 4; lab.textarea.selectionEnd = 8; lab.textarea.selectionDirection = 'backward'
  lab.textarea.fire('input'); app.document.activeElement = lab.textarea
  app.resolveEditor(); await flush()
  assert.equal(app.adapters.length, 1)
  assert.equal(app.adapters[0].value, 'int main() { return 42; }')
  assert.deepEqual(JSON.parse(JSON.stringify(app.adapters[0].options.selection)), { anchor: 8, head: 4 })
  assert.equal(app.adapters[0].focused, true)
  assert.equal(lab.textarea.hidden, true)
  assert.equal(lab.context().code, 'int main() { return 42; }')
  lab.dispose()
  assert.equal(app.adapters[0].destroyed, true)
})

test('changing language during the download upgrades the current draft and keeps the earlier one', async () => {
  const app = boot(), lab = app.mount()
  lab.textarea.value = 'original C draft'; lab.textarea.fire('input')
  lab.select.value = 'python'; lab.select.fire('change')
  lab.textarea.value = 'print(123)'; lab.textarea.fire('input')
  app.resolveEditor(); await flush()
  assert.equal(app.adapters[0].language, 'python')
  assert.equal(app.adapters[0].value, 'print(123)')
  assert.equal(lab.session.state.drafts.c.code, 'original C draft')
  lab.dispose()
})

test('closing before download finishes never mounts an editor in a detached studio', async () => {
  const app = boot(), lab = app.mount()
  lab.textarea.value = 'saved before closing'; lab.textarea.fire('input')
  lab.dispose()
  app.resolveEditor(); await flush()
  assert.equal(app.adapters.length, 0)
  const reopened = app.mount()
  assert.equal(app.adapters.length, 1)
  assert.equal(app.adapters[0].value, 'saved before closing')
  assert.equal(reopened.textarea.hidden, true)
  reopened.dispose()
})

test('failed editor loading retains editable textarea and can retry after reopening', async () => {
  const app = boot(), lab = app.mount()
  app.scripts.find(script => script.src.includes('learning-editor.js')).onerror()
  await flush()
  lab.textarea.value = 'draft after failed download'; lab.textarea.fire('input')
  assert.equal(lab.textarea.hidden, false)
  assert.equal(lab.context().code, 'draft after failed download')
  lab.dispose()
  const reopened = app.mount()
  assert.equal(app.scripts.filter(script => script.src.includes('learning-editor.js')).length, 2)
  assert.equal(reopened.textarea.value, 'draft after failed download')
  reopened.dispose()
})


test('failed or canceled PJAX preserves the current practice draft and loaded editor', async () => {
  for (const ending of [null, 'pjax:complete', 'pjax:error', 'pjax:abort', 'pjax:cancel']) {
    const app = boot({ page: true }), page = app.mountPage()
    const textarea = page.querySelector('.learning-editor'), root = page.children[0]
    textarea.value = 'int main() { return 73; }'; textarea.fire('input')
    app.resolveEditor(); await flush()
    const adapter = app.adapters[0]
    app.document.fire('pjax:send')
    if (ending) app.window.fire(ending)
    assert.equal(page.children[0], root, String(ending))
    assert.equal(adapter.destroyed, false)
    assert.equal(app.window.NOIMPTY_LEARNING.context().code, textarea.value)
    assert.equal(page.querySelectorAll('.learning-editor').length, 1)
  }
})

test('successful PJAX replacement disposes the old editor once and initializes the new page', async () => {
  const app = boot({ page: true }), oldPage = app.mountPage()
  app.resolveEditor(); await flush()
  const oldAdapter = app.adapters[0]
  const nextPage = new Element('main')
  app.document.fire('pjax:send'); app.setPage(nextPage); app.window.fire('pjax:complete')
  assert.equal(oldAdapter.destroyed, true)
  assert.equal(oldPage.children.length, 0)
  assert.equal(app.adapters.length, 2)
  const nextAdapter = app.adapters[1], root = nextPage.children[0]
  nextAdapter.value = 'a new unsaved draft'; nextAdapter.options.onChange(nextAdapter.value)
  app.window.fire('pjax:complete')
  assert.equal(nextPage.children[0], root)
  assert.equal(nextAdapter.destroyed, false)
  assert.equal(app.window.NOIMPTY_LEARNING.context().code, 'a new unsaved draft')
  app.setPage(null); app.window.fire('pjax:complete')
  assert.equal(nextAdapter.destroyed, true)
  assert.equal(app.window.NOIMPTY_LEARNING.context(), null)
})
