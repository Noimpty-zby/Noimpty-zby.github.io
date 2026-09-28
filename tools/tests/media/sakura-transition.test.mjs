import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/sakura-transition.js', 'utf8')

class Events {
  constructor() { this.listeners = new Map() }
  addEventListener(type, callback) {
    const values = this.listeners.get(type) || new Set()
    values.add(callback)
    this.listeners.set(type, values)
  }
  emit(type, data = {}) {
    for (const callback of [...(this.listeners.get(type) || [])]) callback({ type, ...data })
  }
  count() { return [...this.listeners.values()].reduce((total, values) => total + values.size, 0) }
}

const boot = ({ reduce = false, forcedColors = false, saveData = false, hidden = false,
  compact = false, waapi = true, throwAt = 0, raf = true, legacyMedia = false } = {}) => {
  let clock = 0
  let nextId = 0
  let animationAttempts = 0
  const timers = new Map()
  const frames = new Map()
  const timerHistory = []
  const frameHistory = []
  const animations = []
  const make = (tag = 'div') => {
    const attributes = new Map()
    const styles = new Map()
    const node = {
      tagName: tag.toUpperCase(), children: [], parentNode: null, attributes, styles, hidden: false,
      className: '', textContent: '',
      style: { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) },
      setAttribute: (name, value) => attributes.set(name, value),
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child)
        child.parentNode = this
        this.children.push(child)
        return child
      },
      removeChild(child) {
        this.children = this.children.filter(value => value !== child)
        child.parentNode = null
        return child
      },
      querySelector(selector) { return this.selectors?.get(selector) || null },
      get isConnected() { return this.root === true || Boolean(this.parentNode?.isConnected) }
    }
    if (waapi) node.animate = (keyframes, options) => {
      animationAttempts++
      if (throwAt && animationAttempts >= throwAt) throw new Error('Web Animations unavailable')
      const animation = {
        node, keyframes, options, startedAt: clock,
        endsAt: clock + (options.delay || 0) + options.duration, cancellations: 0, active: true,
        cancel() { this.cancellations++; this.active = false; this.oncancel?.() },
        finish() { this.active = false; this.onfinish?.() }
      }
      animations.push(animation)
      return animation
    }
    return node
  }
  const document = Object.assign(new Events(), { hidden, readyState: 'complete', createElement: make })
  const window = new Events()
  document.body = Object.assign(make('body'), { root: true })
  document.documentElement = Object.assign(make('html'), { root: true })
  const makePage = (home = false) => {
    const page = make('main')
    page.heading = make('header')
    page.appendChild(page.heading)
    page.selectors = new Map([[home ? '#site-info' : '#page-site-info', page.heading]])
    return page
  }
  let page = makePage()
  document.body.appendChild(page)
  document.querySelector = selector => selector === '#body-wrap' ? page : null
  const preference = matches => {
    const value = Object.assign(new Events(), { matches })
    if (legacyMedia) {
      value.addListener = callback => Events.prototype.addEventListener.call(value, 'change', callback)
      value.addEventListener = undefined
    }
    return value
  }
  const reduced = preference(reduce)
  const contrast = preference(forcedColors)
  const small = preference(compact)
  const connection = Object.assign(new Events(), { saveData })
  window.navigator = { connection }
  window.matchMedia = query => query.includes('reduced-motion') ? reduced : query.includes('forced-colors') ? contrast : small
  window.setTimeout = (callback, delay) => {
    const timer = { id: ++nextId, callback, at: clock + delay }
    timers.set(timer.id, timer)
    timerHistory.push(timer)
    return timer.id
  }
  window.clearTimeout = id => timers.delete(id)
  if (raf) {
    window.requestAnimationFrame = callback => {
      const frame = { id: ++nextId, callback }
      frames.set(frame.id, frame)
      frameHistory.push(frame)
      return frame.id
    }
    window.cancelAnimationFrame = id => frames.delete(id)
  }
  const context = vm.createContext({ window, document })
  const execute = () => vm.runInContext(source, context)
  const advance = milliseconds => {
    const destination = clock + milliseconds
    let count = 0
    while (true) {
      const timer = [...timers.values()].filter(value => value.at <= destination).sort((a, b) => a.at - b.at)[0]
      const animation = animations.filter(value => value.active && value.endsAt <= destination).sort((a, b) => a.endsAt - b.endsAt)[0]
      if (!timer && !animation) break
      assert.ok(count++ < 1000, 'cleanup must not create an unbounded timer loop')
      if (animation && (!timer || animation.endsAt <= timer.at)) {
        clock = animation.endsAt
        animation.finish()
      } else {
        clock = timer.at
        timers.delete(timer.id)
        timer.callback()
      }
    }
    clock = destination
  }
  execute()
  return {
    window, document, reduced, contrast, connection, timers, frames, timerHistory, frameHistory, animations, execute,
    page: () => page,
    layer: () => document.body.children.find(node => node.className === 'sakura-transition'),
    active: () => animations.filter(animation => animation.active),
    headingAnimations: () => animations.filter(animation => animation.node === page.heading),
    advance,
    now: () => clock,
    flushFrames() {
      const pending = [...frames.values()]
      frames.clear()
      for (const frame of pending) frame.callback(clock)
    },
    replacePage(home = false) {
      const old = page
      document.body.removeChild(old)
      page = makePage(home)
      document.body.appendChild(page)
      return old
    },
    send() { document.emit('pjax:send') },
    complete() { document.emit('pjax:complete') },
    success() { document.emit('pjax:success') }
  }
}

