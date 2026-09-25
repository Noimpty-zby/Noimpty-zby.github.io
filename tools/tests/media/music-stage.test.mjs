import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../source/js/music-player.js', import.meta.url), 'utf8')
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
class Events {
  constructor() { this.events = new Map() }
  addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn) }
  removeEventListener(name, fn) { this.events.get(name)?.delete(fn) }
  emit(name, extra = {}) { for (const fn of [...this.events.get(name) || []]) fn({ type: name, ...extra }) }
}
class Element extends Events {
  constructor() {
    super()
    this.nodes = new Map()
    this.attributes = new Map()
    this.dataset = {}
    this.styles = new Map()
    this.style = { setProperty: (key, value) => this.styles.set(key, value) }
    this.classes = new Set()
    this.classList = {
      add: name => this.classes.add(name), remove: name => this.classes.delete(name),
      toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name)
    }
    this.animations = []
    this.animate = (frames, options) => {
      const animation = { frames, options, canceled: false, cancel() { this.canceled = true } }
      this.animations.push(animation)
      return animation
    }
  }
  querySelector(name) { return this.nodes.get(name) || null }
  setAttribute(key, value) { this.attributes.set(key, value) }
  removeAttribute(key) { this.attributes.delete(key) }
}
class Stream extends Events {
  constructor(tracks = []) { super(); this.tracks = tracks }
  getAudioTracks() { return this.tracks }
  replace(track) {
    for (const old of this.tracks) old.readyState = 'ended'
    this.tracks = []
    this.emit('removetrack')
    if (track) { this.tracks = [track]; this.emit('addtrack') }
  }
}

const boot = (options = {}) => {
  const frames = new Map(), contexts = [], sources = []
  const window = new Events(), document = new Events()
  const reduced = Object.assign(new Events(), { matches: !!options.reduce })
  const connection = Object.assign(new Events(), { saveData: !!options.saveData })
  let frameSequence = 0, time = 0, captureCalls = 0, nativeReroutes = 0, trackSequence = 0
  let resumeResolve
  const capture = new Stream()
  const player = new Element(), stage = new Element()
  const bars = Array.from({ length: 14 }, () => new Element())
  stage.querySelectorAll = selector => selector === '.noimpty-music-stage__bar' ? bars : []
  player.nodes.set('.noimpty-music-stage', stage)
  for (const selector of ['audio', '.noimpty-music-title', '.noimpty-music-artist', '.noimpty-music-status', '.noimpty-music-current', '.noimpty-music-duration', '.noimpty-music-progress', '.noimpty-music-volume input', '.noimpty-music-volume i', '[data-action="play"]', '[data-action="shuffle"]']) player.nodes.set(selector, new Element())
  player.nodes.get('[data-action="play"]').nodes.set('i', new Element())
  const audio = player.nodes.get('audio')
  Object.assign(audio, {
    paused: true, ended: false, muted: false, error: null, currentTime: 0, duration: 180, readyState: 0, playCalls: 0,
    load() { this.paused = true; this.ended = false; this.currentTime = 0; this.readyState = 0; capture.replace(); this.emit('emptied') },
    pause() { this.paused = true; this.emit('pause') },
    play() {
      this.playCalls++
      if (options.playReject) return Promise.reject(new Error('autoplay denied'))
      this.paused = false
      this.emit('play')
      if (this.readyState >= 2) this.emit('playing')
      return Promise.resolve()
    }
  })
  if (!options.noCapture) audio.captureStream = () => {
    captureCalls++
    if (options.captureThrow) throw new Error('capture unavailable')
    return capture
  }
  if (!options.noContext) window.AudioContext = class extends Events {
    constructor() {
      super()
      if (options.constructorThrow) throw new Error('audio context unavailable')
      this.state = options.suspended ? 'suspended' : 'running'
      this.resumeCalls = 0
      this.destination = { destination: true }
      contexts.push(this)
    }
    createMediaElementSource() { nativeReroutes++; throw new Error('native audio must never be rerouted') }
    createAnalyser() {
      if (options.analyserThrow) throw new Error('analyser failed')
      this.analyser = {
        frequencyBinCount: 128, reads: 0, data: new Uint8Array(128).fill(128),
        getByteFrequencyData(target) {
          if (options.readThrow) throw new Error('analysis failed')
          this.reads++
          target.set(this.data)
        }
      }
      return this.analyser
    }
    createMediaStreamSource(stream) {
      if (options.sourceThrow) throw new Error('stream source failed')
      const node = {
        track: stream.getAudioTracks()[0], disconnected: false,
        connect: target => {
          assert.notEqual(target, this.destination, 'analysis output must not duplicate the music')
          if (options.connectThrow) throw new Error('connect failed')
          node.target = target
        },
        disconnect() { this.disconnected = true }
      }
      sources.push(node)
      return node
    }
    resume() {
      this.resumeCalls++
      if (options.resumeReject) return Promise.reject(new Error('resume denied'))
      if (options.resumePending) return new Promise(resolve => { resumeResolve = () => { this.state = 'running'; this.emit('statechange'); resolve() } })
      this.state = 'running'
      this.emit('statechange')
      return Promise.resolve()
    }
    close() { this.state = 'closed'; this.emit('statechange'); return Promise.resolve() }
  }
  const saved = { index: 0, collapsed: false, shuffle: false, ...options.saved }
  const store = new Map([['noimpty-music-player-v1', JSON.stringify(saved)]])
  Object.assign(window, {
    MediaStream: Stream,
    matchMedia: () => reduced,
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
    requestAnimationFrame: fn => { const id = ++frameSequence; frames.set(id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id)
  })
  const appended = []
  Object.assign(document, { hidden: false, createElement: () => player, body: { appendChild: node => appended.push(node) } })
  const ctx = vm.createContext({ window, document, navigator: { connection }, console })
  const execute = () => vm.runInContext(source, ctx)
  execute()
  return {
    window, document, player, stage, bars, audio, reduced, connection, frames, contexts, sources, capture, appended, execute,
    get captureCalls() { return captureCalls }, get nativeReroutes() { return nativeReroutes },
    api: window.NOIMPTY_MUSIC_PLAYER,
    state: () => JSON.parse(store.get('noimpty-music-player-v1')),
    metadata() {
      audio.readyState = 4
      capture.replace({ id: `track-${++trackSequence}`, readyState: 'live', stop() { this.readyState = 'ended'; this.stopped = true } })
      audio.emit('loadedmetadata')
      if (!audio.paused) audio.emit('playing')
    },
    click(action, trusted = true) { player.emit('click', { isTrusted: trusted, target: { closest: () => ({ dataset: { action } }) } }) },
    tick(delta = 40) { time += delta; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)) },
    resolveResume() { resumeResolve?.() }
  }
}
const still = app => {
  assert.equal(app.frames.size, 0)
  assert.equal(app.player.attributes.has('data-stage-running'), false)
  app.bars.forEach(bar => assert.equal(Number(bar.styles.get('--level')), 0.08))
}
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

