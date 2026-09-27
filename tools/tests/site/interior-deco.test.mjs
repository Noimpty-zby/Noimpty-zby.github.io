import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../../source/js/interior-deco.js', import.meta.url), 'utf8')

class Events {
  listeners = new Map()
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn) }
  dispatchEvent(event) {
    for (const fn of this.listeners.get(event.type) || []) fn(event)
    if (event.bubbles) this.parentElement?.dispatchEvent(event)
  }
}

class Element extends Events {
  constructor(tagName, className = '') {
    super()
    Object.assign(this, { tagName: tagName.toUpperCase(), className, children: [], attributes: new Map(), dataset: {}, parentElement: null, _text: '' })
    this.classList = { contains: name => this.className.split(/\s+/).includes(name) }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  get textContent() { return this._text + this.children.map(child => child.textContent).join('') }
  set textContent(value) { this._text = String(value); this.children = [] }
  append(child) { child.remove(); child.parentElement = this; this.children.push(child) }
  prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child) }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this)
    this.parentElement = null
  }
  replaceWith(next) {
    const parent = this.parentElement
    next.parentElement = parent
    parent.children.splice(parent.children.indexOf(this), 1, next)
    this.parentElement = null
  }
  querySelectorAll(selector) {
    const [tag, cls] = selector.split('.')
    const matches = node => (!tag || node.tagName === tag.toUpperCase()) && (!cls || node.classList.contains(cls))
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)])
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}

const boot = ({ course = false } = {}) => {
  const window = new Events(), document = new Events(), timers = new Map()
  const scene = new Element('figure', `noimpty-scene${course ? ' noimpty-scene--one' : ''}`)
  scene.dataset.lines = '第二句|第三句'
  let caption = null
  if (!course) {
    caption = new Element('figcaption', 'noimpty-scene__bubble')
    caption.textContent = '第一句'
    scene.append(caption)
  }
  const art = new Element('svg', 'kw')
  art.setAttribute('aria-label', '企鹅')
  scene.append(art)
  Object.assign(window, { matchMedia: () => ({ matches: true }) })
  Object.assign(document, {
    readyState: 'complete',
    createElement: tag => new Element(tag),
    querySelector: () => null,
    querySelectorAll: selector => selector === '.noimpty-scene' ? [scene] : []
  })
  let timerId = 0
  vm.runInNewContext(source, {
    window, document,
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id },
    clearTimeout: id => timers.delete(id)
  })
  const button = () => scene.querySelector('.noimpty-scene__button')
  // A native button's Enter/Space activation reaches its ancestors as a click with detail 0.
  const activate = (detail = 0) => button().dispatchEvent({ type: 'click', bubbles: true, detail })
  const complete = () => window.dispatchEvent({ type: 'pjax:complete' })
  const send = () => document.dispatchEvent({ type: 'pjax:send' })
  const quiet = () => { for (const [id, fn] of timers) { timers.delete(id); fn() } }
  return { scene, art, caption, button, activate, complete, send, quiet }
}

await test('mascot gets a named native button without replacing its figure or caption', () => {
  const h = boot()
  assert.equal(h.button().tagName, 'BUTTON')
  assert.equal(h.button().type, 'button')
  assert.equal(h.button().getAttribute('aria-label'), '和企鹅说句话')
  assert.equal(h.art.parentElement, h.button())
  assert.equal(h.art.getAttribute('aria-hidden'), 'true')
  assert.equal(h.caption.parentElement, h.scene)
  assert.equal(h.caption.getAttribute('role'), 'status')
  h.activate()
  assert.equal(h.caption.textContent, '第二句')
})

await test('PJAX refresh retains one button and one activation, and detaches the old handler on send', () => {
  const h = boot(), button = h.button()
  h.complete(); h.complete()
  assert.equal(h.button(), button)
  assert.equal(h.scene.querySelectorAll('button').length, 1)
  h.activate()
  assert.equal(h.caption.textContent, '第二句')
  h.send()
  h.activate()
  assert.equal(h.caption.textContent, '第二句')
  h.complete()
  h.activate(1)
  assert.equal(h.caption.textContent, '第三句')
  h.activate()
  assert.equal(h.caption.textContent, '第一句')
})

await test('course mascot remains keyboard-activatable after its temporary caption expires', () => {
  const h = boot({ course: true })
  h.activate()
  assert.equal(h.scene.querySelector('.noimpty-scene__bubble').textContent, '第二句')
  h.quiet()
  assert.equal(h.scene.querySelector('.noimpty-scene__bubble'), null)
  h.activate()
  assert.equal(h.scene.querySelector('.noimpty-scene__bubble').textContent, '第三句')
})
