import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/sakura-motion.js', 'utf8')
class Events {
  constructor() { this.listeners = new Map() }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || new Set()
    callbacks.add(callback)
    this.listeners.set(type, callbacks)
  }
  emit(type, detail = {}) {
    for (const callback of this.listeners.get(type) || []) callback({ type, ...detail })
  }
}
const element = (type = 'noimpty-section-card', mode = true) => {
  const attributes = new Map()
  const styles = new Map()
  const calls = []
  const value = {
    isConnected: true, reads: 0, attributes, styles, calls,
    style: { setProperty: (name, data) => styles.set(name, data), removeProperty: name => styles.delete(name) },
    setAttribute: (name, data) => attributes.set(name, data), removeAttribute: name => attributes.delete(name),
    closest(selector) { return selector.split(',').some(part => part.trim() === '.' + type) ? this : null },
    getBoundingClientRect() { this.reads++; return this.rect || { left: 10, top: 20, width: 200, height: 100 } }
  }
  if (mode) value.animate = (frames, options) => {
    if (mode === 'throw') throw new Error('animation unavailable')
    const animation = {
      frames, options, cancellations: 0,
      cancel() { this.cancellations++; if (this.oncancel) this.oncancel() },
      finish() { if (this.onfinish) this.onfinish() }
    }
    calls.push(animation)
    return animation
  }
  return value
}
const boot = ({ fine = true, reduce = false, saveData = false, observer = true, animate = true, scene = true } = {}) => {
  const document = Object.assign(new Events(), { readyState: 'complete', hidden: false, documentElement: element('html') })
  const window = new Events()
  const fineQuery = Object.assign(new Events(), { matches: fine })
  const reduceQuery = Object.assign(new Events(), { matches: reduce })
  const connection = Object.assign(new Events(), { saveData })
  const frames = new Map()
  const observers = []
  let nextFrame = 0
  const cards = [element(undefined, animate), element('noimpty-track-card', animate), element('noimpty-post-card', animate)]
  const dom = { page: element('page', animate), scene: scene ? element('sakura-scene') : null }
  document.querySelectorAll = selector => cards.filter(value => value.closest(selector))
  document.querySelector = selector => selector === '#content-inner' ? dom.page : selector === '.sakura-scene' ? dom.scene : null
  window.matchMedia = query => query.includes('prefers-reduced-motion') ? reduceQuery : fineQuery
  window.navigator = { connection }
  window.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id }
  window.cancelAnimationFrame = id => frames.delete(id)
  if (observer) window.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.observed = new Set(); this.disconnected = false; observers.push(this) }
    observe(value) { this.observed.add(value) }
    unobserve(value) { this.observed.delete(value) }
    disconnect() { this.disconnected = true; this.observed.clear() }
    emit(target, visible = true) { this.callback([{ target, isIntersecting: visible, intersectionRatio: visible ? 0.5 : 0 }]) }
  }
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage is forbidden') } })
  window.fetch = () => { throw new Error('network is forbidden') }
  const context = vm.createContext({ window, document })
  const execute = () => vm.runInContext(source, context)
  execute()
  return {
    window, document, dom, cards, frames, observers, fineQuery, reduceQuery, connection, execute,
    cardWatch: () => observers.findLast(watch => !watch.disconnected && watch.options.threshold === 0.08),
    sceneWatch: () => observers.findLast(watch => !watch.disconnected && watch.options.threshold === 0),
    move(target, clientX = 110, clientY = 70, extra = {}) { document.emit('pointermove', { target, clientX, clientY, pointerType: 'mouse', buttons: 0, ...extra }) },
    flush() { const queue = [...frames.values()]; frames.clear(); queue.forEach(callback => callback()) }
  }
}
let passed = 0
const check = (label, fn) => { fn(); passed++; console.log('  ✓ ' + label) }
const noLight = target => {
  assert.equal(target.attributes.has('data-sakura-light'), false)
  assert.equal(target.styles.has('--sakura-light-x'), false)
  assert.equal(target.styles.has('--sakura-light-y'), false)
}
const ambient = app => app.document.documentElement.attributes.has('data-sakura-ambient')

check('pointer bursts use one frame, clamp coordinates and only illuminate supported cards', () => {
  const app = boot()
  const [section, track, post] = app.cards
  const child = { closest: selector => section.closest(selector) }
  for (let i = 0; i < 10; i++) app.move(child, 30 + i * 10, 45)
  assert.equal(app.frames.size, 1)
  assert.equal(section.reads, 0)
  app.flush()
  assert.equal(section.reads, 1)
  assert.equal(section.styles.get('--sakura-light-x'), '55.00%')
  assert.equal(section.styles.get('--sakura-light-y'), '25.00%')
  assert.equal(section.attributes.has('data-sakura-light'), true)
  assert.equal(app.frames.size, 0)
  app.move(track, 999, -50)
  app.flush()
  noLight(section)
  assert.equal(track.styles.get('--sakura-light-x'), '100.00%')
  assert.equal(track.styles.get('--sakura-light-y'), '0.00%')
  app.move(post)
  noLight(track)
  noLight(post)
})