await check('no analysis or added autoplay before a gesture; PJAX and reinjection preserve one native audio', async () => {
  const app = boot()
  app.metadata()
  assert.equal(app.audio.playCalls, 0)
  assert.equal(app.contexts.length, 0)
  assert.equal((app.player.innerHTML.match(/class="noimpty-music-stage__bar"/g) || []).length, 14)
  assert.match(app.player.innerHTML, /给今天一点旋律 ♡/)
  assert.equal(app.player.attributes.get('aria-label'), '我喜欢的音乐播放器')
  app.click('play', false)
  await flush()
  assert.equal(app.contexts.length, 0, 'synthetic activation must not initialize capture')
  app.click('play'); app.click('play')
  await flush(); app.tick()
  assert.equal(app.contexts.length, 1)
  assert.equal(app.captureCalls, 1)
  assert.equal(app.nativeReroutes, 0)
  app.window.emit('pjax:send'); app.window.emit('pjax:complete'); app.execute()
  assert.equal(app.appended.length, 1)
  assert.equal(app.window.NOIMPTY_MUSIC_PLAYER.audio, app.audio)
  assert.equal(app.captureCalls, 1)
})

await check('bars read actual frequency data, respect volume/mute and make silence static at most 30fps', async () => {
  const app = boot()
  app.metadata(); app.click('play'); await flush(); app.tick()
  const analyser = app.contexts[0].analyser
  assert.equal(app.stage.dataset.stage, 'live')
  assert.equal(app.player.attributes.get('data-stage-running'), 'true')
  assert.equal(Number(app.bars[0].styles.get('--level')), 0.475)
  app.tick(10)
  assert.equal(analyser.reads, 1)
  analyser.data.fill(255); app.audio.volume = 1; app.tick(40)
  app.bars.forEach(bar => assert.equal(Number(bar.styles.get('--level')), 1))
  app.audio.muted = true; app.tick()
  app.bars.forEach(bar => assert.equal(Number(bar.styles.get('--level')), 0.08))
  app.audio.muted = false; analyser.data.fill(0); app.tick()
  app.bars.forEach(bar => assert.equal(Number(bar.styles.get('--level')), 0.08))
  assert.equal(app.frames.size, 1)
})

await check('pause, buffering, hidden/collapsed panels and user preferences stop frames while native music continues', async () => {
  const app = boot()
  app.metadata(); app.click('play'); await flush(); app.tick()
  for (const [disable, enable] of [
    [() => { app.document.hidden = true; app.document.emit('visibilitychange') }, () => { app.document.hidden = false; app.document.emit('visibilitychange') }],
    [() => app.click('collapse'), () => app.click('expand')],
    [() => { app.reduced.matches = true; app.reduced.emit('change') }, () => { app.reduced.matches = false; app.reduced.emit('change') }],
    [() => { app.connection.saveData = true; app.connection.emit('change') }, () => { app.connection.saveData = false; app.connection.emit('change') }],
    [() => app.window.emit('pagehide'), () => app.window.emit('pageshow')],
    [() => app.audio.emit('waiting'), () => app.audio.emit('playing')]
  ]) {
    const playCalls = app.audio.playCalls
    disable(); still(app)
    assert.equal(app.audio.paused, false)
    enable(); await flush(); app.tick()
    assert.equal(app.player.attributes.has('data-stage-running'), true)
    assert.equal(app.audio.playCalls, playCalls, 'restoring visuals must not call audio.play')
  }
  app.click('play'); still(app)
  assert.equal(app.audio.paused, true)
  app.click('play'); await flush(); app.tick()
  assert.equal(app.contexts.length, 1)
  assert.equal(app.captureCalls, 1)
})

