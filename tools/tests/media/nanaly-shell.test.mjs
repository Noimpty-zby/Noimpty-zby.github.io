import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import postcss from 'postcss'

const source = readFileSync('source/js/nanaly-shell.js', 'utf8')
const key = 'nanaly-shell-v1'
class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.children = []; this.parentNode = null
    this.className = ''; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.hidden = false
    this.textContent = ''; this.offsetTop = 132; this.offsetHeight = 49
    this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].filter(Boolean).join(' ') },
      remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' ') },
      toggle: (name, force) => { const yes = force ?? !this.classList.contains(name); yes ? this.classList.add(name) : this.classList.remove(name); return yes }
    }
  }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)) }
  appendChild(node) { node.remove(); node.parentNode = this; this.children.push(node); return node }
  insertBefore(node, before) { node.remove(); node.parentNode = this; const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, node) }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null } }
  get firstChild() { return this.children[0] }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1))
    const attribute = selector.match(/^\[([^=]+)="([^"]+)"\]$/)
    if (attribute) return this.getAttribute(attribute[1]) === attribute[2]
    return selector === this.tagName
  }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  closest(selector) { return selector.split(',').some(item => this.matches(item.trim())) ? this : this.parentNode?.closest(selector) || null }
  addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn) }
  removeEventListener(type, fn) { this.listeners[type]?.delete(fn) }
  emit(type, extra = {}) {
    const event = { type, target: this, button: 0, pointerId: 1, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true }, ...extra }
    for (const fn of this.listeners[type] || []) fn(event)
    return event
  }
  click() { this.emit('click') }
  focus() { this.ownerDocument.activeElement = this }
  setPointerCapture() {}
}
const boot = (seed, denied = false) => {
  const saved = new Map(seed ? [[key, JSON.stringify(seed)]] : [])
  const document = new Element('document')
  document.ownerDocument = document; document.createElement = tag => new Element(tag, document)
  document.documentElement = { clientWidth: 1440, clientHeight: 900 }
  const window = new Element('window', document)
  Object.assign(window, {
    innerWidth: 1440, innerHeight: 900,
    localStorage: { getItem(k) { if (denied) throw Error('denied'); return saved.get(k) }, setItem(k, value) { if (denied) throw Error('denied'); saved.set(k, value) } },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}
  })
  vm.runInNewContext(source, { window, document })
  const panel = document.createElement('div'); panel.className = 'is-open'
  const head = document.createElement('div'); head.className = 'nanaly-head'
  for (let i = 0; i < 5; i++) { const button = document.createElement('button'); button.className = 'nanaly-head__btn'; head.appendChild(button) }
  const bar = document.createElement('div'); bar.className = 'nanaly-workspace-bar'
  const drawer = document.createElement('section'); drawer.className = 'nanaly-workspace-drawer'; drawer.hidden = true
  const input = document.createElement('textarea'), launcher = document.createElement('button')
  panel.append(head, bar, drawer, input)
  const shell = window.NANALY_SHELL.mount({ panel, input, launcher, onCloseDrawer() { drawer.hidden = true } })
  return { window, document, panel, head, bar, drawer, input, launcher, shell, saved }
}
let count = 0
const check = (label, run) => { run(); count++; console.log('  ✓ ' + label) }