check('leaving cards, detaching nodes and invalid pointer geometry clear queued work', () => {
  const app = boot()
  const target = app.cards[0]
  app.move(target)
  app.document.emit('pointerout', { target, relatedTarget: { closest: selector => target.closest(selector) } })
  assert.equal(app.frames.size, 1)
  app.document.emit('pointerout', { target, relatedTarget: null })
  assert.equal(app.frames.size, 0)
  app.move(target)
  target.isConnected = false
  app.flush()
  noLight(target)
  target.isConnected = true
  target.rect = { left: 0, top: 0, width: 0, height: 10 }
  app.move(target)
  app.flush()
  noLight(target)
  app.move(target, Number.NaN)
  assert.equal(app.frames.size, 0)
})

check('mobile cards and pages animate without mouse-only illumination', () => {
  const app = boot({ fine: false })
  assert.equal(app.dom.page.calls.length, 1)
  const watch = app.cardWatch()
  assert.equal(watch.observed.size, 3)
  watch.emit(app.cards[2])
  assert.equal(app.cards[2].calls.length, 1)
  assert.equal(app.cards[2].calls[0].options.duration, 360)
  app.move(app.cards[0], 100, 50, { pointerType: 'touch' })
  assert.equal(app.frames.size, 0)
  noLight(app.cards[0])
})

check('reduced motion and data saving start with fully static, visible content', () => {
  for (const options of [{ reduce: true }, { saveData: true }]) {
    const app = boot(options)
    assert.equal(app.dom.page.calls.length, 0)
    assert.equal(app.observers.length, 0)
    app.move(app.cards[0])
    assert.equal(app.frames.size, 0)
    assert.equal(ambient(app), false)
    app.cards.forEach(card => { assert.equal(card.attributes.size, 0); assert.equal(card.styles.size, 0) })
  }
})

check('cards are visible before intersection and only enter once per DOM element', () => {
  const app = boot()
  const watch = app.cardWatch()
  const target = app.cards[2]
  assert.equal(target.calls.length, 0)
  assert.equal(target.attributes.size, 0)
  assert.equal(target.styles.size, 0)
  watch.emit(target, false)
  assert.equal(target.calls.length, 0)
  watch.emit(target)
  assert.equal(target.calls.length, 1)
  assert.equal(watch.observed.has(target), false)
  target.calls[0].finish()
  app.execute()
  assert.equal(app.cardWatch().observed.has(target), false)
  assert.equal(target.calls.length, 1)
  app.reduceQuery.matches = true
  app.reduceQuery.emit('change')
  assert.equal(target.calls[0].cancellations, 0, 'finished animations must be released')
})

check('missing observers or Web Animations do not change underlying visibility or styles', () => {
  const app = boot({ observer: false })
  assert.equal(app.dom.page.calls.length, 1)
  assert.equal(app.observers.length, 0)
  assert.equal(ambient(app), false)
  for (const animate of [false, 'throw']) {
    const staticApp = boot({ animate })
    staticApp.cardWatch().emit(staticApp.cards[0])
    assert.equal(staticApp.dom.page.calls.length, 0)
    assert.equal(staticApp.cards[0].calls.length, 0)
    assert.equal(staticApp.dom.page.styles.size, 0)
    assert.equal(staticApp.cards[0].styles.size, 0)
  }
})

check('page entry targets only a new reading container and leaves no filled animation', () => {
  const app = boot()
  const page = app.dom.page
  const entry = page.calls[0]
  assert.equal(entry.options.duration, 300)
  assert.equal(entry.options.fill, 'none')
  assert.equal(entry.frames[0].opacity, 0.82)
  assert.equal(entry.frames[0].translate, '0 7px')
  assert.equal(page.styles.size, 0)
  app.document.emit('pjax:complete')
  app.document.emit('pjax:error')
  app.window.emit('noimpty:hub-ready')
  assert.equal(page.calls.length, 1)
  assert.equal(app.document.documentElement.calls.length, 0)
  assert.equal(app.dom.scene.calls.length, 0)
})

check('navigation cancellation without any terminal event leaves old cards interactive', () => {
  const app = boot()
  const target = app.cards[0]
  app.move(target)
  app.document.emit('pjax:send')
  assert.equal(app.frames.size, 0)
  assert.equal(app.dom.page.calls[0].cancellations, 1)
  assert.equal(app.dom.page.styles.size, 0)
  assert.equal(app.cardWatch().observed.has(target), true)
  app.move(target)
  app.flush()
  assert.equal(target.attributes.has('data-sakura-light'), true)
  app.cardWatch().emit(target)
  assert.equal(target.calls.length, 1)
})