await check('rapid track changes bind replacement capture tracks and cancel old title animations', async () => {
  const app = boot()
  app.metadata(); app.click('play'); await flush(); app.tick()
  const firstSource = app.sources[0]
  app.click('next'); app.click('next'); still(app)
  assert.equal(app.state().index, 2)
  assert.equal(firstSource.disconnected, true)
  const title = app.player.querySelector('.noimpty-music-title')
  assert.equal(title.animations.length, 2)
  assert.equal(title.animations[0].canceled, true)
  assert.equal(title.animations[1].canceled, false)
  app.metadata(); await flush(); app.tick()
  assert.equal(app.audio.paused, false)
  assert.equal(app.sources.at(-1).track, app.capture.getAudioTracks()[0])
  assert.equal(app.contexts.length, 1)
  assert.equal(app.captureCalls, 1)
  app.document.hidden = true; app.document.emit('visibilitychange')
  assert.equal(title.animations[1].canceled, true)
  app.api.next()
  assert.equal(title.animations.length, 2)
})

await check('missing or failed capture/analysis always falls back without taking native playback', async () => {
  for (const option of ['noCapture', 'noContext', 'constructorThrow', 'captureThrow', 'analyserThrow', 'sourceThrow', 'connectThrow', 'readThrow']) {
    const app = boot({ [option]: true })
    app.metadata(); app.click('play'); await flush(); app.tick()
    assert.equal(app.audio.paused, false, option)
    assert.equal(app.nativeReroutes, 0, option)
    assert.equal(app.stage.dataset.stage, 'unavailable', option)
    still(app)
    const created = app.contexts.length
    app.click('play'); app.click('play'); await flush(); app.tick()
    assert.equal(app.contexts.length, created, 'a failed analyser is not recreated on every play')
    assert.equal(app.audio.paused, false)
  }
})

await check('suspended, refused and closed contexts cannot mute or restart the native player', async () => {
  const app = boot({ suspended: true, resumePending: true })
  app.metadata(); app.click('play'); await flush()
  assert.equal(app.audio.paused, false)
  still(app)
  assert.equal(app.contexts[0].resumeCalls, 1)
  app.click('play'); app.resolveResume(); await flush(); app.tick()
  assert.equal(app.audio.paused, true, 'a late resume must not restart paused music')
  still(app)
  app.click('play'); await flush(); app.tick()
  await app.contexts[0].close(); app.tick()
  assert.equal(app.audio.paused, false)
  assert.equal(app.stage.dataset.stage, 'unavailable')
  still(app)
  const rejected = boot({ suspended: true, resumeReject: true })
  rejected.metadata(); rejected.click('play'); await flush(); rejected.tick()
  assert.equal(rejected.audio.paused, false)
  still(rejected)
})

await check('restricted preferences and rejected play never start an animation or change playback intent', async () => {
  for (const options of [{ reduce: true }, { saveData: true }, { saved: { collapsed: true } }]) {
    const app = boot(options)
    app.metadata(); app.click('play'); await flush(); app.tick()
    assert.equal(app.audio.paused, false)
    assert.equal(app.contexts.length, 0)
    app.api.next()
    assert.equal(app.player.querySelector('.noimpty-music-title').animations.length, 0)
    still(app)
  }
  const rejected = boot({ playReject: true })
  rejected.metadata(); rejected.click('play'); await flush(); rejected.tick()
  assert.equal(rejected.audio.paused, true)
  assert.equal(rejected.state().playing, false)
  still(rejected)
})

await check('play returns true only for current success, false for rejection and superseded requests', async () => {
  const app = boot()
  app.metadata()
  assert.equal(await app.api.play(), true)
  const rejected = boot({ playReject: true })
  rejected.metadata()
  assert.equal(await rejected.api.play(), false)
  assert.match(rejected.player.querySelector('.noimpty-music-status').textContent, /点击播放/)
  for (const replace of ['pause', 'next']) {
    const stale = boot()
    stale.metadata()
    let resolve
    stale.audio.play = () => new Promise(done => { resolve = done })
    const playing = stale.api.play()
    stale.api[replace]()
    resolve()
    assert.equal(await playing, false, replace)
    assert.equal(stale.state().playing, replace === 'next', 'stale completion preserves the newer playback intent')
  }
})



await check('failed analysis releases captured tracks without pausing the native music', async () => {
  const app = boot({ readThrow: true })
  app.metadata(); app.click('play'); await flush()
  const track = app.capture.getAudioTracks()[0]
  app.tick()
  assert.equal(track.stopped, true)
  assert.equal(app.contexts[0].state, 'closed')
  assert.equal(app.audio.paused, false)
})

console.log(`\n${passed} music stage cases passed`)
