import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/mao-play.js', 'utf8')
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function boot ({ quiet = false, reduced = false, raw = null, storageFail = false, captureDelay = false } = {}) {
  let now = 1_800_000_000_000, timerId = 0, document, random = .5, occupied = false, captures = 0, resolveCapture
  const timers = new Map(), store = new Map(raw ? [['mao-play-v1', raw]] : [])
  const faces = [], lines = [], revoked = [], draws = [], objects = [], focus = []
  const events = target => {
    target.listeners = new Map()
    target.addEventListener = (type, fn) => { const items = target.listeners.get(type) || new Set(); items.add(fn); target.listeners.set(type, items) }
    target.removeEventListener = (type, fn) => target.listeners.get(type)?.delete(fn)
    target.fire = (type, input = {}) => {
      const event = { target, type, preventDefault () { this.prevented = true }, stopPropagation () {}, ...input }
      for (const fn of [...target.listeners.get(type) || []]) fn(event)
      return event
    }
    target.count = () => [...target.listeners.values()].reduce((sum, set) => sum + set.size, 0)
    return target
  }
  const make = tag => {
    const node = events({ tagName: tag.toUpperCase(), className: '', children: [], parentElement: null, dataset: {}, attrs: {}, hidden: false, disabled: false,
      textContent: '', style: { setProperty (name, value) { this[name] = value } },
      setAttribute (name, value) { this.attrs[name] = String(value) },
      appendChild (child) { child.parentElement = this; this.children.push(child); return child },
      removeChild (child) { this.children = this.children.filter(item => item !== child); child.parentElement = null },
      remove () { this.parentElement?.removeChild(this) },
      contains (child) { return child === this || this.children.some(item => item.contains(child)) },
      focus () { document.activeElement = this },
      setPointerCapture () {}, releasePointerCapture () {},
      getBoundingClientRect () { return this.className === 'mao-play-game' ? { left: 400, top: 100, width: 300, height: 170 } : { left: 400, top: 400, width: 300, height: 400 } }
    })
    Object.defineProperty(node, 'firstChild', { get: () => node.children[0] || null })
    if (tag === 'canvas') {
      node.getContext = () => ({ fillRect () {}, fillText () {}, beginPath () {}, ellipse () {}, arc () {}, fill () {}, drawImage: (...args) => draws.push(args) })
      node.toBlob = fn => fn({ type: 'image/png' })
    }
    return node
  }
  const body = make('body'), stage = make('div'), canvas = make('canvas')
  body.appendChild(stage); stage.appendChild(canvas)
  document = events({ body, hidden: false, activeElement: canvas, createElement: make, contains: node => body.contains(node) })
  const media = { matches: reduced }
  const window = events({ innerWidth: 1000, innerHeight: 900, matchMedia: () => media, navigator: {} })
  const settings = { quiet, power: 'auto' }
  const setTimer = (fn, ms, interval = false) => { const id = ++timerId; timers.set(id, { fn, at: now + ms, ms, interval }); return id }
  const snapshot = { width: 380, height: 480 }
  const localStorage = { getItem: key => store.get(key) || null, setItem: (key, value) => { if (storageFail) throw new Error('quota'); store.set(key, value) } }
  const sandbox = { window, document, localStorage, Math: Object.assign(Object.create(Math), { random: () => random }), console,
    URL: { createObjectURL: blob => { objects.push(blob); return 'blob:photo-' + objects.length }, revokeObjectURL: value => revoked.push(value) },
    Date: class extends Date { constructor (...args) { super(...(args.length ? args : [now])) } static now () { return now } },
    setTimeout: (fn, ms) => setTimer(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => setTimer(fn, ms, true), clearInterval: id => timers.delete(id),
    fetch: () => { throw new Error('network forbidden') }
  }
  vm.runInNewContext(source, sandbox)
  let resets = 0
  const play = window.MAO_PLAY.create({ stage, canvas, getSettings: () => settings, isOccupied: () => occupied,
    face: value => faces.push(value), say: value => lines.push(value), focus: (...point) => focus.push(point),
    reset: () => resets++, getBody: () => ({ left: 420, top: 420, width: 240, height: 370 }),
    capture: () => { captures++; return captureDelay ? new Promise(resolve => { resolveCapture = resolve }) : snapshot }
  })
  const walk = node => [node, ...node.children.flatMap(walk)]
  const advance = async ms => {
    const until = now + ms
    for (let count = 0; count < 10000; count++) {
      const next = [...timers.entries()].filter(([, value]) => value.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, value] = next; now = value.at
      if (value.interval) value.at += value.ms
      else timers.delete(id)
      value.fn(); await flush()
    }
    now = until; await flush()
  }
  return { play, stage, canvas, window, document, settings, media, timers, store, faces, lines, draws, objects, revoked, focus, snapshot,
    all: () => walk(body), find: name => walk(body).find(node => node.tagName === 'BUTTON' && node.dataset.play === name),
    byClass: name => walk(body).find(node => node.className.split(' ').includes(name)),
    click: name => walk(body).find(node => node.tagName === 'BUTTON' && node.dataset.play === name).fire('click'), advance,
    busy: value => { occupied = value; play.refresh() }, random: value => { random = value },
    captures: () => captures, resolveCapture: () => resolveCapture(snapshot), resets: () => resets }
}
let passed = 0
async function test (label, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + label) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + label, error) }
}

