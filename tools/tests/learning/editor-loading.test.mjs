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
    location: { href: 'https://blog.test/learn/', origin: 'https://blog.test' },
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
  return { scripts, timers, adapters, storage, window, document, mount, resolveEditor,
    mountPage: () => { window.NOIMPTY_LEARNING.mount(); return pageHost },
    setPage: value => { pageHost = value }
  }
}

// ▶ 不改他选的模式。10-02 曾改成「终端模式下点 ▶ 就切到脚本模式」，而且把这个切换存成了默认，
// 点过一次以后 Linux / Git 每次打开都是脚本模式，他要的是真终端。
test('▶ on an article shell block keeps the terminal mode and never rewrites the saved default', async () => {
  for (const language of ['git', 'linux']) {
    const app = boot(), lab = app.mount()
    lab.select.value = language; lab.select.fire('change')
    assert.equal(lab.root.dataset.mode, 'terminal')
    const saved = app.storage.get('noimpty-code-shell-mode') ?? null
    lab.session.edit({ code: 'original shell draft' })
    const code = language === 'git' ? 'git status' : 'pwd'
    lab.runSnippet({ language, code })
    assert.equal(lab.root.dataset.mode, 'terminal', language)
    assert.equal(lab.session.state.code, code)
    assert.equal(lab.session.state.backups[0].code, 'original shell draft')
    assert.match(lab.root.querySelector('.learning-status').textContent, /连接个人后端以后再点一次 ▶/)
    assert.equal(app.storage.get('noimpty-code-shell-mode') ?? null, saved, '点 ▶ 改写了他存下的默认模式')

    app.window.NANALY_AGENT = {
      configured: () => true,
      snapshot: () => ({ connection: 'connected' }),
      request: async path => path === '/api/workspaces' ? { workspaces: [] } : { runs: [] }
    }
    app.window.fire('nanaly:agent-configured'); await flush()
    assert.equal(lab.root.dataset.mode, 'terminal')
    lab.dispose()
  }
})