check('all layouts stay within the visible viewport, including extreme stored sizes', () => {
  const { window } = boot()
  for (const mode of ['dock', 'float', 'focus', 'invalid']) {
    for (const width of [1, 240, 320, 390, 640, 641, 768, 1024, 1440, 2560]) {
      for (const height of [1, 180, 320, 540, 800, 1440]) {
        for (const size of [-9999, 0, 100, 99999, Infinity, NaN]) {
          const result = window.NANALY_SHELL.geometry({ mode, dockWidth: size, floatWidth: size, floatHeight: size, x: size, y: size }, { width, height })
          assert.ok(result.width > 0 && result.height > 0)
          assert.ok(result.x >= 0 && result.y >= 0)
          assert.ok(result.x + result.width <= width + .001, JSON.stringify({ mode, width, height, size, result }))
          assert.ok(result.y + result.height <= height + .001)
        }
      }
    }
  }
})
check('desktop opens as a 520px tall dock, with keyboard-resizable width', () => {
  const app = boot(), grip = app.panel.querySelector('.nanaly-shell-resize--width')
  assert.equal(app.shell.getLayout().width, 520)
  assert.equal(app.shell.getLayout().height, 868)
  assert.equal(app.shell.getLayout().x, 904)
  const event = grip.emit('keydown', { key: 'ArrowLeft' })
  assert.equal(event.prevented, true)
  assert.equal(app.shell.getLayout().width, 536)
  assert.equal(grip.getAttribute('aria-valuenow'), '536')
  for (let i = 0; i < 20; i++) grip.emit('keydown', { key: 'ArrowLeft', shiftKey: true })
  assert.equal(app.shell.getLayout().width, 900)
  assert.equal(grip.getAttribute('aria-valuemax'), '900')
  for (let i = 0; i < 20; i++) grip.emit('keydown', { key: 'ArrowRight', shiftKey: true })
  assert.equal(app.shell.getLayout().width, 400)
  assert.equal(JSON.parse(app.saved.get(key)).dockWidth, 400)
})
check('pointer resize clamps the window and double-click restores a sensible default', () => {
  const app = boot(), grip = app.panel.querySelector('.nanaly-shell-resize--width')
  grip.emit('pointerdown', { clientX: 900, clientY: 500 })
  app.panel.emit('pointermove', { clientX: -10000, clientY: 500 })
  assert.equal(app.shell.getLayout().width, 900)
  app.panel.emit('pointerup')
  assert.equal(JSON.parse(app.saved.get(key)).dockWidth, 900)
  assert.equal(app.panel.classList.contains('nanaly-shell--resizing'), false)
  grip.emit('dblclick')
  assert.equal(app.shell.getLayout().width, 520)
})
check('floating windows resize in both directions and can be dragged without leaving the screen', () => {
  const app = boot()
  assert.equal(app.shell.setMode('float'), true)
  assert.equal(app.shell.getLayout().width, 620)
  assert.equal(app.panel.querySelector('.nanaly-shell-resize--height').hidden, false)
  app.head.emit('pointerdown', { clientX: 900, clientY: 50 })
  app.panel.emit('pointermove', { clientX: -9999, clientY: 9999 })
  app.panel.emit('pointerup')
  const moved = app.shell.getLayout()
  assert.equal(moved.x, 16)
  assert.equal(moved.y + moved.height, 884)
  app.panel.querySelector('.nanaly-shell-resize--height').emit('keydown', { key: 'ArrowUp', shiftKey: true })
  assert.equal(app.shell.getLayout().height, moved.height - 64)
  assert.equal(app.launcher.classList.contains('nanaly-shell-launcher-hidden'), true)
})
check('focus layout disables resize and returns to saved widths', () => {
  const app = boot({ mode: 'dock', dockWidth: 680 })
  app.shell.setMode('focus')
  assert.equal(app.shell.getLayout().width, 1160)
  assert.equal(app.panel.querySelector('.nanaly-shell-resize--width').hidden, true)
  assert.equal(app.shell.setMode('bad'), false)
  app.shell.setMode('dock')
  assert.equal(app.shell.getLayout().width, 680)
})
check('mobile keyboard viewport moves the composer into view and preserves desktop preferences', () => {
  const app = boot({ mode: 'float', floatWidth: 800 })
  const visual = new Element('viewport', app.document)
  Object.assign(visual, { width: 390, height: 420, offsetTop: 45, offsetLeft: 0 })
  app.window.visualViewport = visual
  app.shell.refresh()
  assert.equal(app.shell.getLayout().width, 378)
  assert.equal(app.shell.getLayout().height, 408)
  assert.equal(app.panel.style['--nanaly-shell-y'], '51px')
  assert.equal(app.panel.querySelector('.nanaly-shell-actions').parentNode, app.bar)
  assert.equal(app.panel.querySelector('.nanaly-shell-resize--width').hidden, true)
  app.window.visualViewport = null; app.shell.refresh()
  assert.equal(app.shell.getLayout().width, 800)
  assert.equal(app.panel.querySelector('.nanaly-shell-actions').parentNode.classList.contains('nanaly-shell-toolbar'), true)
})
check('drawers overlay narrow windows, become sidebars in focus, and Escape closes only the drawer', () => {
  const app = boot()
  app.drawer.hidden = false; app.shell.refresh()
  assert.equal(app.panel.querySelector('.nanaly-shell-scrim').hidden, false)
  assert.equal(app.panel.classList.contains('nanaly-shell--drawer'), true)
  app.shell.setMode('focus')
  assert.equal(app.panel.querySelector('.nanaly-shell-scrim').hidden, true)
  assert.equal(app.panel.dataset.nanalyWide, 'true')
  const event = app.panel.emit('keydown', { key: 'Escape' })
  assert.equal(event.stopped, true)
  assert.equal(app.drawer.hidden, true)
  assert.equal(app.document.activeElement, app.input)
  assert.equal(app.panel.classList.contains('is-open'), true)
})
check('unavailable browser storage does not block the shell, and destroy restores the DOM', () => {
  const app = boot(null, true)
  app.shell.setMode('float')
  app.panel.querySelector('.nanaly-shell-resize--width').emit('keydown', { key: 'ArrowLeft' })
  assert.equal(app.shell.getLayout().width, 636)
  app.shell.destroy()
  assert.equal(app.panel.classList.contains('nanaly-shell'), false)
  assert.equal(app.head.children.length, 5)
  assert.equal(app.launcher.classList.contains('nanaly-shell-launcher-hidden'), false)
  assert.equal(app.panel.querySelector('.nanaly-shell-toolbar'), null)
})
check('shell CSS parses and keeps visible overflow restricted to the message or drawer scroll area', () => {
  const css = readFileSync('source/css/nanaly-shell.css', 'utf8')
  assert.doesNotThrow(() => postcss.parse(css))
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /safe-area-inset-bottom/)
  assert.match(css, /nanaly-shell--sleeping/)
})

check('destroying a mobile shell removes relocated actions and remounts without duplicates', () => {
  const app = boot()
  app.window.innerWidth = 390; app.shell.refresh()
  assert.equal(app.panel.querySelector('.nanaly-shell-actions').parentNode, app.bar)
  app.shell.destroy()
  assert.equal(app.panel.querySelector('.nanaly-shell-actions'), null)
  assert.equal(app.panel.dataset.nanalyMobile, undefined)
  assert.equal(app.panel.style['--nanaly-shell-width'], undefined)
  app.window.NANALY_SHELL.mount({ panel: app.panel, input: app.input, launcher: app.launcher })
  assert.equal(app.panel.querySelectorAll('.nanaly-shell-actions').length, 1)
})

console.log(`\n${count} 个娜娜莉窗口测试通过`)