await test('explicit feeds animate, preserve recent count, and reserve the third snack', async () => {
  const app = boot(); assert.equal(app.play.state(), null)
  for (const action of ['feed', 'fish', 'feed']) { app.click(action); await app.advance(900) }
  assert.equal(app.play.state().step, 1)
  assert.equal(JSON.parse(app.store.get('mao-play-v1')).feeds, 3)
  assert.equal(app.lines.at(-1)[0], '这个留到下午吃。')
  assert.match(app.byClass('mao-play-effect').textContent, /🍪/)
  await app.advance(2600); assert.equal(app.play.state(), null)
  await app.advance(120001); app.click('feed'); await app.advance(900)
  assert.equal(JSON.parse(app.store.get('mao-play-v1')).feeds, 1)
})
await test('dragging food requires an actual drop on Mao and suppresses the synthetic click', async () => {
  const app = boot(), snack = app.find('feed')
  snack.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 })
  snack.fire('pointermove', { pointerId: 1, clientX: 500, clientY: 450 })
  snack.fire('pointerup', { pointerId: 1, clientX: 500, clientY: 450 })
  snack.fire('click'); await app.advance(900)
  assert.equal(JSON.parse(app.store.get('mao-play-v1')).feeds, 1)
  snack.fire('pointerdown', { pointerId: 2, clientX: 100, clientY: 100, button: 0 })
  snack.fire('pointermove', { pointerId: 2, clientX: 10, clientY: 10 })
  snack.fire('pointerup', { pointerId: 2, clientX: 10, clientY: 10 }); snack.fire('click')
  assert.equal(JSON.parse(app.store.get('mao-play-v1')).feeds, 1)
})
await test('head rubbing needs direction changes, progresses eye closure, then recovers', async () => {
  const app = boot()
  for (const x of [470, 490, 470, 490, 470]) app.canvas.fire('pointermove', { clientX: x, clientY: 450, buttons: 0 })
  assert.equal(app.play.state().kind, 'rub')
  await app.advance(600)
  const values = {}; app.play.frame((id, value) => { values[id] = value })
  assert.ok(values.ParamEyeLOpen < 1 && values.ParamEyeLOpen > 0)
  assert.ok(values.ParamCheek > 0)
  await app.advance(400)
  assert.equal(app.play.state().kind, 'hat')
  assert.equal(app.lines.at(-1)[0], '……摸完啦？')
  await app.advance(2200); assert.equal(app.play.state(), null)
})
await test('keyboard/touch rub action has the same complete progression', async () => {
  const app = boot(); app.click('rub'); await app.advance(900)
  assert.equal(app.play.state().step, 1); assert.match(app.byClass('mao-play-effect').textContent, /✿/)
  await app.advance(1700); assert.equal(app.play.state().kind, 'hat')
})
await test('petal lands as an accessible prop, removal smiles, and missed catch uses another ending', async () => {
  const app = boot(); app.click('petal'); await app.advance(1300)
  assert.equal(app.find('prop').hidden, false)
  assert.match(app.find('prop').attrs['aria-label'], /拿掉/)
  app.click('prop'); assert.equal(app.find('prop').hidden, true); assert.equal(app.faces.at(-1), '星星眼')
  assert.match(app.lines.at(-1)[0], /谢谢/)
  await app.advance(2100); app.random(.1); app.click('petal'); await app.advance(1300)
  assert.equal(app.play.state().kind, 'miss'); assert.match(app.lines.at(-1)[0], /差一点/)
})
await test('real sakura animation events respect quiet, power, cooldown and busy scenes', async () => {
  const app = boot({ quiet: true }); app.random(.19)
  const event = { target: { classList: { contains: value => value === 'sakura-petal' } } }
  app.document.fire('animationiteration', event); assert.equal(app.play.state(), null)
  app.settings.quiet = false; app.document.fire('animationiteration', event); assert.equal(app.play.state().kind, 'petal')
  app.play.suspend(true); app.play.suspend(false)
  app.document.fire('animationiteration', event); assert.equal(app.play.state(), null)
  await app.advance(91000); app.media.matches = true; app.document.fire('animationiteration', event)
  assert.equal(app.play.state(), null)
})
await test('drag reactions settle on drop and cancellation has no leftover scene', async () => {
  const app = boot(); app.play.drag('start'); assert.equal(app.play.state().kind, 'lift')
  await app.advance(200)
  const values = {}; app.play.frame((id, value) => { values[id] = value }); assert.notEqual(values.ParamBodyAngleZ, 0)
  app.play.drag('end'); assert.equal(app.play.state().kind, 'hat'); assert.match(app.lines.at(-1)[0], /搬家/)
  await app.advance(2300); assert.equal(app.play.state(), null)
  app.play.drag('start'); app.play.drag('cancel'); assert.equal(app.play.state(), null)
})
await test('sleep begins after idle, closes eyes gradually, and a tap wakes without old timers returning', async () => {
  const app = boot(); await app.advance(135000); assert.equal(app.play.state().kind, 'sleep')
  await app.advance(2400); assert.equal(app.play.state().step, 1)
  const values = {}; app.play.frame((id, value) => { values[id] = value }); assert.equal(values.ParamEyeLOpen, 0)
  assert.equal(app.play.tap(), true); assert.equal(app.play.state().kind, 'wake')
  assert.match(app.lines.at(-1)[0], /我有在看/)
  await app.advance(3500); assert.equal(app.play.state(), null)
})
await test('quiet/reduced-motion modes suppress automatic events but preserve explicit play', async () => {
  for (const args of [{ quiet: true }, { reduced: true }]) {
    const app = boot(args); await app.advance(600000); assert.equal(app.play.state(), null)
    app.click('sleep'); assert.equal(app.play.state().kind, 'sleep')
    app.click('prop'); assert.equal(app.play.state().kind, 'wake')
  }
})
await test('feather supports arrows and Enter activation; ends after fifteen seconds', async () => {
  const app = boot(); app.click('tease'); assert.equal(app.byClass('mao-play-game').hidden, false)
  const feather = app.find('feather')
  assert.equal(app.document.activeElement, feather)
  assert.equal(feather.fire('keydown', { key: 'ArrowRight' }).prevented, true)
  assert.equal(feather.style.left, '60%')
  feather.fire('click'); assert.match(app.byClass('mao-play-notice').textContent, /抓到了/)
  await app.advance(15000); assert.equal(app.byClass('mao-play-game').hidden, true)
  assert.equal(app.play.state().kind, 'tease-end'); assert.match(app.lines.at(-1)[0], /1 次/)
})
await test('notes save only on explicit collection, sanitize stored values, and survive recreation', async () => {
  const app = boot({ raw: JSON.stringify({ notes: [{ kind: 0, date: '2026-09-25', text: '<script>' }, { kind: 99, date: '2026-09-25' }] }) })
  app.click('note'); assert.equal(app.byClass('mao-play-paper').hidden, false)
  assert.equal(app.find('save-note').disabled, false)
  app.click('save-note'); app.click('save-note')
  const data = JSON.parse(app.store.get('mao-play-v1')); assert.equal(data.notes.length, 2); assert.equal(data.notes[0].text, undefined)
  const other = boot({ raw: JSON.stringify(data) }); other.click('album')
  assert.equal(other.all().filter(node => node.className === 'mao-play-note-card').length, 2)
  assert.ok(other.all().every(node => !node.innerHTML))
})
await test('note collection stays bounded and storage failure never reports persistent success', async () => {
  const app = boot({ raw: JSON.stringify({ notes: Array.from({ length: 40 }, () => ({ kind: 1, date: '2026-09-25' })) }), storageFail: true })
  app.click('note'); app.click('save-note')
  assert.match(app.byClass('mao-play-notice').textContent, /未能保存/)
  app.click('album'); assert.equal(app.all().filter(node => node.className === 'mao-play-note-card').length, 24)
})
await test('camera uses actual renderer snapshot, exports one PNG, focuses download and revokes replaced URLs', async () => {
  const app = boot(); app.click('camera'); await app.advance(2999); assert.equal(app.captures(), 0)
  await app.advance(1); assert.equal(app.captures(), 1); assert.equal(app.draws[0][0], app.snapshot)
  assert.equal(app.objects[0].type, 'image/png')
  const link = app.all().find(node => node.tagName === 'A'); assert.match(link.download, /^mao-\d{4}-\d{2}-\d{2}\.png$/)
  assert.equal(app.document.activeElement, link)
  app.click('camera'); await app.advance(3000); assert.deepEqual(app.revoked, ['blob:photo-1'])
  app.play.destroy(); assert.deepEqual(app.revoked, ['blob:photo-1', 'blob:photo-2'])
})
await test('late camera result cannot recreate UI after hide, navigation, or a new activity', async () => {
  const app = boot({ captureDelay: true }); app.click('camera'); await app.advance(3000)
  app.play.destroy(); app.resolveCapture(); await flush()
  assert.equal(app.objects.length, 0); assert.equal(app.byClass('mao-play-panel'), undefined)
  const next = boot({ captureDelay: true }); next.click('camera'); await next.advance(3000)
  next.click('feed'); next.resolveCapture(); await flush(); assert.equal(next.objects.length, 0)
  assert.equal(next.play.state().kind, 'feed')
})
await test('chat interrupts work, background suspends all timers, PJAX clears active interaction', async () => {
  const app = boot(); app.click('camera'); app.busy(true); await app.advance(3000)
  assert.equal(app.captures(), 0); assert.equal(app.play.state(), null)
  app.click('feed'); assert.equal(app.play.state(), null)
  app.busy(false); app.play.suspend(true); assert.equal(app.timers.size, 0)
  app.play.suspend(false); assert.equal(app.timers.size, 1)
  app.click('rub'); app.document.fire('pjax:send'); assert.equal(app.play.state(), null)
  assert.equal(app.byClass('mao-play-panel').hidden, true)
})
await test('dialog close restores focus, destroy removes global listeners and every timer', () => {
  const app = boot(); const beforeDoc = app.document.count(), beforeWin = app.window.count()
  app.play.open(); assert.equal(app.byClass('mao-play-panel').hidden, false)
  app.document.fire('keydown', { key: 'Escape' }); assert.equal(app.document.activeElement, app.canvas)
  app.play.open(); app.click('rub'); app.play.destroy()
  assert.equal(app.timers.size, 0); assert.ok(beforeDoc > 0 && beforeWin > 0)
  assert.equal(app.document.count(), 0); assert.equal(app.window.count(), 0)
})
await test('every direct model parameter exists in the official bundled motion assets', () => {
  const ids = new Set(readdirSync('source/live2d/mao/motions').flatMap(file => JSON.parse(readFileSync('source/live2d/mao/motions/' + file, 'utf8')).Curves.map(curve => curve.Id)))
  for (const [, id] of source.matchAll(/set\('(Param[^']+)'/g)) assert.ok(ids.has(id), id)
})
console.log(`\n${passed} Mao 互动回归通过`)