let passed = 0
let failed = 0
const check = (name, run) => {
  try { run(); passed++; console.log('  ✓ ' + name) }
  catch (error) { failed++; console.error('  ✗ ' + name); console.error(error) }
}
const settled = app => {
  assert.ok(!app.layer() || app.layer().hidden, 'decoration must be hidden')
  assert.equal(app.active().length, 0, 'no animation remains active')
  assert.equal(app.timers.size, 0, 'no timer remains queued')
  assert.equal(app.frames.size, 0, 'no animation frame remains queued')
}

check('initial load is static and a successful PJAX replacement animates only after a frame', () => {
  const app = boot()
  assert.equal(app.layer(), undefined)
  assert.equal(app.animations.length, 0)
  app.send()
  const layer = app.layer()
  assert.ok(layer && !layer.hidden)
  assert.equal(layer.parentNode, app.document.body)
  assert.equal(layer.attributes.get('aria-hidden'), 'true')
  const old = app.replacePage()
  assert.equal(old.isConnected, false)
  app.complete()
  assert.equal(app.frames.size, 0, 'complete alone is not a success signal')
  app.success()
  assert.equal(app.headingAnimations().length, 0)
  assert.equal(app.frames.size, 1)
  app.flushFrames()
  assert.equal(app.headingAnimations().length, 1)
  assert.equal(app.layer(), layer, 'the decorative sibling survives page replacement')
  assert.equal(app.page().styles.size, 0, 'navigation never hides or transforms the page itself')
  assert.equal(app.document.body.styles.size, 0, 'fixed controls keep their containing block')
  app.advance(2000)
  settled(app)
})

check('complete followed by failure never animates an incoming heading and cleans all effects', () => {
  for (const ending of ['pjax:error', 'pjax:abort', 'pjax:cancel']) {
    const app = boot()
    const original = app.page()
    app.send()
    app.complete()
    assert.equal(app.frames.size, 0)
    app.document.emit(ending)
    assert.equal(app.page(), original)
    assert.equal(app.headingAnimations().length, 0)
    settled(app)
  }
})

check('silent cancellation and complete without success expire without a terminal event', () => {
  for (const complete of [false, true]) {
    const app = boot()
    app.send()
    if (complete) app.complete()
    assert.ok(app.timers.size > 0)
    app.advance(2000)
    settled(app)
    app.send()
    assert.equal(app.layer().hidden, false, 'a later navigation can still run')
    app.advance(2000)
    settled(app)
  }
})

check('success after a slow request still reveals the new heading and cleans up', () => {
  const app = boot({ compact: true })
  app.send()
  app.advance(2000)
  settled(app)
  app.replacePage(true)
  app.success()
  app.flushFrames()
  assert.equal(app.headingAnimations().length, 1, 'home heading uses its own selector')
  assert.equal(app.layer().hidden, false)
  app.advance(2000)
  settled(app)
})

check('a late success does not let the outgoing sweep timer truncate heading entry', () => {
  const app = boot()
  app.send()
  const expiry = Math.min(...[...app.timers.values()].map(timer => timer.at))
  app.advance(expiry - app.now() - 20)
  app.replacePage()
  app.success()
  app.flushFrames()
  const heading = app.headingAnimations()[0]
  assert.ok(heading)
  app.advance(30)
  assert.equal(heading.cancellations, 0, 'the earlier sweep deadline must not cancel a newly arriving heading')
  app.advance(2000)
  settled(app)
})

check('rapid sends reject old timers and old animation frames after a newer success', () => {
  const app = boot()
  app.send()
  const oldTimer = app.timerHistory.at(-1)
  app.replacePage()
  app.success()
  const oldFrame = app.frameHistory.at(-1)
  const firstHeading = app.page().heading
  app.send()
  app.replacePage()
  app.success()
  oldTimer.callback()
  oldFrame.callback()
  assert.equal(app.layer().hidden, false, 'a stale deadline must not hide the active wipe')
  assert.equal(app.animations.some(animation => animation.node === firstHeading), false)
  app.flushFrames()
  const heading = app.headingAnimations()[0]
  assert.ok(heading && heading.active)
  oldTimer.callback()
  assert.equal(heading.active, true)
  app.advance(2000)
  settled(app)
})

