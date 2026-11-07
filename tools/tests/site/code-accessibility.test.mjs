import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const theme = readFileSync(new URL('../../../themes/noimpty/source/js/noimpty-theme.js', import.meta.url), 'utf8')
const start = theme.indexOf('  let codeFocusCleanup = null')
const end = theme.indexOf('  /* ---------------- 正文图片', start)
assert.ok(start >= 0 && end > start)
const code = theme.slice(start, end)

const region = (width, contentWidth, attrs = {}, tagName = 'PRE') => {
  const attributes = new Map(Object.entries(attrs))
  return {
    tagName, clientWidth: width, scrollWidth: contentWidth,
    gutter: false,
    closest() { return this.gutter ? {} : null },
    hasAttribute: name => attributes.has(name),
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name)
  }
}

function boot(initial, withObserver = true) {
  let regions = initial, resolveFonts
  const listeners = new Set(), observers = []
  const window = {
    addEventListener(type, fn) { assert.equal(type, 'resize'); listeners.add(fn) },
    removeEventListener(type, fn) { assert.equal(type, 'resize'); listeners.delete(fn) }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.observed = []; observers.push(this) }
    observe(el) { this.observed.push(el) }
    disconnect() { this.disconnected = true }
  }
  const context = vm.createContext({
    $$: () => regions, window,
    document: { fonts: { ready: new Promise(resolve => { resolveFonts = resolve }) } },
    ...(withObserver ? { ResizeObserver } : {})
  })
  vm.runInContext(code + '\nthis.mount = mountCodeFocus; this.cleanup = () => codeFocusCleanup();', context)
  return {
    mount: () => context.mount(), cleanup: () => context.cleanup(), listeners, observers,
    resize: () => { for (const fn of listeners) fn() },
    fontsReady: async () => { resolveFonts(); await Promise.resolve(); await Promise.resolve() },
    navigate: next => { regions = next; context.mount() }
  }
}

test('wide code, tables and formulas gain keyboard access; ordinary code and gutters do not', () => {
  const code = region(300, 700), table = region(300, 600, {}, 'TABLE')
  const formula = region(300, 500, {}, 'DIV'), short = region(300, 300)
  const gutter = region(20, 50); gutter.gutter = true
  const hidden = region(0, 700)
  const env = boot([code, table, formula, short, gutter, hidden]); env.mount()
  assert.equal(code.getAttribute('tabindex'), '0')
  assert.equal(code.getAttribute('role'), 'group')
  assert.equal(code.getAttribute('aria-label'), '代码，可以左右滚动')
  assert.equal(table.getAttribute('role'), null)
  assert.equal(table.getAttribute('aria-label'), '表格，可以左右滚动')
  assert.equal(formula.getAttribute('aria-label'), '公式，可以左右滚动')
  for (const el of [short, gutter, hidden]) assert.equal(el.getAttribute('tabindex'), null)
})

test('resizing and late fonts update only attributes owned by the theme', async () => {
  const code = region(300, 500), custom = region(300, 500, { tabindex: '-1', 'aria-label': '已有名称' })
  const labeled = region(300, 500, { role: 'group', 'aria-label': '既有代码区' })
  const env = boot([code, custom, labeled]); env.mount()
  assert.equal(custom.getAttribute('tabindex'), '-1')
  assert.equal(labeled.getAttribute('aria-label'), '既有代码区')
  code.scrollWidth = 300; labeled.scrollWidth = 300; env.resize()
  assert.equal(code.getAttribute('tabindex'), null)
  assert.equal(code.getAttribute('role'), null)
  assert.equal(labeled.getAttribute('tabindex'), null)
  assert.equal(labeled.getAttribute('aria-label'), '既有代码区')
  assert.equal(labeled.getAttribute('role'), 'group')
  code.scrollWidth = 500; await env.fontsReady()
  assert.equal(code.getAttribute('tabindex'), '0')
  code.setAttribute('aria-label', '后来设置的名称'); code.scrollWidth = 300; env.resize()
  assert.equal(code.getAttribute('aria-label'), '后来设置的名称')
})

test('PJAX replacement disconnects old observers and leaves one resize handler', async () => {
  const old = region(300, 500), next = region(300, 700)
  const env = boot([old]); env.mount(); env.navigate([next])
  assert.equal(env.observers[0].disconnected, true)
  assert.equal(old.getAttribute('tabindex'), null)
  assert.equal(next.getAttribute('tabindex'), '0')
  assert.equal(env.listeners.size, 1)
  env.cleanup(); await env.fontsReady()
  assert.equal(env.listeners.size, 0)
  assert.equal(next.getAttribute('tabindex'), null)
})

test('keyboard scrolling still works when ResizeObserver is unavailable', () => {
  const code = region(300, 500), env = boot([code], false); env.mount()
  assert.equal(code.getAttribute('tabindex'), '0')
  code.scrollWidth = 300; env.resize()
  assert.equal(code.getAttribute('tabindex'), null)
  env.cleanup()
})

test('code line numbers meet the 4.5:1 contrast requirement', () => {
  const css = readFileSync(new URL('../../../themes/noimpty/source/css/noimpty.css', import.meta.url), 'utf8')
  const color = name => css.match(new RegExp('--' + name + ': #(\\w{6});'))[1]
  const luminance = hex => hex.match(/../g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0)
  const values = [luminance(color('code-bg')), luminance(color('c-gutter'))].sort((a, b) => b - a)
  assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5)
})
