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
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.classList.contains(name)) this.className += ' ' + name },
      remove: name => { this.className = this.className.split(/\s+/).filter(x => x !== name).join(' ') }
    }
    this.style = { values: new Map(), setProperty(name, value) { this.values.set(name, value) } }
  }
  getBoundingClientRect() { return { top: 10, left: 10, width: 100, height: 100, bottom: 110 } }
  getClientRects() { return [this.getBoundingClientRect()] }
  animate() {
    const animation = { cancelled: false, cancel() { this.cancelled = true } }
    this.animation = animation
    return animation
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

const boot = ({ course = false, reduced = true } = {}) => {
  const window = new Events(), document = new Events(), timers = new Map(), frames = new Map()
  const motion = Object.assign(new Events(), { matches: reduced })
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
  Object.assign(window, { matchMedia: () => motion })
  Object.assign(document, {
    readyState: 'complete', documentElement: new Element('html'), hidden: false,
    createElement: tag => new Element(tag),
    querySelector: () => null,
    querySelectorAll: selector => selector === '.noimpty-scene' ? [scene] : selector === 'svg.kw' ? [art] : []
  })
  let timerId = 0
  vm.runInNewContext(source, {
    window, document, innerHeight: 800,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = ++timerId; frames.set(id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id)
  })
  const button = () => scene.querySelector('.noimpty-scene__button')
  // A native button's Enter/Space activation reaches its ancestors as a click with detail 0.
  const activate = (detail = 0) => button().dispatchEvent({ type: 'click', bubbles: true, detail })
  const flush = (delay = 0) => { for (const [id, item] of [...timers]) if (item.delay === delay) { timers.delete(id); item.fn() } }
  const complete = () => { window.dispatchEvent({ type: 'pjax:complete' }); flush() }
  const send = () => document.dispatchEvent({ type: 'pjax:send' })
  const quiet = () => flush(3200)
  const frame = () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn() } }
  const move = () => window.dispatchEvent({ type: 'pointermove', clientX: 200, clientY: 100 })
  return { window, document, motion, timers, frames, scene, art, caption, button, activate, complete, send, quiet, flush, frame, move }
}

await test('mascot gets a named native button without replacing its figure or caption', () => {
  const h = boot()
  assert.equal(h.button().tagName, 'BUTTON')
  assert.equal(h.button().type, 'button')
  assert.equal(h.button().getAttribute('aria-label'), '和企鹅说句话')
  assert.equal(h.art.parentElement, h.button())
  assert.equal(h.art.getAttribute('aria-hidden'), 'true')
  assert.equal(h.caption.parentElement, h.scene)
  assert.equal(h.caption.getAttribute('role'), null, 'figcaption 不能挂 role="status"（axe: aria-allowed-role）')
  assert.equal(h.caption.getAttribute('aria-live'), 'polite')
  assert.equal(h.caption.getAttribute('aria-atomic'), 'true')
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

await test('cancelled or failed PJAX restores the current mascot even without a complete event', () => {
  for (const event of [null, 'pjax:error', 'pjax:abort', 'pjax:cancel']) {
    const h = boot()
    h.send()
    if (event) h.window.dispatchEvent({ type: event })
    h.flush()
    h.activate()
    assert.equal(h.caption.textContent, '第二句', String(event))
    assert.equal(h.scene.listeners.get('click').size, 1)
  }
})

await test('pointer leave cancels its pending frame; disposed callbacks cannot move the old page', () => {
  const h = boot({ reduced: false })
  h.move(); assert.equal(h.frames.size, 1)
  h.document.documentElement.dispatchEvent({ type: 'pointerleave' })
  assert.equal(h.frames.size, 0)
  h.frame()
  assert.equal(h.art.style.values.get('--ex'), '0')
  h.move()
  const stale = [...h.frames.values()][0]
  h.send(); stale()
  assert.equal(h.art.style.values.get('--ex'), '0')
  assert.equal(h.frames.size, 0)
})

await test('motion preference and visibility changes stop and resume pointer work without duplicate listeners', () => {
  const h = boot({ reduced: false })
  h.move(); h.frame()
  assert.notEqual(h.art.style.values.get('--ex'), '0')
  h.motion.matches = true; h.motion.dispatchEvent({ type: 'change' }); h.flush()
  h.move(); assert.equal(h.frames.size, 0)
  assert.equal(h.art.style.values.get('--ex'), '0')
  h.activate(); assert.equal(h.caption.textContent, '第二句')
  h.motion.matches = false; h.motion.dispatchEvent({ type: 'change' }); h.flush()
  assert.equal(h.window.listeners.get('pointermove').size, 1)
  h.document.hidden = true; h.document.dispatchEvent({ type: 'visibilitychange' }); h.flush()
  h.move(); assert.equal(h.frames.size, 0)
  h.document.hidden = false; h.document.dispatchEvent({ type: 'visibilitychange' }); h.flush()
  h.complete(); h.complete()
  assert.equal(h.window.listeners.get('pointermove').size, 1)
  h.move(); assert.equal(h.frames.size, 1)
})

await test('pagehide clears temporary captions, burst particles, animation and delayed refresh work', () => {
  const h = boot({ course: true, reduced: false })
  h.activate()
  const animation = h.scene.querySelector('.noimpty-scene__bubble').animation
  assert.equal(h.scene.querySelectorAll('.kw-burst').length, 7)
  h.window.dispatchEvent({ type: 'pjax:complete' })
  const refresh = [...h.timers.values()].find(item => item.delay === 0).fn
  h.window.dispatchEvent({ type: 'pagehide' })
  assert.equal(h.timers.size, 0)
  assert.equal(h.scene.querySelectorAll('.kw-burst').length, 0)
  assert.equal(h.scene.querySelector('.noimpty-scene__bubble'), null)
  assert.equal(animation.cancelled, true)
  refresh()
  assert.equal(h.scene.listeners.get('click').size, 0)
  h.window.dispatchEvent({ type: 'pageshow' }); h.flush()
  assert.equal(h.scene.listeners.get('click').size, 1)
})