check('no actual page replacement or repeated success cannot replay heading entry', () => {
  const app = boot()
  app.send()
  app.success()
  assert.equal(app.frames.size, 0)
  app.send()
  app.replacePage()
  app.success()
  app.success()
  app.flushFrames()
  assert.equal(app.headingAnimations().length, 1)
  app.success()
  assert.equal(app.frames.size, 0)
  app.advance(2000)
  settled(app)
})

check('initial reduced motion, forced colors, data saving and background states stay static', () => {
  for (const options of [{ reduce: true }, { forcedColors: true }, { saveData: true }, { hidden: true }]) {
    const app = boot(options)
    app.send()
    app.replacePage()
    app.complete()
    app.success()
    app.flushFrames()
    assert.equal(app.animations.length, 0)
    assert.equal(app.layer(), undefined)
    settled(app)
  }
})

check('live preferences and background changes cancel both queued and active heading arrival', () => {
  const changes = [
    app => { app.reduced.matches = true; app.reduced.emit('change') },
    app => { app.contrast.matches = true; app.contrast.emit('change') },
    app => { app.connection.saveData = true; app.connection.emit('change') },
    app => { app.document.hidden = true; app.document.emit('visibilitychange') }
  ]
  for (const change of changes) {
    for (const playing of [false, true]) {
      const app = boot()
      app.send()
      app.replacePage()
      app.success()
      const stale = app.frameHistory.at(-1)
      if (playing) app.flushFrames()
      change(app)
      settled(app)
      stale.callback()
      assert.equal(app.headingAnimations().length, playing ? 1 : 0)
      settled(app)
    }
  }
})

check('starting another navigation cancels the previous heading without leaving page styles', () => {
  const app = boot()
  app.send()
  app.replacePage()
  app.success()
  app.flushFrames()
  const heading = app.headingAnimations()[0]
  assert.ok(heading.active)
  app.send()
  assert.equal(heading.cancellations, 1)
  assert.equal(heading.active, false)
  assert.equal(app.page().styles.size, 0)
  assert.equal(app.layer().hidden, false)
  app.advance(2000)
  settled(app)
})

check('pageshow and pagehide reset pending navigation, with no replay when returning', () => {
  for (const event of ['pagehide', 'pageshow']) {
    const app = boot()
    app.send()
    app.replacePage()
    app.success()
    const stale = app.frameHistory.at(-1)
    app.window.emit(event)
    settled(app)
    stale.callback()
    app.success()
    assert.equal(app.frames.size, 0)
    assert.equal(app.headingAnimations().length, 0)
    app.send()
    assert.equal(app.layer().hidden, false)
    app.advance(2000)
    settled(app)
  }
})

check('reloading the script keeps one controller, listener set and decorative layer', () => {
  const app = boot()
  const counts = [app.document, app.window, app.reduced, app.contrast, app.connection].map(target => target.count())
  app.execute()
  app.execute()
  assert.deepEqual([app.document, app.window, app.reduced, app.contrast, app.connection].map(target => target.count()), counts)
  app.send()
  const layer = app.layer()
  const count = app.animations.length
  app.execute()
  assert.equal(app.animations.length, count)
  assert.equal(app.document.body.children.filter(node => node.className === 'sakura-transition').length, 1)
  app.send()
  assert.equal(app.layer(), layer)
  app.advance(2000)
  settled(app)
})

check('missing or throwing Web Animations APIs leave navigation usable and cleanup bounded', () => {
  for (const options of [{ waapi: false }, { throwAt: 1 }, { throwAt: 3 }, { raf: false }]) {
    const app = boot(options)
    assert.doesNotThrow(() => {
      app.send()
      app.replacePage()
      app.complete()
      app.success()
      app.flushFrames()
      app.advance(2000)
    })
    assert.equal(app.page().styles.size, 0)
    settled(app)
  }
})

check('legacy media listeners stop effects and a detached incoming page is ignored', () => {
  const app = boot({ legacyMedia: true })
  app.send()
  app.reduced.matches = true
  app.reduced.emit('change')
  settled(app)
  app.reduced.matches = false
  app.reduced.emit('change')
  assert.equal(app.layer().hidden, true, 'enabling motion does not replay an old navigation')
  app.send()
  app.replacePage()
  app.success()
  const incoming = app.page()
  app.replacePage()
  app.flushFrames()
  assert.equal(app.animations.some(animation => animation.node === incoming.heading), false)
  app.advance(2000)
  settled(app)
})

check('finished animations are released instead of being canceled again during reset', () => {
  const app = boot()
  app.send()
  const animation = app.active()[0]
  animation.finish()
  app.window.emit('pagehide')
  assert.equal(animation.cancellations, 0)
  settled(app)
})

console.log(`\nSakura transition: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