test('▶ in script mode stays in script mode with the code in the editor', () => {
  const app = boot()
  app.storage.set('noimpty-code-shell-mode', JSON.stringify({ linux: 'script' }))
  const lab = app.mount()
  lab.select.value = 'linux'; lab.select.fire('change')
  assert.equal(lab.root.dataset.mode, 'script')
  lab.runSnippet({ language: 'linux', code: 'pwd' })
  assert.equal(lab.root.dataset.mode, 'script')
  assert.equal(lab.textarea.value, 'pwd')
  assert.equal(lab.root.querySelector('.learning-run').hidden, false)
  assert.equal(JSON.parse(app.storage.get('noimpty-code-shell-mode')).linux, 'script')
  lab.dispose()
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


test('evidence actions save the executed snapshot, then append a real correction and schedule it', async () => {
  const app = boot(), captured = [], rated = []
  let status = 'runtime_error', counter = 0
  app.window.NANALY_AGENT = {
    configured: () => true, snapshot: () => ({ connection: 'connected' }),
    request: async (path, args) => path === '/api/workspaces' ? { workspaces: [] } : path.startsWith('/api/runs') ? { runs: [] } :
      { runId: 'run-' + ++counter, revision: args.body.revision, status, stdout: status === 'accepted' ? '0.5\n' : '', stderr: status === 'accepted' ? '' : 'ZeroDivisionError', tests: [], diagnostics: [] }
  }
  app.window.NOIMPTY_LEARNING_HISTORY = {
    saveFailure: async value => { captured.push(value); return { id: 'case-one', attempts: [value] } },
    addAttempt: async (id, value) => { assert.equal(id, 'case-one'); captured.push(value); return { id, attempts: [...captured] } },
    rate: async (...args) => rated.push(args)
  }
  const lab = app.mount(), evidence = lab.root.querySelector('.learning-evidence')
  const click = label => Promise.all([...evidence.querySelectorAll('button').find(x => x.textContent === label).listeners.get('click')].map(fn => fn()))
  await lab.openSnippet({ language: 'python', code: 'print(1/0)', title: '分母', sourceUrl: 'https://blog.test/posts/division/' })
  lab.session.edit({ stdin: '2\n', tests: [{ input: '2\n', expectedOutput: '0.5\n' }] })
  await lab.session.run('run', true)
  lab.session.edit({ code: 'edited but not run' })
  await click('保存失败现场')
  assert.equal(captured[0].code, 'print(1/0)', 'save the run snapshot, never newer unexecuted editor text')
  assert.equal(captured[0].stdin, '2\n')
  assert.equal(captured[0].source.url, 'https://blog.test/posts/division/')
  assert.equal(captured[0].result.stderr, 'ZeroDivisionError')
  assert.equal(evidence.querySelector('.learning-evidence-ratings').hidden, true)
  status = 'accepted'; lab.session.edit({ code: 'print(1 / int(input()))' })
  await lab.session.run('run', true)
  await click('保存这次重做 / 修正')
  assert.equal(captured.length, 2); assert.equal(captured[1].result.status, 'accepted')
  assert.equal(evidence.querySelector('.learning-evidence-ratings').hidden, false)
  await click('良好')
  assert.deepEqual(rated, [['case-one', captured[1].id, 3]])
  assert.equal(evidence.querySelector('.learning-evidence-ratings').hidden, true)
  lab.dispose()
})

test('restoring a case starts with the failure and its tests, protects the draft and hides the correction', async () => {
  const app = boot()
  app.window.location.href = 'https://blog.test/learn/?case=case-one'
  app.window.localStorage.setItem('noimpty-learning-v1', JSON.stringify({ version: 1, lessonId: 'python', drafts: { python: { code: 'personal draft', stdin: '', tests: [] } } }))
  app.window.NOIMPTY_LEARNING_HISTORY = {
    get: async () => ({ id: 'case-one', title: '除零', attempts: [
      { language: 'python', code: 'print(1/0)', stdin: '2\n', tests: [{ input: '2\n', expectedOutput: '0.5\n' }], problem: '算倒数', source: { title: '文章', url: '/post/' }, result: { status: 'runtime_error', evidence: 'runner' } },
      { language: 'python', code: 'old corrected solution', result: { status: 'accepted' } }
    ] })
  }
  const lab = app.mount(); await flush()
  assert.equal(lab.textarea.value, 'print(1/0)')
  assert.equal(lab.session.state.stdin, '2\n')
  assert.equal(lab.session.state.tests[0].expectedOutput, '0.5\n')
  assert.equal(lab.session.state.backups[0].code, 'personal draft')
  assert.doesNotMatch(lab.root.textContent, /old corrected solution/)
  assert.equal(lab.root.querySelector('.learning-evidence-ratings').hidden, true)
  lab.dispose()
})

test('safe snippet loading asks before replacing a draft and never runs it implicitly', async () => {
  const app = boot(), lab = app.mount()
  lab.session.edit({ code: 'my draft' })
  app.window.confirm = () => false
  assert.equal((await lab.openSnippet({ language: 'c', code: 'int main() {return 0;}' })).loaded, false)
  assert.equal(lab.session.state.code, 'my draft')
  app.window.confirm = () => true
  await lab.openSnippet({ language: 'c', code: 'int main() {return 0;}' })
  assert.equal(lab.session.state.backups[0].code, 'my draft')
  assert.equal(lab.session.state.history.length, 0)
  lab.dispose()
})


test('normal Run on a saved wrong-answer case executes its original tests instead of an unchecked terminal', async () => {
  const app = boot(), calls = [], tests = [{ input: '4\n', expectedOutput: '0.25\n' }]
  app.window.location.href = 'https://blog.test/learn/?case=case-one'
  app.window.NANALY_AGENT = {
    configured: () => true, snapshot: () => ({ connection: 'connected' }),
    request: async (path, args) => {
      calls.push({ path, ...args })
      if (path === '/api/workspaces') return { workspaces: [] }
      if (path.startsWith('/api/runs')) return { runs: [] }
      return { runId: 'verified-run', revision: args.body.revision, status: 'wrong_answer', stdout: '4\n', stderr: '', diagnostics: [], tests: [{ input: '4\n', expectedOutput: '0.25\n', stdout: '4\n', status: 'wrong_answer' }] }
    }
  }
  app.window.NOIMPTY_LEARNING_HISTORY = { get: async () => ({ id: 'case-one', title: '倒数', reviews: [], attempts: [
    { id: 'failure', language: 'python', code: 'print(input())', stdin: '4\n', tests, problem: '倒数', result: { status: 'wrong_answer', evidence: 'runner' } }
  ] }) }
  const lab = app.mount(); await flush()
  lab.session.edit({ tests: [] })
  await Promise.all([...lab.root.querySelector('.learning-run').listeners.get('click')].map(fn => fn()))
  const submitted = calls.find(item => item.path === '/api/run')
  assert.ok(submitted)
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.body.tests)), tests)
  assert.equal(lab.session.state.result.status, 'wrong_answer')
  assert.equal(calls.some(item => item.path.includes('terminal')), false)
  lab.dispose()
})

test('a saved redo awaiting a rating can be rated after reload while old solution stays hidden', async () => {
  const app = boot(), rated = []
  app.window.location.href = 'https://blog.test/learn/?case=case-one'
  app.window.NOIMPTY_LEARNING_HISTORY = {
    get: async () => ({ id: 'case-one', title: '倒数', reviews: [], attempts: [
      { id: 'failure', language: 'python', code: 'failed source', stdin: '', tests: [], problem: '算倒数', result: { status: 'runtime_error', evidence: 'runner' } },
      { id: 'saved-fix', language: 'python', code: 'hidden correction', result: { status: 'accepted' } }
    ] }), canAdvance: () => true, rate: async (...args) => rated.push(args)
  }
  const lab = app.mount(); await flush()
  assert.doesNotMatch(lab.root.textContent, /hidden correction/)
  assert.match(lab.root.querySelector('.learning-evidence-status').textContent, /上次已保存的重做还没有评分/)
  const ratings = lab.root.querySelector('.learning-evidence-ratings')
  assert.equal(ratings.hidden, false)
  await Promise.all([...ratings.children[2].listeners.get('click')].map(fn => fn()))
  assert.deepEqual(rated, [['case-one', 'saved-fix', 3]])
  assert.equal(ratings.hidden, true)
  lab.dispose()
})
