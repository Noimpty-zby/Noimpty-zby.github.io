import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../../source/js/learning-lab.js', import.meta.url), 'utf8')
// Exercise the private DOM loader without publishing a production test API.
const instrumented = source.replace('Object.freeze({ createSession, createTerminalLink,', 'Object.freeze({ loadEditorBundle, loadTerminalBundle, createSession, createTerminalLink,')
const boot = () => {
  const scripts = [], timers = new Map()
  let sequence = 0
  const window = { addEventListener() {} }
  const document = {
    readyState: 'loading', addEventListener() {},
    head: { append: script => scripts.push(script) },
    getElementById: id => ({ getAttribute: () => `/js/${id === 'learning-editor-src' ? 'learning-editor' : 'learning-terminal'}.js?v=current-build` }),
    createElement: () => ({ removed: false, remove() { this.removed = true } })
  }
  vm.runInNewContext(instrumented, {
    window, document, AbortController, DOMException, URL,
    setTimeout: (callback, ms) => { const id = ++sequence; timers.set(id, { callback, ms }); return id },
    clearTimeout: id => timers.delete(id)
  })
  return { window, scripts, timers, load: window.NOIMPTY_LEARNING.loadTerminalBundle, editor: window.NOIMPTY_LEARNING.loadEditorBundle }
}

test('the terminal bundle shares a request, keeps its fingerprint and releases a failed export for retry', async () => {
  const app = boot()
  const first = app.load()
  assert.equal(app.load(), first)
  assert.equal(app.scripts.length, 1)
  assert.equal(app.scripts[0].src, '/js/learning-terminal.js?v=current-build')
  app.scripts[0].onload()
  await assert.rejects(first, /加载失败/)
  assert.equal(app.scripts[0].removed, true)
  assert.equal(app.timers.size, 0)

  const retry = app.load()
  assert.equal(app.scripts.length, 2)
  const bundle = { create() {} }
  app.window.NOIMPTY_TERMINAL = bundle
  app.scripts[1].onload()
  assert.equal(await retry, bundle)
  assert.equal(await app.load(), bundle)
  assert.equal(app.scripts.length, 2)
  assert.equal(app.timers.size, 0)
})

test('a hanging or failed terminal download remains retryable and cleans up the script and deadline', async () => {
  const app = boot()
  const hanging = app.load()
  const lateLoad = app.scripts[0].onload
  const deadline = [...app.timers.values()][0]
  assert.equal(deadline.ms, 20000)
  deadline.callback()
  await assert.rejects(hanging, /超时/)
  assert.equal(app.scripts[0].removed, true)
  assert.equal(app.timers.size, 0)

  const failed = app.load()
  lateLoad()
  assert.equal(app.scripts.length, 2)
  app.scripts[1].onerror()
  await assert.rejects(failed, /加载失败/)
  assert.equal(app.scripts[1].removed, true)
  assert.equal(app.timers.size, 0)
  const retried = app.load()
  app.window.NOIMPTY_TERMINAL = { create() {} }
  app.scripts[2].onload()
  assert.equal(await retried, app.window.NOIMPTY_TERMINAL)
})


test('reading a page loads neither bundle; opening the editor fetches its fingerprinted script once', async () => {
  const app = boot()
  assert.equal(app.scripts.length, 0)
  const editor = app.editor()
  assert.equal(app.editor(), editor)
  assert.equal(app.scripts.length, 1)
  assert.equal(app.scripts[0].src, '/js/learning-editor.js?v=current-build')
  app.window.NOIMPTY_CODE_EDITOR = { create() {} }
  app.scripts[0].onload()
  assert.equal(await editor, app.window.NOIMPTY_CODE_EDITOR)
  assert.equal(app.timers.size, 0)
  const config = readFileSync(new URL('../../../_config.butterfly.yml', import.meta.url), 'utf8')
  assert.match(config, /<script type="text\/plain" id="learning-editor-src" src="\/js\/learning-editor\.js"><\/script>/)
  assert.doesNotMatch(config, /<script src="\/js\/learning-editor\.js"><\/script>/)
})