check('rapid page switches reject stale observers and recover from late terminal events', () => {
  const app = boot()
  const oldWatch = app.cardWatch()
  app.document.emit('pjax:send')
  app.document.emit('pjax:send')
  const oldPage = app.dom.page
  oldPage.isConnected = false
  app.dom.page = element('page')
  app.document.emit('pjax:complete')
  oldWatch.emit(app.cards[0])
  assert.equal(app.cards[0].calls.length, 0)
  assert.equal(app.dom.page.calls.length, 1)
  for (const type of ['pjax:error', 'pjax:abort', 'pjax:cancel', 'pjax:complete']) app.document.emit(type)
  assert.equal(app.dom.page.calls.length, 1)
  assert.equal(app.dom.page.calls[0].cancellations, 0)
  app.cardWatch().emit(app.cards[0])
  assert.equal(app.cards[0].calls.length, 1)
})

check('ambient art runs only while the current home scene is inside the viewport', () => {
  const app = boot({ fine: false })
  const watch = app.sceneWatch()
  assert.equal(ambient(app), false)
  watch.emit(app.dom.scene)
  assert.equal(ambient(app), true)
  watch.emit(app.dom.scene, false)
  assert.equal(ambient(app), false)
  app.window.emit('noimpty:hub-ready')
  watch.emit(app.dom.scene)
  assert.equal(ambient(app), false, 'stale observer must not resume ambient motion')
  app.sceneWatch().emit(app.dom.scene)
  assert.equal(ambient(app), true)
  app.dom.scene.isConnected = false
  app.sceneWatch().emit(app.dom.scene)
  assert.equal(ambient(app), false)
})

check('background and blur cancel active animations and restore static CSS immediately', () => {
  const app = boot()
  const target = app.cards[0]
  app.move(target)
  app.flush()
  app.cardWatch().emit(target)
  app.sceneWatch().emit(app.dom.scene)
  app.document.hidden = true
  app.document.emit('visibilitychange')
  assert.equal(ambient(app), false)
  noLight(target)
  assert.equal(target.calls[0].cancellations, 1)
  assert.equal(app.dom.page.calls[0].cancellations, 1)
  app.move(target)
  assert.equal(app.frames.size, 0)
  app.document.hidden = false
  app.document.emit('visibilitychange')
  assert.equal(app.dom.page.calls.length, 1, 'returning to a page must not replay its entry')
  app.sceneWatch().emit(app.dom.scene)
  assert.equal(ambient(app), true)
  app.window.emit('blur')
  assert.equal(ambient(app), false)
  app.window.emit('focus')
  app.sceneWatch().emit(app.dom.scene)
  assert.equal(ambient(app), true)
})

check('live reduced-motion and connection changes stop all visual enhancements', () => {
  const app = boot()
  const target = app.cards[0]
  app.move(target)
  app.flush()
  app.sceneWatch().emit(app.dom.scene)
  app.reduceQuery.matches = true
  app.reduceQuery.emit('change')
  noLight(target)
  assert.equal(ambient(app), false)
  assert.equal(app.cardWatch(), undefined)
  app.reduceQuery.matches = false
  app.reduceQuery.emit('change')
  app.move(target)
  app.connection.saveData = true
  app.connection.emit('change')
  assert.equal(app.frames.size, 0)
  assert.equal(ambient(app), false)
  app.connection.saveData = false
  app.connection.emit('change')
  app.fineQuery.matches = false
  app.fineQuery.emit('change')
  assert.ok(app.cardWatch(), 'changing pointer capability must not disable card entry')
})

check('late hub insertion and repeated initialization do not duplicate global handlers', () => {
  const app = boot({ scene: false })
  app.execute()
  app.execute()
  assert.equal(app.document.listeners.get('pointermove').size, 1)
  assert.equal(app.document.listeners.get('pjax:send').size, 1)
  assert.equal(app.document.listeners.get('pjax:error').size, 1)
  assert.equal(app.window.listeners.get('blur').size, 1)
  const late = element('noimpty-track-card')
  app.cards.push(late)
  app.dom.scene = element('sakura-scene')
  app.window.emit('noimpty:hub-ready')
  assert.equal(app.cardWatch().observed.has(late), true)
  app.cardWatch().emit(late)
  assert.equal(late.calls.length, 1)
  app.sceneWatch().emit(app.dom.scene)
  assert.equal(ambient(app), true)
})

console.log(`\n${passed} sakura motion regression groups passed`)
