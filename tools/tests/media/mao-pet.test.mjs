/* 看板娘。
 *
 * 这一套主要盯三件会安静出事的事：
 *
 *   1. **第三方请求。** 这站上着锁，不该有任何外部请求 —— 一个 CDN 请求等于把
 *      「谁在什么时候打开了这个博客」告诉别人。三份运行时都自己存了一份，
 *      这里把「存下来的这几份里没有会被 fetch 的地址」钉死。
 *   2. **按需加载。** 三份运行时 800 KB + 模型 1.5 MB。关着的时候一个字节都不该取；
 *      开了再关再开也不该重复下载。这事写错了页面照样能用，只是每页白扔两兆三。
 *   3. **收起来要收干净。** WebGL 上下文、逐帧渲染、两个全局监听、三个定时器 ——
 *      漏掉任何一个，「关掉」就只是看不见而已，机器照样在转。
 *
 * 另外钉住一批「改了模型或配置才会发现」的对应关系：动作分组名、嘴型参数、
 * 模型引用到的每个文件在不在。这些错了页面不报错，只是她不动、不说话或者开天窗。
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const base = fileURLToPath(new URL('../../../', import.meta.url))
const petSource = readFileSync(path.join(base, 'source/js/mao-pet.js'), 'utf8')
const model = JSON.parse(readFileSync(path.join(base, 'source/live2d/mao/mao_pro.model3.json'), 'utf8'))

const CLOCK0 = 1_700_000_000_000
/* 注释里可能带花括号，会把下面那个粗糙的分块正则带偏 —— 先剥掉 */
const cssOf = f => readFileSync(path.join(base, 'source/css/', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// 取出选择器正好是这一个 id 的所有规则块（#a.b、#a canvas 这种不算）
const blocksFor = (css, id) => {
  const out = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // m[1] 会把上一条规则到这条之间的空白/@media 头一起吃进来，取最后一段才是选择器
    const sel = m[1].split(',').map(x => x.trim().split('\n').pop().trim()).filter(Boolean)
    if (sel.includes(id)) out.push(m[2])
  }
  return out
}

let passed = 0
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name + '\n', error) }
}

// ────────────────── 一个够跑这段脚本的浏览器 ──────────────────

// 原全身几何用例显式关闭自动紧凑；默认移动端行为另用 settingsSaved: null 验证。
const boot = ({ saved = null, innerWidth = 1440, innerHeight = 900, failAt = null, dpr = 2, lastSeen = null,
  delayModel = false, sharedTextures = false, settingsSaved = { autoCompact: false }, reduced = false, saveData = false } = {}) => {
  const doc = new Map()          // 事件类型 → 回调
  const win = new Map()
  const store = new Map(saved === null ? [] : [['nanaly-pet-visible', saved]])
  if (lastSeen !== null) store.set('mao-last-seen', String(lastSeen))
  if (settingsSaved !== null) store.set('mao-settings-v1', typeof settingsSaved === 'string' ? settingsSaved : JSON.stringify(settingsSaved))
  const controlCalls = { refresh: 0, showActions: 0, close: 0 }
  let controlOptions = null
  const motionListeners = new Map(), connectionListeners = new Map()
  const motionQuery = { matches: reduced, addEventListener: (t, fn) => motionListeners.set(t, fn), removeEventListener: t => motionListeners.delete(t) }
  const connection = { saveData, addEventListener: (t, fn) => connectionListeners.set(t, fn), removeEventListener: t => connectionListeners.delete(t) }
  const attached = new Set()
  const scripts = []
  const timers = { interval: [], timeout: [] }
  const created = { apps: [], models: [] }
  let pending = null, releaseModel = null
  const modelReleases = [], textures = []
  const makeTexture = () => { const texture = { destroyCalls: [], destroy (base) { this.destroyCalls.push(base) } }; textures.push(texture); return texture }
  const sharedTexture = sharedTextures ? makeTexture() : null
  /* 双击判定按 Date.now() 的间隔算，真表没法测「两下隔了 400ms」这种情况 ——
   * 给沙箱一块自己能拨的表，测试想隔多久就隔多久。 */
  let clock = CLOCK0

  const make = tag => ({
    tagName: tag.toUpperCase(), dataset: {}, innerHTML: '', textContent: '',
    parentElement: null, attrs: new Map(), handlers: new Map(),
    // 真元素的 style 上有 setProperty，长按那圈的时长是这么交给 CSS 的
    style: { cssText: '', props: new Map(), setProperty (k, v) { this.props.set(k, v) }, getPropertyValue (k) { return this.props.get(k) || '' } },
    setAttribute(k, v) { this.attrs.set(k, v) },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null },
    addEventListener(t, fn) { this.handlers.set(t, fn) },
    removeEventListener(t) { this.handlers.delete(t) },
    fire(t, e) { const fn = this.handlers.get(t); return fn && fn(e) },
    appendChild(c) { c.parentElement = this; attached.add(c); return c },
    remove() {
      const removeChildren = parent => { for (const child of [...attached]) if (child.parentElement === parent) { removeChildren(child); attached.delete(child) } }
      removeChildren(this); attached.delete(this)
    },
    querySelector(sel) { return [...attached].find(n => n.parentElement === this && n.tagName === sel.toUpperCase()) || null },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 380, x: 0, y: 0 })
  })

  const head = make('head')
  head.appendChild = node => { scripts.push(node); return node }
  const body = make('body')

  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v)
  }

  const document = {
    readyState: 'complete', head, body,
    getElementById: id => [...attached].find(n => n.id === id) || null,
    querySelectorAll: () => [],
    createElement: make,
    contains: n => attached.has(n),
    addEventListener: (t, fn) => doc.set(t, fn),
    removeEventListener: t => doc.delete(t)
  }

  const window_ = {
    innerWidth, innerHeight, devicePixelRatio: dpr, localStorage,
    matchMedia: () => motionQuery, navigator: { connection },
    MAO_CONTROLS: { create: options => {
      controlOptions = options
      return { refresh: () => { controlCalls.refresh++ }, showActions: () => { controlCalls.showActions++ }, close: () => { controlCalls.close++ } }
    } },
    addEventListener: (t, fn) => win.set(t, fn),
    removeEventListener: t => win.delete(t)
  }

  const sandbox = {
    window: window_, document, localStorage,
    console: { warn: () => {} },
    Math, JSON, Object, Number, String, Set, Map, Promise, Error, Array, Boolean,
    /* 真 Date，但「现在」由上面那块表说了算：new Date() 不给参数就取 clock。
     * 只给 { now } 是不够的 —— 她按时段换话时要 new Date().getHours()。 */
    Date: class extends Date {
      constructor (...args) { super(...(args.length ? args : [clock])) }
      static now () { return clock }
    },
    requestAnimationFrame: fn => { fn(); return 1 },
    setInterval: (fn, ms) => { timers.interval.push({ fn, ms }); return timers.interval.length },
    clearInterval: id => { if (id) timers.interval[id - 1] = null },
    setTimeout: (fn, ms) => { timers.timeout.push({ fn, ms }); return timers.timeout.length },
    clearTimeout: id => { if (id) timers.timeout[id - 1] = null }
  }
  sandbox.globalThis = sandbox
  sandbox.fetch = undefined
  vm.runInNewContext(petSource, sandbox)

  const stage = () => [...attached].find(n => n.id === 'mao-stage')
  return {
    win: window_, sandbox, document, scripts, timers, created, stage,
    docListeners: doc, winListeners: win, motionQuery, motionListeners, connection, connectionListeners, controlCalls,
    controlOptions: () => controlOptions,
    storedSettings: () => JSON.parse(store.get('mao-settings-v1') || 'null'),
    fireTimeout: ms => { const i = timers.timeout.findIndex(t => t && t.ms === ms); assert.ok(i >= 0, 'missing timeout ' + ms); const item = timers.timeout[i]; timers.timeout[i] = null; item.fn() },
    advance: ms => { clock += ms },
    clockNow: () => clock,
    releaseModel: index => (index === undefined ? releaseModel : modelReleases[index])?.(),
    textures,
    stored: () => (store.has('nanaly-pet-visible') ? store.get('nanaly-pet-visible') : null),
    storedVoice: () => (store.has('mao-voice') ? store.get('mao-voice') : null),
    button: () => document.getElementById('mao-toggle'),
    bubble: () => [...attached].find(n => n.id === 'mao-bubble'),
    detachStage: () => { const s = stage(); if (s) attached.delete(s) },
    // 三份运行时只在脚本「跑完」的那一刻才出现，提前塞等于绕过「到底插没插 script」
    armLibs: () => {
      const params = new Map()
      pending = () => {
        window_.Live2DCubismCore = {}
        window_.PIXI = {
          Ticker: { shared: { maxFPS: 120 } },
          Application: class {
            constructor (opts) { this.opts = opts; this.stage = { addChild: () => {} }; this.resizes = []; this.renderer = { resize: (...size) => this.resizes.push(size) }; this.ticker = { maxFPS: 0 }; this.starts = this.stops = 0; created.apps.push(this) }
            start () { this.starts++ }
            stop () { this.stops++ }
            destroy (...a) { this.destroyed = a }
          },
          live2d: {
            Live2DModel: {
              from: async (path_, opts) => {
                if (failAt === 'model') throw new Error('模型没取到')
                const m = {
                  path: path_, opts, textures: [sharedTexture || makeTexture()], scale: { set: v => { m.scaleValue = v } },
                  anchor: { set: () => {} }, position: { set: (x, y) => { m.pos = [x, y] } },
                  internalModel: {
                    originalHeight: 2400,
                    coreModel: { setParameterValueById: (id, v) => params.set(id, v) },
                    // 每帧钩子。测试要能拿到它挂在哪个事件上、以及手动跑一帧
                    hooks: new Map(),
                    on (t, fn) { this.hooks.set(t, fn); return this }
                  },
                  on: (t, fn) => m.handlers.set(t, fn), handlers: new Map(),
                  // 包围盒：画布 300×380 里她占中间那一块
                  getBounds: () => ({ x: 50, y: 20, width: 220, height: 360 }),
                  eventMode: 'auto',
                  motion: g => { m.played = g; m.motionCount = (m.motionCount || 0) + 1 },
                  focus: (x, y) => { m.focusAt = [x, y] },
                  expression: id => { m.face = id; (m.faces = m.faces || []).push(id) },
                  destroy: options => { m.destroyOptions = options; m.destroyed = true; m.destroyCount = (m.destroyCount || 0) + 1 }
                }
                created.models.push(m)
                if (delayModel) await new Promise(resolve => { releaseModel = resolve; modelReleases.push(resolve) })
                return m
              }
            }
          }
        }
      }
      return { params, created }
    },
    resolveScripts: () => {
      for (const s of scripts) {
        if (!s.onload) continue
        const fn = s.onload; s.onload = null
        if (failAt === 'script' && s.src.includes('pixi')) { s.onerror(); continue }
        if (s.src === '/lib/l2d/live2d-display.min.js' && pending) { pending(); pending = null }
        fn()
      }
    }
  }
}

// 按下开关 → 三份脚本依次到位 → 她出现
const tick = () => new Promise(resolve => setImmediate(resolve))
const turnOn = async env => {
  const handles = env.armLibs()
  const pressed = env.button().fire('click')
  // 三个 script 是一个接一个 await 出来的，每一个都要等上一轮微任务跑完才会出现
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  await pressed
  return handles
}

const readLib = name => readFileSync(path.join(base, 'source/lib/l2d', name), 'utf8')

console.log('\n看板娘 · 不发第三方请求')

await test('★★ 自存的三份运行时里没有会被 fetch 的外部地址', () => {
  /* 白名单只放「不会被请求」的：命名空间、授权链接、版权注释里的网址。
   * 多出来的一律当成漏网 —— 判断它安不安全是人的事，不是这条断言该猜的。 */
  const allow = [
    'http://www.w3.org/', 'https://www.live2d.com/eula/', 'https://live2d.github.io/',
    'https://github.com/', 'http://pixijs.com', 'https://pixijs.com',
    'http://www.opensource.org/licenses/', 'https://mths.be/punycode', 'http://localhost'
  ]
  for (const f of ['cubismcore.min.js', 'pixi.min.js', 'live2d-display.min.js']) {
    const urls = [...new Set(readLib(f).match(/https?:\/\/[a-zA-Z0-9._~/-]+/g) || [])]
      .filter(u => !allow.some(ok => u.startsWith(ok)))
    assert.deepEqual(urls, [], `${f} 里有没见过的外部地址：\n   ${urls.join('\n   ')}`)
  }
})

await test('★★ 三份运行时和授权文本都在，且是自己这一份而不是占位', () => {
  for (const [f, min] of [['cubismcore.min.js', 150e3], ['pixi.min.js', 300e3], ['live2d-display.min.js', 100e3]])
    assert.ok(readLib(f).length > min, `source/lib/l2d/${f} 不像是完整的那一份`)
  assert.ok(readLib('cubismcore.min.js').includes('Redistributable Code'),
    'Cubism Core 的授权声明不见了 —— 它就是靠这行说明自己可以随应用分发的')
  assert.ok(existsSync(path.join(base, 'source/lib/l2d/LICENSE-live2d-display')))
  assert.ok(existsSync(path.join(base, 'source/live2d/mao/ReadMe.txt')), 'Mao 的授权说明不在了')
})

console.log('\n看板娘 · 按需加载')

await test('★★ 没开的时候一个字节都不取', () => {
  const env = boot()
  assert.equal(env.scripts.length, 0, '默认关着，不该去拉那 800 KB')
  assert.ok(env.button(), '但开关得先摆在那儿')
  assert.equal(env.button().getAttribute('aria-pressed'), 'false')
})

await test('★★ 开了才取，三份的顺序不能乱', async () => {
  const env = boot()
  await turnOn(env)
  assert.deepEqual(env.scripts.map(s => s.src), [
    '/lib/l2d/cubismcore.min.js', '/lib/l2d/pixi.min.js', '/lib/l2d/live2d-display.min.js'
  ], 'display 加载时就要看得见 PIXI 和 Live2DCubismCore，顺序错了它当场就废')
})

await test('★★ 上次开过就自动开，上次关过就不开', async () => {
  const on = boot({ saved: 'true' })
  on.armLibs(); on.resolveScripts(); await tick()
  assert.ok(on.scripts.length > 0, '记着开过，进页面就该去取')
  assert.equal(boot({ saved: 'false' }).scripts.length, 0)
})

await test('★★ 关掉再开，不重新下载一遍', async () => {
  const env = boot()
  await turnOn(env)
  const first = env.scripts.length
  await env.button().fire('click')
  await env.button().fire('click')
  assert.equal(env.scripts.length, first, '三份都在 window 上了，不该再插一遍 script')
})

await test('★ 存坏了的偏好当成没存过，不能把脚本整个掀翻', () => {
  const env = boot({ saved: '{不是 json' })
  assert.ok(env.button())
  assert.equal(env.scripts.length, 0)
})

console.log('\n看板娘 · 开关的状态')

await test('★★ 开关按下会把偏好记下来', async () => {
  const env = boot()
  await turnOn(env)
  assert.equal(env.stored(), 'true')
  await env.button().fire('click')
  assert.equal(env.stored(), 'false')
})

await test('★★ 加载中途按第二下取消显示，迟到的运行时不会复活她', async () => {
  const env = boot()
  const { created } = env.armLibs()
  const first = env.button().fire('click')
  env.button().fire('click')
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  await first
  assert.equal(created.models.length, 0)
  assert.equal(env.win.MAO_PET.visible(), false)
  assert.equal(env.stored(), 'false')
})

await test('★★ 脚本取不到时开关要退回「关」，不能卡在「开」', async () => {
  const env = boot({ failAt: 'script' })
  await turnOn(env)
  assert.equal(env.button().getAttribute('aria-pressed'), 'false', '亮着开却什么都没有，最难查')
  assert.equal(env.win.MAO_PET.visible(), false)
})

await test('★★ 模型加载失败要把已经建好的画布收掉，不留一块空的', async () => {
  const env = boot({ failAt: 'model' })
  await turnOn(env)
  assert.equal(env.win.MAO_PET.visible(), false)
  assert.equal(env.stage(), undefined, '画布建了一半就该拆掉，不能把空壳留在页面上')
  assert.equal(env.button().getAttribute('aria-pressed'), 'false')
})

console.log('\n看板娘 · 收起来要收干净')

await test('★★ 收起时 WebGL、模型、DOM、两个全局监听、三个定时器都要放掉', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  assert.ok(env.docListeners.has('pointermove'), '视线跟随得先挂上，这条对照才算数')
  assert.ok(env.winListeners.has('resize'))

  await env.button().fire('click')
  assert.ok(created.models[0].destroyed, '模型没 destroy')
  assert.ok(created.apps[0].destroyed, 'PixiJS 没 destroy —— WebGL 上下文和逐帧渲染都还留着')
  assert.equal(env.stage(), undefined, '她那块 DOM 还挂在页面上')
  assert.ok(!env.docListeners.has('pointermove'), 'pointermove 没摘，关掉之后还在跟着鼠标算')
  assert.ok(!env.winListeners.has('resize'), 'resize 没摘')
  assert.ok(env.timers.interval.every(t => t === null), '还有 interval 在跑')
  assert.ok(env.timers.timeout.every(t => t === null), '还有 timeout 在跑')
})

console.log('\n看板娘 · 说话')

await test('★★ 逐字上屏，嘴跟着开合，说完要闭上', async () => {
  const env = boot()
  const { params } = await turnOn(env)
  const bubble = env.bubble()
  env.win.MAO_PET.say('喵')
  assert.equal(bubble.dataset.on, '1', '气泡该露出来')
  const typing = env.timers.interval.filter(Boolean).pop()
  typing.fn(); assert.equal(bubble.textContent, '喵')
  const mouth = env.win.MAO_PET.config().mouthParam
  assert.equal(params.get(mouth), 0, '最后一个字落地时嘴该闭上')

  env.win.MAO_PET.say('喵喵')
  env.timers.interval.filter(Boolean).pop().fn()
  assert.ok(params.get(mouth) > 0, '还在说的时候嘴得是张开的')

  env.timers.timeout.filter(Boolean).pop().fn()
  assert.equal(bubble.dataset.on, undefined, '说完气泡要收回去')
  assert.equal(params.get(mouth), 0, '收回去之后嘴必须闭上，不能停在半张')
})

await test('★★ 一句还没说完又来一句，不能两个打字器一起往上写', async () => {
  const env = boot()
  await turnOn(env)
  env.win.MAO_PET.say('前一句')
  const before = env.timers.interval.filter(Boolean).length
  env.win.MAO_PET.say('后一句')
  assert.equal(env.timers.interval.filter(Boolean).length, before,
    '旧的打字器没停掉，两句会交替往同一个气泡里写')
  assert.equal(env.bubble().textContent, '', '新的一句该从头开始打')
})

await test('★ 按钮图标里用到的 class，css 里得真的有', () => {
  /* 帽带和星星是填充的，靠 .solid 这个 class。哪天改了其中一边的名字，
   * 它们会静静地变成描边 —— 不报错，只是难看，而且没人会发现。 */
  const env = boot()
  const html = env.button().innerHTML
  const used = [...new Set([...html.matchAll(/class="([^"]+)"/g)].map(m => m[1]))]
  assert.ok(used.length, '图标里一个 class 都没用到，这条对照不算数')
  const css = readFileSync(path.join(base, 'source/css/mao-pet.css'), 'utf8')
  for (const cls of used)
    assert.ok(css.includes('.' + cls), `图标用了 .${cls}，但 mao-pet.css 里没这个选择器`)
})

console.log('\n看板娘 · 戳她一下')

await test('★★ 得把模型设成可交互，否则戳了没反应', async () => {
  /* 库只在 autoHitTest / autoFocus 至少开一个时才把模型设成可交互，
   * 而这两个这边都关了。不自己补上这一行，pointertap 永远不会来。 */
  const env = boot()
  const { created } = await turnOn(env)
  assert.equal(created.models[0].eventMode, 'static')
})

await test('★★ 戳一下：随机播一段动作，再说一句', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  const m = created.models[0]
  env.bubble().textContent = ''
  m.handlers.get('pointertap')()
  assert.equal(m.played, env.win.MAO_PET.config().tapGroup, '没播动作')
  assert.equal(env.bubble().dataset.on, '1', '没说话')
  const all = env.win.MAO_PET.config().zones.flatMap(z => z.lines)
  env.timers.interval.filter(Boolean).pop().fn()
  const textOf = l => (Array.isArray(l) ? l[0] : l)
  assert.ok(all.some(l => textOf(l).startsWith(env.bubble().textContent)), '说的不是被戳时那几句')
})

await test('★★ 戳头 / 戳身 / 戳裙，说的话得不一样', async () => {
  /* 模型自带的 HitArea 只盖住脑袋，所以分区是自己按包围盒算的。
   * 壳里的包围盒是 y20 h360，取每一段中点往回推 global.y。 */
  const env = boot()
  const { created } = await turnOn(env)
  const m = created.models[0]
  const box = m.getBounds()
  const zones = env.win.MAO_PET.config().zones
  const said = []
  let from = 0
  for (const z of zones) {
    const t = (from + Math.min(z.until, 1)) / 2
    from = z.until
    m.handlers.get('pointertap')({ global: { y: box.y + box.height * t } })
    env.timers.interval.filter(Boolean).pop().fn()
    const text = env.bubble().textContent
    assert.ok(z.lines.some(l => l.startsWith(text)), `戳「${z.name}」说出了别的段的话：${text}`)
    said.push(z.name)
  }
  // 沙箱里的 Array 和宿主不是同一个 realm，deepEqual 会因为原型不同而失败 —— 比字符串
  assert.equal(said.join(','), zones.map(z => z.name).join(','), '三段没有各自命中')
})

await test('★★ 连戳到阈值她要闹别扭：不播动作、扭开头', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  const m = created.models[0]
  const { sulkAfter, sulkLines } = env.win.MAO_PET.config()
  // 每下隔 400ms：比双击窗口(320ms)长，不然会被当成双击；比连戳窗口(4000ms)短
  for (let i = 0; i < sulkAfter - 1; i++) { m.handlers.get('pointertap')(); env.advance(400) }
  m.played = null                      // 只看最后那一下，前面几下本来就该播动作
  m.handlers.get('pointertap')()
  env.timers.interval.filter(Boolean).pop().fn()
  assert.ok(sulkLines.some(l => l.startsWith(env.bubble().textContent)),
    '到阈值没说闹别扭那几句，说的是：' + env.bubble().textContent)
  assert.equal(m.played, null, '闹别扭还播动作 —— 动作会把扭开的头掰回来')
})

await test('★ 隔太久再戳不算连戳', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  const m = created.models[0]
  const { sulkAfter, sulkWindowMs, sulkLines } = env.win.MAO_PET.config()
  for (let i = 0; i < sulkAfter + 2; i++) {
    m.handlers.get('pointertap')()
    env.advance(sulkWindowMs + 500)          // 每次都隔很久
  }
  env.timers.interval.filter(Boolean).pop().fn()
  assert.ok(!sulkLines.some(l => l.startsWith(env.bubble().textContent)),
    '隔这么久也被数成连戳了')
})

await test('★★ 双击开对话窗时，要把单击那句话收回去', async () => {
  /* 双击会先走一次单击，不收的话对话窗开了、她头顶还挂着句“干嘛戳我”。 */
  const env = boot()
  const { created } = await turnOn(env)
  let opened = 0
  env.win.NANALY = { open: () => { opened++ } }
  const tap = created.models[0].handlers.get('pointertap')
  tap()
  assert.equal(env.bubble().dataset.on, '1')
  env.advance(120)
  tap()
  assert.equal(opened, 1, '没把对话窗叫出来')
  assert.equal(env.bubble().dataset.on, undefined, '气泡还挂着')
  assert.ok(env.timers.interval.filter(Boolean).length === 1, '打字器没停，只该剩那个循环说话的')
})

await test('★★ 双击判定不能挂在 dblclick 上 —— 手机上那个事件根本不来', async () => {
  /* 这是真撞过的：canvas 上监听 dblclick，桌面好好的，手机上双击她死活不开对话窗。
   * iOS Safari 对 touch 不派发 dblclick，安卓那边双击先被当成缩放手势吃掉。
   * 判定必须走 pointertap —— 那个鼠标和手指都会发。 */
  const env = boot()
  const { created } = await turnOn(env)
  const canvas = env.stage().querySelector('canvas')
  assert.ok(!canvas.handlers.has('dblclick'), '又把双击挂回 canvas 的 dblclick 上了')
  assert.ok(created.models[0].handlers.has('pointertap'), 'pointertap 没接')
})

await test('★★ 两下隔得太久就是两次单击，不该把对话窗打开', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  let opened = 0
  env.win.NANALY = { open: () => { opened++ } }
  const tap = created.models[0].handlers.get('pointertap')
  tap()
  env.advance(900)          // 隔了快一秒，是两次独立的戳
  tap()
  assert.equal(opened, 0, '隔这么久也当成双击了')
  assert.equal(env.bubble().dataset.on, '1', '第二下该照常说话')
})

await test('★ 连戳三下只开一次对话窗', async () => {
  /* 不把计时清零的话，第三下会和第二下再凑成一次双击，对话窗开两遍。 */
  const env = boot()
  const { created } = await turnOn(env)
  let opened = 0
  env.win.NANALY = { open: () => { opened++ } }
  const tap = created.models[0].handlers.get('pointertap')
  tap(); env.advance(100)
  tap(); env.advance(100)
  tap()
  assert.equal(opened, 1, '开了 ' + opened + ' 次')
})

await test('★★ 画布要按她的身体裁，旁边的空白不能拦点击', async () => {
  /* 她站右下角，画布比她大一圈 —— 不裁的话那圈透明的地方会把
   * 底下卡片的点击吃掉。clip-path 连命中判定一起裁，触屏上也算数。 */
  const env = boot()
  await turnOn(env)
  const clip = env.stage().querySelector('canvas').style.clipPath
  assert.ok(clip && clip.startsWith('inset('), '没给画布裁形：' + clip)
  /* 不写死四个数 —— 画布尺寸是 CONFIG 里随时会调的，写死的话调一次大小
   * 这里就红一次。按「包围盒 + 6px 富余」当场算，守的才是那条规则。 */
  const { width: cw, height: ch } = env.created.apps[0].opts
  const b = env.created.models[0].getBounds()
  const pad = 6
  const want = [
    Math.max(0, b.y - pad),
    Math.max(0, cw - (b.x + b.width) - pad),
    Math.max(0, ch - (b.y + b.height) - pad),
    Math.max(0, b.x - pad)
  ]
  const nums = clip.match(/-?[\d.]+/g).map(Number)
  assert.deepEqual(nums, want, '裁出来的边距和包围盒对不上：' + clip)
  assert.ok(nums.every(n => n >= 0), '裁出负边距了：' + clip)
})

await test('★ Butterfly 右侧那竖按钮要抬到她之上，不然回顶点不到', () => {
  const css = readFileSync(path.join(base, 'source/css/mao-pet.css'), 'utf8')
  const hit = css.match(/#rightside\s*\{[^}]*z-index:\s*(\d+)/)
  assert.ok(hit, 'mao-pet.css 里没把 #rightside 抬上去')
  const petZ = Number(boot().win.MAO_PET.config().zIndex)
  const ai = readFileSync(path.join(base, 'source/css/noimpty-ai.css'), 'utf8')
  const panel = Math.min(...[...ai.matchAll(/z-index:\s*(\d{4,})/g)].map(m => Number(m[1])))
  assert.ok(Number(hit[1]) > petZ, `右侧按钮在 ${hit[1]}，她在 ${petZ} —— 会被她的画布盖住`)
  assert.ok(Number(hit[1]) < panel, `右侧按钮不该高过对话面板（${panel}）`)
})

console.log('\n看板娘 · 翻页之后')

await test('★★ pjax 把她连根换掉了，翻完页要把她接回来', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  env.detachStage()
  await env.docListeners.get('pjax:complete')()
  assert.equal(created.models.length, 2, '她没了而开关还亮着 —— 这正是要补回来的情形')
})

await test('★★ 她还在的时候，翻页不该重建一遍', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  await env.docListeners.get('pjax:complete')()
  assert.equal(created.models.length, 1)
})

console.log('\n看板娘 · 尺寸、层级与模型')

await test('★★ 窄屏上她得让位：画布不超过视口宽度的 widthCapRatio', async () => {
  /* 不写死像素 —— 尺寸是 CONFIG 里随时会调的东西，写死的话每调一次大小
   * 这个测试就红一次，而它真正要守的是「窄屏上不许糊一脸」这条规则。 */
  for (const width of [1440, 800, 600, 390, 320]) {
    const env = boot({ innerWidth: width })
    const { created } = await turnOn(env)
    const { width: full, widthCapRatio, height } = env.win.MAO_PET.config()
    const got = created.apps[0].opts.width
    assert.equal(got, Math.max(150, Math.min(full, Math.round(width * widthCapRatio))),
      `视口 ${width}px 时画布宽算错了：${got}`)
    assert.ok(got <= full, `视口 ${width}px 上比 CONFIG.width 还宽`)
    assert.ok(got <= Math.max(150, width * widthCapRatio) + 1, `视口 ${width}px 上越过上限了`)
    assert.equal(created.apps[0].opts.height, Math.round(got * height / full), '高没等比跟着缩')
  }
})

await test('★ 横向落点要听 CONFIG.anchorX 的', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  const { anchorX } = env.win.MAO_PET.config()
  assert.equal(created.models[0].pos[0], created.apps[0].opts.width * anchorX)
  assert.equal(created.models[0].pos[1], created.apps[0].opts.height, '脚底要贴着下边站住')
})

await test('★★ 按设备像素比渲染，高分屏上她才不是糊的', async () => {
  /* 上限曾经写死是 2，而手机普遍是 3 倍屏 —— 等于她在手机上一直只按 2/3 的
   * 分辨率画。这一条守着「3 倍屏要按 3 画」，别再退回去。 */
  const env = boot()
  const { created } = await turnOn(env)
  const { maxResolution } = env.win.MAO_PET.config()
  assert.ok(maxResolution >= 3, `分辨率上限是 ${maxResolution}，手机 3 倍屏上就是糊的`)
  assert.equal(created.apps[0].opts.resolution, 2, '2 倍屏上该按 2 画')
  assert.equal(created.apps[0].opts.autoDensity, true)
  assert.equal(created.apps[0].opts.backgroundAlpha, 0, '背景得是透的，不然她脚下一块方底')

  for (const [dpr, want] of [[1, 1], [3, 3], [8, maxResolution]]) {
    const e = boot({ dpr })
    const { created: c } = await turnOn(e)
    assert.equal(c.apps[0].opts.resolution, want, `${dpr} 倍屏上该按 ${want} 画`)
  }
})

await test('★★ 她得压在对话面板和三个按钮下面', async () => {
  const env = boot()
  await turnOn(env)
  const mine = Number(env.win.MAO_PET.config().zIndex)
  assert.ok(env.stage().style.cssText.includes(`z-index:${mine}`), '层级没写到她那块 DOM 上')
  const css = readFileSync(path.join(base, 'source/css/noimpty-ai.css'), 'utf8')
    + readFileSync(path.join(base, 'source/css/mao-pet.css'), 'utf8')
  const others = [...css.matchAll(/z-index:\s*(\d{4,})/g)].map(m => Number(m[1]))
  assert.ok(others.length >= 2, '没从 css 里读到对话窗那几层，这条对比不算数')
  assert.ok(mine < Math.min(...others),
    `她在 ${mine}，对话窗最低那层在 ${Math.min(...others)} —— 会挡在面板前面`)
})

await test('★★ CONFIG 指的模型文件真的在，且它引用的每个文件都在', async () => {
  const env = boot()
  const config = env.win.MAO_PET.config()
  const modelFile = path.join(base, 'source', config.model)
  assert.ok(existsSync(modelFile), '模型找不到：' + config.model)
  const dir = path.dirname(modelFile)
  const refs = model.FileReferences
  const files = [refs.Moc, refs.Physics, refs.Pose, refs.DisplayInfo, ...(refs.Textures || []),
    ...(refs.Expressions || []).map(e => e.File),
    ...Object.values(refs.Motions || {}).flat().map(m => m.File)].filter(Boolean)
  assert.ok(files.length >= 15, '引用的文件数不对劲：' + files.length)
  for (const rel of files) assert.ok(existsSync(path.join(dir, rel)), '模型引用了不存在的文件：' + rel)
})

await test('★★ 待机和戳她的动作分组名，得是这个模型真有的', () => {
  const env = boot()
  const { idleGroup, tapGroup } = env.win.MAO_PET.config()
  const groups = Object.keys(model.FileReferences.Motions || {})
  assert.ok(groups.includes(idleGroup), `待机分组 "${idleGroup}" 不在模型里，她会一直杵着不动。有的是：${groups.map(g => JSON.stringify(g))}`)
  assert.ok(groups.includes(tapGroup), `戳她的分组 "${tapGroup}" 不在模型里，点了不会有反应`)
})

await test('★ 嘴型参数得是这个模型 LipSync 组里那个', () => {
  const lip = (model.Groups || []).find(g => g.Name === 'LipSync')
  assert.ok(lip, '模型没有 LipSync 组')
  const env = boot()
  assert.ok(lip.Ids.includes(env.win.MAO_PET.config().mouthParam),
    `mouthParam 不在 LipSync 组里（组里是 ${lip.Ids.join(', ')}），说话时嘴不会动`)
})

console.log('\n八张脸')

await test('★★ faces 里每个名字都得是模型真有的表情', () => {
  const cfg = JSON.parse(readFileSync(path.join(base, 'source/live2d/mao/mao_pro.model3.json'), 'utf8'))
  const have = new Set((cfg.FileReferences.Expressions || []).map(e => e.Name))
  const env = boot()
  const { faces, restFace } = env.win.MAO_PET.config()
  for (const [name, id] of Object.entries(faces))
    assert.ok(have.has(id), `faces.${name} 指着 ${id}，模型里没有这张脸`)
  assert.ok(faces[restFace], `restFace 写的是 ${restFace}，faces 里没这个名字`)
  assert.equal(Object.keys(faces).length, have.size, `模型有 ${have.size} 张脸，只接了 ${Object.keys(faces).length} 张`)
})

await test('★★ 每句台词的表情名都得在 faces 里 —— 写错了是静默失效', () => {
  /* face() 认不出名字就什么都不做，不报错。所以打错一个字的后果是
   * 那句话永远顶着上一张脸，而且一声不吭。 */
  const env = boot()
  const cfg = env.win.MAO_PET.config()
  const groups = { welcome: cfg.welcome, idleLines: cfg.idleLines, postLines: cfg.postLines, sulkLines: cfg.sulkLines }
  for (const z of cfg.zones) groups['zones.' + z.name] = z.lines
  for (const [k, v] of Object.entries(cfg.pageLines)) groups['pageLines[' + k + ']'] = v
  for (const [where, list] of Object.entries(groups))
    for (const line of list) {
      if (!Array.isArray(line)) continue      // 只写字符串是允许的，用 restFace
      const [text, mood] = line
      assert.equal(typeof text, 'string', `${where} 里有条台词第一项不是字符串`)
      assert.ok(cfg.faces[mood], `${where} 里「${text}」的表情名 ${mood} 不在 faces 里`)
    }
})

await test('★★ 说话时换脸，说完把脸收回去', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  const m = created.models[0]
  const { faces, restFace } = env.win.MAO_PET.config()
  m.faces = []
  // 直接戳一下，看她换没换脸
  m.handlers.get('pointertap')()
  assert.ok(m.faces.length, '说话的时候一张脸都没换')
  assert.ok(Object.values(faces).includes(m.face), '换上的不是 faces 里的表情：' + m.face)
  // 气泡到点自己收，脸也该跟着回去
  const hide = env.timers.timeout.filter(Boolean).pop()
  hide.fn()
  assert.equal(m.face, faces[restFace], '说完没把脸收回 ' + restFace + '，还顶着 ' + m.face)
})

await test('★ 表情名认不出来就别动脸，不许抛', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  const m = created.models[0]
  m.expression = () => { throw new Error('这张脸没有') }
  assert.doesNotThrow(() => m.handlers.get('pointertap')(), '模型拒绝换脸时把整个处理器带崩了')
})

await test('★★ 八张脸每张都得有台词用到，没用上的等于没接', () => {
  const env = boot()
  const cfg = env.win.MAO_PET.config()
  const all = [...cfg.welcome, ...cfg.idleLines, ...cfg.postLines, ...Object.values(cfg.pageLines).flat()]
  const used = new Set(all.filter(Array.isArray).map(l => l[1]))
  used.add(cfg.restFace)                       // 说完复位那张
  if (/face\('([^']+)'\)/.test(petSource))
    for (const m of petSource.matchAll(/face\('([^']+)'\)/g)) used.add(m[1])
  for (const name of Object.keys(cfg.faces))
    assert.ok(used.has(name), `faces 里的「${name}」没有任何台词用到 —— 接了等于没接`)
})

await test('★★ 被戳的台词不许带表情 —— 动作会把脸整个盖掉', () => {
  /* 实测：七段动作每一段都动了表情用到的全部 28 个参数，动作 3.5~9.4 秒、
   * 气泡才 4.7 秒。戳她时设表情是白设的，截图里她顶着的是动作自带的脸。
   * 规矩：播动作的时候脸归动作管。这条拦着别人「顺手」给分区台词加表情。 */
  const env = boot()
  for (const z of env.win.MAO_PET.config().zones)
    for (const l of z.lines)
      assert.equal(typeof l, 'string', `zones.${z.name} 里「${Array.isArray(l) ? l[0] : l}」带了表情，可是戳她会播动作，表情看不见`)
})

console.log('\n她在哪一页')

await test('★★ 栏目不许在这边再抄一张表，得走 NANALY.sectionOf', () => {
  const src = petSource
  assert.ok(src.includes('NANALY?.sectionOf'), 'Mao 没有调 NANALY.sectionOf')
  // 卡词首，否则 antialias: true 会被当成 alias
  assert.ok(!/(^|[^A-Za-z])alias\s*:/m.test(src), 'Mao 里出现了 alias —— 八成是把 SECTIONS 抄过来了')
  const ai = readFileSync(path.join(base, 'source/js/noimpty-ai.js'), 'utf8')
  assert.ok(/sectionOf:\s*\(/.test(ai), 'noimpty-ai.js 没把 sectionOf 暴露出来')
})

await test('★★ pageLines 的每个 url 都得是 SECTIONS 里真有的栏目', () => {
  /* 写错一个 url 不会报错，只是那一栏永远用不上自己的台词 —— 和表情名写错一样静默。 */
  const ai = readFileSync(path.join(base, 'source/js/noimpty-ai.js'), 'utf8')
  const block = ai.slice(ai.indexOf('const SECTIONS'), ai.indexOf('const SECTIONS') + 6000)
  const urls = new Set([...block.matchAll(/url:\s*'([^']+)'/g)].map(m => m[1]))
  const env = boot()
  for (const url of Object.keys(env.win.MAO_PET.config().pageLines))
    assert.ok(urls.has(url), `pageLines 里的 ${url} 不在 SECTIONS 那张表里`)
})

await test('★★ 文章页要认出标题，太长的标题不往气泡里塞', async () => {
  const env = boot()
  await turnOn(env)
  const cfg = env.win.MAO_PET.config()
  assert.ok(cfg.postLines.every(([t]) => t.includes('{题}')), 'postLines 里有条没留 {题} 的位置')
  assert.ok(petSource.includes('h1.post-title'), '没去读文章标题')
  assert.ok(/length\s*<=\s*\d+/.test(petSource), '标题长度没设上限，长标题会把气泡撑成一坨')
})

await test('★★ CONFIG 里不许有没人读的键 —— 死配置看着像能调，其实调了没用', () => {
  /* voiceVolume 就这么来的：定义了，但控制器的 speak() 根本不收音量参数。
   * 谁把它从 0.85 调到 0.2 都不会有任何反应，而且一声不吭。 */
  const cfg = petSource.slice(petSource.indexOf('const CONFIG = {'))
  const head = cfg.slice(0, cfg.indexOf('\n  }'))
  const keys = [...head.matchAll(/^    ([A-Za-z_][A-Za-z0-9_]*):/gm)].map(m => m[1])
  const body = petSource.slice(petSource.indexOf('\n  }', petSource.indexOf('const CONFIG = {')))
  const dead = keys.filter(k => !new RegExp('CONFIG\\.' + k + '\\b').test(body))
  assert.deepEqual(dead.join(','), '', '这些键定义了但没人读：' + dead.join(', '))
  assert.ok(keys.length > 30, '只数出 ' + keys.length + ' 个键，正则八成没对上')
})

console.log('\n出声')

/* 假声音控制器：记下被要求念了什么，并能手动推进状态。 */
const fakeVoice = env => {
  env.win.NOIMPTY_GATE = { unlocked: () => true }      // 出声要过暗号这关
  const spoken = []
  let listener = null, stopped = 0, state = null, energy = null, subscriptions = 0
  const energyReads = []
  env.win.NANALY = {
    ...(env.win.NANALY || {}),
    voice: () => ({
      speak: (text, opt) => { spoken.push({ text, id: opt && opt.id }); state = { id: opt?.id, phase: 'loading' }; return true },
      stop: () => { stopped++ },
      subscribe: fn => { subscriptions++; listener = fn; return () => { listener = null } },
      state: () => state,
      energy: id => { energyReads.push(id); return energy }
    })
  }
  return { spoken, energyReads, subscriptions: () => subscriptions, current: value => { state = value }, setEnergy: value => { energy = value }, emit: st => { state = st; if (listener) listener(st) }, stopped: () => stopped, id: () => spoken.at(-1)?.id }
}

await test('★★ 默认不出声 —— TTS 按次计费，别默认替人花钱', async () => {
  const env = boot()
  const v = fakeVoice(env)
  const { created } = await turnOn(env)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  created.models[0].handlers.get('pointertap')()
  assert.equal(env.win.MAO_PET.voice(), false, '默认就是开着的')
  assert.equal(v.spoken.length, 0, '默认状态下就去念了：' + JSON.stringify(v.spoken))
  assert.equal(env.win.MAO_PET.config().voiceDefault, false, 'voiceDefault 不是 false')
})

await test('★★ 开了之后，主动招呼她才出声；闲聊不出声', async () => {
  const env = boot()
  const v = fakeVoice(env)
  const { created } = await turnOn(env)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  env.win.MAO_PET.voice(true)
  v.spoken.length = 0

  created.models[0].handlers.get('pointertap')()       // 戳她 = 主动招呼
  assert.equal(v.spoken.length, 1, '戳了却没出声')

  v.spoken.length = 0
  env.timers.interval.find(t => t && t.ms === env.win.MAO_PET.settings().idleSeconds * 1000).fn()  // 闲聊
  assert.equal(v.spoken.length, 0, '闲聊也出声了 —— 每 70 秒烧一次额度')
  assert.equal(env.win.MAO_PET.config().voiceOnIdle, false, 'voiceOnIdle 不是 false')
})

await test('★★ 嘴跟着「真的有没有声音」动，不是跟着打字机', async () => {
  const env = boot()
  const v = fakeVoice(env)
  const { created, params } = await turnOn(env)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  env.win.MAO_PET.voice(true)
  const mouthParam = env.win.MAO_PET.config().mouthParam

  created.models[0].handlers.get('pointertap')()
  const id = v.id()
  // 还在合成，嘴不该动
  params.clear(); v.emit({ id, phase: 'loading' })
  assert.equal(params.get(mouthParam), 0, '还没出声嘴就开始动了')
  // 出声了：起一个跟着声音走的循环
  v.emit({ id, phase: 'playing' })
  const before = env.timers.interval.filter(Boolean).length
  assert.ok(before > 0, '出声了却没有驱动嘴的循环')
})

await test('★★ 关闭聊天联动后，外部朗读不带动 Mao，自己的互动语音仍驱动嘴型', async () => {
  const env = boot()
  env.win.MAO_PET.configure({ chatSync: false })
  const v = fakeVoice(env)
  const { created, params } = await turnOn(env)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  env.win.MAO_PET.voice(true)
  created.models[0].handlers.get('pointertap')()
  /* 看的是「有没有为这次播报起驱动嘴的循环」，而不是嘴参数当前值 ——
   * 循环刚建起来还没跑过一拍，参数是空的，只查参数会漏掉。 */
  const before = env.timers.interval.filter(Boolean).length
  v.emit({ id: 'voice-别人的-id', phase: 'playing' })
  assert.equal(env.timers.interval.filter(Boolean).length, before,
    '别人说话，她也起了驱动嘴的循环')

  // 换成自己那条 id，就该起循环 —— 证明上面那条不是因为整个功能坏了才过
  v.emit({ id: v.id(), phase: 'playing' })
  assert.ok(env.timers.interval.filter(Boolean).length > before, '自己说话反而不动嘴')
})

await test('★★ 没解锁 / 没装声音模块，开了也不该炸', async () => {
  const env = boot()
  env.win.NANALY = { voice: () => null }
  const { created } = await turnOn(env)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  env.win.MAO_PET.voice(true)
  assert.doesNotThrow(() => created.models[0].handlers.get('pointertap')(), '没有控制器就崩')
  env.win.NANALY = undefined
  assert.doesNotThrow(() => created.models[0].handlers.get('pointertap')(), '没有 NANALY 就崩')
})

await test('★★ 借的是娜娜莉那个控制器，不许自己 create 一个', () => {
  assert.ok(petSource.includes('NANALY?.voice'), 'Mao 没去借声音控制器')
  assert.ok(!petSource.includes('NANALY_VOICE.create'), 'Mao 自己 create 了一个控制器 —— 那是第二份缓存和第二条取密钥的路')
  const ai = readFileSync(path.join(base, 'source/js/noimpty-ai.js'), 'utf8')
  assert.ok(/voice:\s*\(\)\s*=>\s*voiceController/.test(ai), 'noimpty-ai.js 没把控制器交出来')
})

await test('★★ 锁着就不出声 —— 否则戳一下会蹦出输密码的面板', async () => {
  const env = boot()
  const v = fakeVoice(env)
  env.win.NOIMPTY_GATE = { unlocked: () => false }
  const { created } = await turnOn(env)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  env.win.MAO_PET.voice(true)
  v.spoken.length = 0
  created.models[0].handlers.get('pointertap')()
  assert.equal(v.spoken.length, 0, '锁着还去要声音了 —— 会触发 onNeedKey 弹面板')
})

await test('★★ 收起她的时候要退订声音控制器，不然回调一直挂着', async () => {
  const env = boot()
  let subs = 0, unsubs = 0
  env.win.NANALY = {
    voice: () => ({
      speak: () => true, stop: () => {}, state: () => null,
      subscribe: () => { subs++; return () => { unsubs++ } }
    })
  }
  const { created } = await turnOn(env)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  env.win.MAO_PET.voice(true)
  created.models[0].handlers.get('pointertap')()
  assert.ok(subs > 0, '压根没订阅')
  await env.win.MAO_PET.hide()
  assert.equal(unsubs, subs, `订了 ${subs} 次只退了 ${unsubs} 次`)
})

await test('★★ 长按按钮必须挡掉浏览器自己的长按手势，否则真机上按了没反应', () => {
  /* 真撞过：#mao-toggle 上没有 touch-action / user-select / touch-callout，
   * iOS 长按弹选择菜单、安卓弹上下文菜单，浏览器一接管就发 pointercancel，
   * 长按计时当场被清掉 —— 手上的感觉就是「按了半天没动静」。
   * 模拟器不模拟这些菜单，所以这条只能靠静态检查守。 */
  const css = cssOf('mao-pet.css')
  const block = blocksFor(css, '#mao-toggle').join(';')
  for (const [prop, why] of [
    ['touch-action', '浏览器会把长按当成自己的手势'],
    ['user-select', '长按会起选择'],
    ['-webkit-touch-callout', 'iOS 会弹选择菜单']
  ]) assert.ok(new RegExp(prop + '\\s*:').test(block), `#mao-toggle 少了 ${prop} —— ${why}`)
  assert.ok(petSource.includes("'contextmenu'"), '没按掉 contextmenu，安卓上它会在长按判定之前弹出来')
})

await test('★★ 长按过程中要有看得见的反馈', async () => {
  /* 没有反馈的话，「松手早了」和「功能坏了」在手上是一模一样的 ——
   * 主人第一次反馈就是「长按了没反应，不知道是功能不行还是没抓到」。 */
  const env = boot()
  await turnOn(env)
  const btn = env.button()
  // 光查源码里出现过 dataset.holding 是不够的 —— 只留一句 delete 也能过。
  // 按住的时候标记必须真的挂上，松手必须真的摘掉。
  btn.fire('pointerdown')
  assert.equal(btn.dataset.holding, '1', '按住了却没做标记，转圈根本不会出现')
  btn.fire('pointerup')
  assert.equal(btn.dataset.holding, undefined, '松手了标记还挂着，圈会一直转')

  // 判定时长要交给 CSS，两边不能各写一个数
  assert.equal(btn.style.getPropertyValue('--mao-hold-ms'),
    env.win.MAO_PET.config().voiceHoldMs + 'ms', '转圈时长和判定时长对不上')
  const css = cssOf('mao-pet.css')
  assert.ok(/#mao-toggle\[data-holding\]/.test(css), 'CSS 里没有长按时的样式')
  assert.ok(/var\(--mao-hold-ms/.test(css), '转圈时长没跟着 --mao-hold-ms 走')
})

await test('★ 出声开关记在本地，下次进来还是那个设置', async () => {
  const env = boot()
  fakeVoice(env)
  await turnOn(env)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  env.win.MAO_PET.voice(true)
  assert.equal(env.storedVoice(), 'true', '没存下来')
})

console.log('\n她知道什么')

/* 给沙箱装一个 fetch + 解密 + 暗号闸门，模拟站点解锁与否。 */
const withSite = (env, { unlocked = true, days = null } = {}) => {
  env.win.NOIMPTY_GATE = { unlocked: () => unlocked }
  env.win.NOIMPTY_SEARCH = { decryptPayload: async p => p.cipher }
  const f = async () => ({
    ok: days !== null,
    json: async () => ({ alg: 'AES-GCM', cipher: JSON.stringify({ days }) })
  })
  // 代码里写的是裸 fetch()，在 vm 里解析到 sandbox 而不是 sandbox.window
  env.win.fetch = f
  env.sandbox.fetch = f
}
const todayKey = env => {
  const d = new Date(env.clockNow())
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

await test('★★ 没解锁就不许播报日程 —— 那是锁在暗号后面的东西', async () => {
  const env = boot()
  withSite(env, { unlocked: false, days: { x: [{ text: 'a', done: false }] } })
  let fetched = 0
  const boom = async () => { fetched++; throw new Error('不该来这儿') }
  env.win.fetch = boom; env.sandbox.fetch = boom
  const { created } = await turnOn(env)
  await new Promise(r => setImmediate(r))
  assert.equal(fetched, 0, '锁着还去取日程了')
  const welcome = env.win.MAO_PET.config().welcome.map(l => l[0])
  env.timers.interval.filter(Boolean).pop().fn()
  assert.ok(welcome.some(t => t.startsWith(env.bubble().textContent)),
    '锁着的时候说的不是普通招呼：' + env.bubble().textContent)
})

await test('★★ 解锁之后，出场那句报今天还剩几件', async () => {
  const env = boot()
  const key = todayKey(env)
  withSite(env, { days: { [key]: [
    { text: 'a', done: true }, { text: 'b', done: false },
    { text: 'c', done: false }, { text: 'd', done: false }
  ] } })
  await turnOn(env)
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r))
  env.timers.interval.filter(Boolean).pop().fn()
  const text = env.bubble().textContent
  const busy = env.win.MAO_PET.config().scheduleLines['堆着'].map(([t]) => t.replace('{剩}', '3'))
  assert.ok(busy.some(t => t.startsWith(text)), '没报出「还剩 3 件」那一档，说的是：' + text)
})

await test('★★ 今天发了文章，脸要变成星星眼', async () => {
  const env = boot()
  const key = todayKey(env)
  withSite(env, { days: { [key]: [
    { text: '写博客', done: true, autoWhy: '你发了《Git 第三章》' }
  ] } })
  const { created } = await turnOn(env)
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r))
  const { faces } = env.win.MAO_PET.config()
  // 状态到位之后再说一句，然后让气泡到点自己收 —— 复位的该是「当前心情」那张
  env.win.MAO_PET.say('随便说点什么')
  env.timers.timeout.filter(Boolean).pop().fn()
  assert.equal(created.models[0].face, faces['星星眼'],
    '今天发了东西，她的脸却是 ' + created.models[0].face)
})

await test('★★ 日程全做完是笑，堆着是为难', async () => {
  const key = env0 => todayKey(env0)
  for (const [days, want] of [
    [[{ text: 'a', done: true }], '笑'],
    [[{ text: 'a', done: false }, { text: 'b', done: false }, { text: 'c', done: false }], '为难']
  ]) {
    const env = boot()
    withSite(env, { days: { [key(env)]: days } })
    const { created } = await turnOn(env)
    for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r))
    env.win.MAO_PET.say('随便说点什么')
    env.timers.timeout.filter(Boolean).pop().fn()
    const { faces } = env.win.MAO_PET.config()
    assert.equal(created.models[0].face, faces[want], '该是' + want + '，实际 ' + created.models[0].face)
  }
})

await test('★★ 标签页开着跨过午夜，日程摘要要重算', async () => {
  const env = boot()
  const today = todayKey(env)
  withSite(env, { days: { [today]: [{ text: 'a', done: false }, { text: 'b', done: false }, { text: 'c', done: false }] } })
  const { created } = await turnOn(env)
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r))
  const { faces } = env.win.MAO_PET.config()
  env.win.MAO_PET.say('随便说点什么')
  env.timers.timeout.filter(Boolean).pop().fn()
  assert.equal(created.models[0].face, faces['为难'], '今天堆着三件，脸该是为难')

  env.advance(26 * 3600 * 1000)          // 过了一天，昨天那三件不作数了
  env.win.MAO_PET.say('新的一天')        // 说一句就会取一次当前心情
  env.timers.timeout.filter(Boolean).pop().fn()
  assert.notEqual(created.models[0].face, faces['为难'],
    '跨过午夜还顶着昨天的脸')
})

await test('★★ 解密要走 NOIMPTY_SEARCH，不许自己再写一份 AES', () => {
  assert.ok(petSource.includes('NOIMPTY_SEARCH'), '没走站里那份解密')
  assert.ok(!/crypto\.subtle/.test(petSource), 'Mao 自己写解密了 —— 该和 schedule.js 走同一条路')
  assert.ok(petSource.includes('NOIMPTY_GATE'), '没检查暗号闸门就去取数据')
})

await test('★★ 隔了一天再来，她要先说「好久没见」', async () => {
  const env2 = boot({ lastSeen: CLOCK0 - 30 * 3600 * 1000 })   // 上次来是 30 小时前
  withSite(env2, { days: null })
  await turnOn(env2)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  env2.timers.interval.filter(Boolean).pop().fn()
  const text = env2.bubble().textContent
  const miss = env2.win.MAO_PET.config().missLines.map(([t]) => t.replace('{隔}', '1 天'))
  assert.ok(miss.some(t => t.startsWith(text)), '隔了一天却没说想你那几句：' + text)
})

console.log('\n什么时候说什么')

/* 把沙箱的表拨到指定时刻。clock 是毫秒，直接构造本地时间。 */
const atLocal = (env, y, mo, d, h) => env.advance(new Date(y, mo - 1, d, h, 0, 0).getTime() - env.clockNow())

await test('★★ 深夜只劝睡，压过页面台词', async () => {
  const env = boot()
  await turnOn(env)
  atLocal(env, 2026, 6, 10, 2)          // 凌晨两点
  const lines = env.win.MAO_PET.lines()
  const night = env.win.MAO_PET.config().dayParts.find(p => p.name === '深夜')
  assert.ok(lines.every(([t]) => night.lines.includes(t)),
    '深夜说的不是劝睡那几句：' + JSON.stringify(lines.map(l => l[0])))
})

await test('★★ 节日压过一切，包括深夜', async () => {
  const env = boot()
  await turnOn(env)
  atLocal(env, 2026, 1, 1, 2)           // 元旦凌晨两点：节日该赢
  const lines = env.win.MAO_PET.lines()
  const fest = env.win.MAO_PET.config().festivals['01-01']
  assert.ok(lines.every(([t]) => fest.lines.includes(t)),
    '元旦没说节日的话：' + JSON.stringify(lines.map(l => l[0])))
})

await test('★★ 白天没有栏目台词时退到时段，永远有话可说', async () => {
  const env = boot()
  await turnOn(env)
  for (const h of [8, 14, 21]) {
    atLocal(env, 2026, 6, 10, h)
    const lines = env.win.MAO_PET.lines()
    assert.ok(Array.isArray(lines) && lines.length, `${h} 点一句话都给不出来`)
    for (const l of lines) {
      assert.equal(typeof l[0], 'string', `${h} 点给出的不是台词：` + JSON.stringify(l))
      assert.ok(l[1] === undefined || env.win.MAO_PET.config().faces[l[1]], `${h} 点的表情名不认识：` + l[1])
    }
  }
})

await test('★★ 节日和时段的表情名也得在 faces 里', () => {
  const env = boot()
  const cfg = env.win.MAO_PET.config()
  for (const p of cfg.dayParts)
    assert.ok(cfg.faces[p.face], `dayParts.${p.name} 的表情 ${p.face} 不在 faces 里`)
  for (const [k, f] of Object.entries(cfg.festivals))
    assert.ok(cfg.faces[f.face], `festivals['${k}'] 的表情 ${f.face} 不在 faces 里`)
})

console.log('\n跟着音乐摆 / 闹别扭')

const frameOf = m => m.internalModel.hooks.get('afterMotionUpdate')

await test('★★ 每帧参数必须挂在 afterMotionUpdate 上，早一步就是白写', () => {
  /* 动作每帧会把 128 个参数重刷一遍，表情也在 afterMotionUpdate 之前算完。
   * 挂 beforeMotionUpdate 或者在外面定时写，下一帧就被冲掉了。 */
  const env = boot()
  assert.ok(petSource.includes("'afterMotionUpdate'"), '没挂 afterMotionUpdate')
  assert.ok(!petSource.includes("'beforeMotionUpdate'"), '挂到 beforeMotionUpdate 上了，会被动作冲掉')
})

await test('★★ 音乐能量驱动头发和罩袍，不许自己再建一套 AudioContext', async () => {
  const env = boot()
  const { created, params } = await turnOn(env)
  const m = created.models[0]
  const frame = frameOf(m)
  assert.ok(frame, '没挂每帧钩子')

  // 没在放音乐：一个摆动参数都不该被写
  env.win.NOIMPTY_MUSIC_PLAYER = { energy: () => 0 }
  params.clear(); frame()
  const swayIds = env.win.MAO_PET.config().danceWith.map(([id]) => id)
  assert.ok(swayIds.every(id => !params.has(id)), '没放音乐也在摆')

  // 放起来：摆动参数得被写上
  env.win.NOIMPTY_MUSIC_PLAYER = { energy: () => 0.8 }
  params.clear(); frame()
  assert.ok(swayIds.some(id => params.has(id)), '音乐响着却不摆')

  // 能量不是数字 / 取不到，也不能炸
  env.win.NOIMPTY_MUSIC_PLAYER = { energy: () => { throw new Error('播放器坏了') } }
  assert.doesNotThrow(() => frame(), '播放器抛错把整帧带崩了')
  env.win.NOIMPTY_MUSIC_PLAYER = undefined
  assert.doesNotThrow(() => frame(), '没有播放器就崩')

  assert.ok(!/new\s+(window\.)?(webkit)?AudioContext/.test(petSource),
    'Mao 自己建了 AudioContext —— 该搭播放器那份便车')
  assert.ok(!petSource.includes('captureStream'), 'Mao 自己去 captureStream 了')
})

await test('★★ 播放器得把 energy() 暴露出来', () => {
  const mp = readFileSync(path.join(base, 'source/js/music-player.js'), 'utf8')
  assert.ok(/energy:\s*\(\)\s*=>\s*stage\.energy\(\)/.test(mp), 'NOIMPTY_MUSIC_PLAYER 上没有 energy()')
  assert.ok(/energy:\s*\(\)\s*=>\s*lastEnergy/.test(mp), 'stage 没把 lastEnergy 交出来')
  assert.ok(/lastEnergy\s*=\s*0/.test(mp), '停下来没把能量归零，她会对着静音继续摆')
})

await test('★★ 闹别扭的时候要扭开头，过去了要自己收回来', async () => {
  const env = boot()
  const { created, params } = await turnOn(env)
  const m = created.models[0]
  const frame = frameOf(m)
  const { sulkAfter, sulkMs } = env.win.MAO_PET.config()
  env.win.NOIMPTY_MUSIC_PLAYER = { energy: () => 0 }

  params.clear(); frame()
  assert.ok(!params.has('ParamAngleY'), '还没闹就开始扭了')

  for (let i = 0; i < sulkAfter; i++) { m.handlers.get('pointertap')(); env.advance(400) }
  params.clear(); frame()
  assert.ok(params.has('ParamAngleY'), '闹别扭了却没扭头')
  assert.ok(params.get('ParamAngleY') < 0, '扭的方向不对：' + params.get('ParamAngleY'))

  env.advance(sulkMs + 100)
  params.clear(); frame()
  assert.ok(!params.has('ParamAngleY'), '别扭过去了还扭着不回来')
})

await test('★ 关掉再打开，她不该还在闹别扭', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  const { sulkAfter } = env.win.MAO_PET.config()
  for (let i = 0; i < sulkAfter; i++) { created.models[0].handlers.get('pointertap')(); env.advance(400) }
  await env.win.MAO_PET.hide()
  assert.ok(petSource.includes('resetMood()'), '收起来的时候没清掉情绪状态')
})

console.log('\n左下角那一摞按钮')

/* 三个按钮分别住在三个 css 文件里，以前各写各的坐标 —— 音乐那个有窄屏规则
 * （挪到 left:12px / 48px），猫爪那个自己写了 left:14px / 48px，Mao 那个一条
 * 窄屏规则都没有，于是手机上三个按钮左边缘差 2px、大小差一圈、纵向间距也对不上。
 * 现在统一从 custom.css 那几个变量算，这一节守着「谁都别再自己写坐标」。 */

await test('★★ custom.css 里得有那几个共用变量，三个按钮全靠它们对齐', () => {
  const css = cssOf('custom.css')
  for (const v of ['--corner-size', '--corner-gap', '--corner-left', '--corner-bottom',
                   '--corner-slot-0', '--corner-slot-1', '--corner-slot-2'])
    assert.ok(css.includes(v + ':'), `custom.css 里没定义 ${v}`)
  assert.ok(/--corner-bottom:\s*max\([^)]*env\(safe-area-inset-bottom\)/.test(css),
    '最底下那一格没兜住刘海屏的安全区')
})

await test('★★ 三个按钮谁都不许自己写 left / bottom，只能读变量', () => {
  const targets = [
    ['music-player.css', '#noimpty-music-player', '--corner-slot-0'],
    ['noimpty-ai.css', '#nanaly-launcher', '--corner-slot-1'],
    ['mao-pet.css', '#mao-toggle', '--corner-slot-2']
  ]
  for (const [file, id, slot] of targets) {
    const blocks = blocksFor(cssOf(file), id)
    assert.ok(blocks.length, `${file} 里找不到 ${id} 的规则`)
    let sawLeft = false, sawBottom = false
    for (const body of blocks) {
      for (const d of body.split(';')) {
        const hit = d.match(/^\s*(left|bottom)\s*:\s*(.+)$/s)
        if (!hit) continue
        const [, prop, value] = hit
        assert.ok(value.includes('var(--corner-'),
          `${file} 的 ${id} 自己写了 ${prop}:${value.trim()} —— 得走 var(--corner-…)`)
        if (prop === 'left') sawLeft = true
        if (prop === 'bottom') { sawBottom = true; assert.ok(value.includes(slot), `${id} 该站第 ${slot} 格，写的是 ${value.trim()}`) }
      }
    }
    assert.ok(sawLeft && sawBottom, `${id} 没把 left / bottom 都定下来`)
  }
})

await test('★ 窄屏只缩变量，不许单独缩其中一个按钮', () => {
  /* 只把猫爪缩成 48px、另外两个留 54px，就是他看到的那种参差。 */
  const css = cssOf('custom.css')
  const narrow = css.match(/@media\s*\(max-width:\s*520px\)\s*\{([\s\S]*?)\n\}/)
  assert.ok(narrow, 'custom.css 里没有窄屏那段')
  assert.ok(narrow[1].includes('--corner-size'), '窄屏没有统一改 --corner-size')
  for (const [file, id] of [['noimpty-ai.css', '#nanaly-launcher'], ['mao-pet.css', '#mao-toggle']])
    for (const body of blocksFor(cssOf(file), id))
      for (const d of body.split(';')) {
        const hit = d.match(/^\s*(width|height)\s*:\s*(.+)$/s)
        if (hit) assert.ok(hit[2].includes('var(--corner-size)'),
          `${file} 的 ${id} 自己写死了 ${hit[1]}:${hit[2].trim()}`)
      }
})

await test('★★ 音乐面板一展开，整摞按钮要一起让位 —— 少抬一个就压在面板上', () => {
  /* 实测：手机上音乐面板展开后从 bottom:12 长到 236，而帽子钉在 bottom:136，
   * 正好落在面板身上；帽子 z-index 9003 比播放器 9000 高，于是压着面板内容画。
   * 抬的时候三个要一起抬，间距才不乱。 */
  const css = cssOf('sakura-components.css')
  const lift = css.match(/body:has\(#noimpty-music-player:not\(\.is-collapsed\)\)\s*:is\(([^)]*)\)\s*\{([^}]*)\}/)
  assert.ok(lift, 'sakura-components.css 里找不到「为展开的播放器让位」那条')
  for (const id of ['#nanaly-launcher', '#mao-toggle'])
    assert.ok(lift[1].includes(id), `让位那条里没带上 ${id}`)
  assert.ok(/translate:\s*0\s+-\d+px/.test(lift[2]), '让位没用 translate：' + lift[2].trim())

  // 抬起来的那一摞要能滑过去，不是瞬移
  const petCss = cssOf('mao-pet.css')
  const block = blocksFor(petCss, '#mao-toggle').join(';')
  assert.ok(/transition:[^;]*\btranslate\b/.test(block), '#mao-toggle 的 transition 里没有 translate，它会瞬间跳上去')
})



await test('late model resolution after hide releases it and a queued show gets a fresh instance', async () => {
  const env = boot({ delayModel: true })
  env.armLibs()
  const first = env.win.MAO_PET.show()
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  assert.equal(env.created.models.length, 1)
  await env.win.MAO_PET.hide()
  const next = env.win.MAO_PET.show()
  env.releaseModel(); await first; await tick()
  assert.equal(env.created.models[0].destroyed, true)
  assert.equal(env.created.models.length, 2)
  env.releaseModel(); await next
  assert.equal(env.win.MAO_PET.model(), env.created.models[1])
  assert.equal(env.created.apps[0].destroyed.length > 0, true)
  await env.win.MAO_PET.hide()
})
await test('voice completion stops its mouth loop and hiding Mao never cancels a newer chat reading', async () => {
  const env = boot(), v = fakeVoice(env)
  await turnOn(env); env.win.MAO_PET.voice(true)
  const id = v.id(), before = env.timers.interval.filter(Boolean).length
  v.emit({ id, phase: 'playing' })
  assert.equal(env.timers.interval.filter(Boolean).length, before + 1)
  v.emit({ id, phase: 'loading' })
  assert.equal(env.timers.interval.filter(Boolean).length, before)
  v.emit({ id, phase: 'playing' }); v.emit(null)
  assert.equal(env.timers.interval.filter(Boolean).length, before)
  v.emit({ id: 'chat-current', phase: 'playing' })
  const stops = v.stopped()
  await env.win.MAO_PET.hide()
  assert.equal(v.stopped(), stops)
})
await test('hidden and bfcached pages stop model updates and idle work, then resume once', async () => {
  const env = boot(); await turnOn(env)
  env.document.hidden = true; env.docListeners.get('visibilitychange')()
  assert.equal(env.created.models[0].autoUpdate, false)
  assert.equal(env.timers.interval.filter(Boolean).length, 0)
  env.document.hidden = false; env.winListeners.get('pageshow')({ type: 'pageshow' })
  assert.equal(env.created.models[0].autoUpdate, true)
  assert.equal(env.timers.interval.filter(Boolean).length, 1)
  env.winListeners.get('pageshow')({ type: 'pageshow' })
  assert.equal(env.timers.interval.filter(Boolean).length, 1)
  await env.win.MAO_PET.hide()
})



await test('a closed site gate clears cached schedule state before later mood reads', async () => {
  const env = boot()
  withSite(env, { days: { [todayKey(env)]: [{ done: true, autoWhy: '你发了文章' }] } })
  await turnOn(env); await tick()
  const cfg = env.win.MAO_PET.config(), model = env.win.MAO_PET.model()
  env.win.MAO_PET.say('查看当前状态')
  assert.equal(model.face, cfg.faces['星星眼'])
  env.win.NOIMPTY_GATE = { unlocked: () => false }
  env.win.MAO_PET.say('锁住之后')
  assert.equal(model.face, cfg.faces[cfg.restFace])
  env.win.NOIMPTY_GATE = { unlocked: () => true }
  env.win.MAO_PET.say('旧缓存不能回来')
  assert.equal(model.face, cfg.faces[cfg.restFace])
})
await test('a schedule response decrypted after the site gate closes is discarded', async () => {
  const env = boot(); let release
  withSite(env, { days: { [todayKey(env)]: [{ done: true, autoWhy: '你发了文章' }] } })
  env.win.NOIMPTY_SEARCH.decryptPayload = payload => new Promise(resolve => { release = () => resolve(payload.cipher) })
  await turnOn(env)
  env.win.NOIMPTY_GATE = { unlocked: () => false }
  release(); await tick()
  env.win.NOIMPTY_GATE = { unlocked: () => true }
  env.win.MAO_PET.say('迟到的数据不可缓存')
  const cfg = env.win.MAO_PET.config()
  assert.equal(env.win.MAO_PET.model().face, cfg.faces[cfg.restFace])
})


console.log('\nMao 升级 · 偏好、紧凑与性能')
const flushTyping = env => {
  for (let i = 0; i < 300; i++) {
    const timer = env.timers.interval.find(item => item && item.ms === env.win.MAO_PET.config().typeMs)
    if (!timer) return
    timer.fn()
  }
}
const emitChat = (env, phase, turnId = 'turn-1', text = '') => env.winListeners.get('nanaly:chat-state')({ detail: { phase, turnId, text } })
const emitSchedule = (env, tasks, source = 'edit') => env.winListeners.get('noimpty:schedule-updated')({ detail: { days: { [todayKey(env)]: tasks }, source } })
const pointerEvent = (x, y, extra = {}) => ({ pointerId: 7, clientX: x, clientY: y, button: 0, preventDefault () { this.prevented = true }, ...extra })

await test('默认手机采用 88px 小挂件，主动点击展开，手动紧凑仍可重新生效', async () => {
  const env = boot({ innerWidth: 390, settingsSaved: null })
  await turnOn(env)
  const m = env.win.MAO_PET.model(), canvas = env.stage().querySelector('canvas')
  assert.equal(env.win.MAO_PET.settings().autoCompact, true)
  assert.equal(env.created.apps[0].opts.width, 88)
  assert.equal(env.stage().dataset.compact, '1')
  assert.match(canvas.style.clipPath, /^circle/)
  m.handlers.get('pointertap')()
  assert.equal(env.stage().dataset.compact, '0')
  assert.equal(env.stage().style.width, '203px')
  assert.equal(m.motionCount || 0, 0, '展开小挂件不应同时触发戳一下')
  env.win.MAO_PET.configure({ compact: true })
  assert.equal(env.stage().dataset.compact, '1')
})
await test('偏好只接受白名单类型，高度夹紧，读取副本不修改已保存状态', () => {
  const env = boot({ settingsSaved: { side: 'left', size: 'enormous', bottomRatio: 2, voice: 'true', quiet: true, idleSeconds: 10, power: 'turbo', unknown: 'x' } })
  const pet = env.win.MAO_PET
  assert.equal(pet.settings().side, 'left'); assert.equal(pet.settings().size, 'medium')
  assert.equal(pet.settings().bottomRatio, 1); assert.equal(pet.settings().voice, false)
  assert.equal(pet.settings().idleSeconds, 70); assert.equal(pet.settings().power, 'auto')
  assert.equal('unknown' in pet.settings(), false)
  pet.configure({ bottomRatio: -3, quiet: false, idleSeconds: 300, size: 'large' })
  pet.configure({ bottomRatio: Infinity, side: 'middle', compact: 'false' })
  assert.equal(pet.settings().bottomRatio, 0); assert.equal(pet.settings().side, 'left')
  assert.equal(pet.settings().compact, false); assert.equal(pet.settings().idleSeconds, 300)
  const copy = pet.settings(); copy.side = 'right'
  assert.equal(pet.settings().side, 'left'); assert.equal(env.storedSettings().side, 'left')
  assert.equal(boot({ settingsSaved: '{invalid' }).win.MAO_PET.settings().autoCompact, true)
})
await test('省电与系统减少动效/省流量实时降到 24FPS，关闭恢复共享 ticker', async () => {
  const env = boot(), { params } = await turnOn(env)
  const app = env.created.apps[0], shared = env.win.PIXI.Ticker.shared
  const frame = env.win.MAO_PET.model().internalModel.hooks.get('afterMotionUpdate')
  env.win.NOIMPTY_MUSIC_PLAYER = { energy: () => 1 }
  assert.equal(app.ticker.maxFPS, 60); assert.equal(shared.maxFPS, 60)
  env.win.MAO_PET.configure({ power: 'saving' })
  assert.equal(app.ticker.maxFPS, 24); assert.equal(shared.maxFPS, 24)
  params.clear(); frame(); assert.equal(params.has('ParamHairFront'), false)
  env.win.MAO_PET.configure({ power: 'auto' })
  env.motionQuery.matches = true; env.motionListeners.get('change')()
  assert.equal(app.ticker.maxFPS, 24)
  env.motionQuery.matches = false; env.motionListeners.get('change')()
  assert.equal(app.ticker.maxFPS, 60)
  env.connection.saveData = true; env.connectionListeners.get('change')()
  assert.equal(app.ticker.maxFPS, 24)
  await env.win.MAO_PET.hide()
  assert.equal(shared.maxFPS, 120)
  assert.equal(env.motionListeners.size, 0); assert.equal(env.connectionListeners.size, 0)
})
await test('安静模式停止闲聊与当前招呼，改间隔不积累定时器，显式互动仍可用', async () => {
  const env = boot(); await turnOn(env)
  env.win.MAO_PET.configure({ quiet: true })
  assert.equal(env.timers.interval.filter(Boolean).length, 0)
  assert.equal(env.bubble().dataset.on, undefined)
  env.win.MAO_PET.say('主动互动'); flushTyping(env)
  assert.equal(env.bubble().textContent, '主动互动')
  env.win.MAO_PET.configure({ quiet: false, idleSeconds: 150 })
  assert.equal(env.timers.interval.filter(item => item && item.ms >= 70000).length, 1)
  assert.equal(env.timers.interval.find(item => item && item.ms >= 70000).ms, 150000)
  env.win.MAO_PET.configure({ idleSeconds: 300 }); env.win.MAO_PET.configure({ idleSeconds: 0 })
  assert.equal(env.timers.interval.filter(item => item && item.ms >= 70000).length, 0)
})

console.log('\nMao 升级 · 聊天、能量与情绪')
await test('聊天思考→流式→完成更新气泡，闲聊与戳动作不抢占', async () => {
  const env = boot(); await turnOn(env)
  const m = env.win.MAO_PET.model(), cfg = env.win.MAO_PET.config()
  emitChat(env, 'thinking')
  assert.equal(env.bubble().textContent, '在想了喵…'); assert.equal(m.face, cfg.faces['为难'])
  const idle = env.timers.interval.find(item => item && item.ms === 70000)
  idle.fn(); m.handlers.get('pointertap')()
  assert.equal(env.bubble().textContent, '在想了喵…')
  assert.equal(m.motionCount || 0, 0); assert.equal(env.controlCalls.showActions, 1)
  emitChat(env, 'streaming', 'turn-1', '流式内容'.repeat(100))
  assert.ok(env.bubble().textContent.length <= 180); assert.match(env.bubble().textContent, /流式内容/)
  emitChat(env, 'complete', 'turn-1', '最终回复')
  assert.equal(env.bubble().textContent, '最终回复'); assert.equal(m.face, cfg.faces['笑'])
  env.fireTimeout(cfg.speakMs)
  assert.equal(env.bubble().dataset.on, undefined)
})
await test('旧轮完成不能覆盖新轮；取消、错误、空闲和关闭联动明确收尾', async () => {
  const env = boot(); await turnOn(env)
  emitChat(env, 'thinking', 'old'); emitChat(env, 'thinking', 'new')
  emitChat(env, 'complete', 'old', '迟到的旧回答')
  assert.equal(env.bubble().textContent, '在想了喵…')
  emitChat(env, 'cancelled', 'new'); assert.match(env.bubble().textContent, /先停在这里/)
  emitChat(env, 'error', 'new'); assert.equal(env.win.MAO_PET.model().face, env.win.MAO_PET.config().faces['难过'])
  emitChat(env, 'idle', 'new'); assert.equal(env.bubble().dataset.on, undefined)
  env.win.MAO_PET.configure({ chatSync: false })
  emitChat(env, 'thinking', 'ignored'); assert.equal(env.bubble().dataset.on, undefined)
})
await test('聊天语音用真实能量驱动嘴、段落情绪驱动脸，暂停归零且不自动请求朗读', async () => {
  const env = boot(), v = fakeVoice(env), { params } = await turnOn(env)
  const m = env.win.MAO_PET.model(), cfg = env.win.MAO_PET.config(), frame = m.internalModel.hooks.get('afterMotionUpdate')
  v.setEnergy(0)
  v.emit({ id: 'chat-a', priority: 'manual', phase: 'playing', text: '这段读出来', emotion: 'happy', intensity: .9 })
  assert.equal(params.get(cfg.mouthParam), 0)
  assert.equal(env.bubble().textContent, '这段读出来'); assert.equal(m.face, cfg.faces['笑'])
  v.setEnergy(.2); frame()
  assert.ok(params.get(cfg.mouthParam) > 0 && params.get(cfg.mouthParam) <= 1)
  assert.equal(v.energyReads.at(-1), 'chat-a')
  v.emit({ id: 'chat-a', priority: 'manual', phase: 'paused' })
  assert.equal(params.get(cfg.mouthParam), 0)
  v.emit({ id: 'chat-a', priority: 'manual', phase: 'playing', emotion: 'sad', intensity: .8 })
  assert.equal(m.face, cfg.faces['难过'])
  v.emit({ id: 'chat-a', priority: 'manual', phase: 'playing', emotion: 'excited', intensity: .1 })
  assert.equal(m.face, cfg.faces['平静'])
  v.emit({ id: 'chat-a', priority: 'manual', phase: 'ended' })
  assert.equal(params.get(cfg.mouthParam), 0); assert.equal(v.spoken.length, 0)
})
await test('波形不可用时只在真实 playing 阶段退回嘴型动画；关闭联动立即停止', async () => {
  const env = boot(), v = fakeVoice(env), { params } = await turnOn(env)
  const mouth = env.win.MAO_PET.config().mouthParam
  v.setEnergy(null); v.emit({ id: 'chat-b', priority: 'auto', phase: 'loading' })
  assert.equal(params.get(mouth), 0)
  v.emit({ id: 'chat-b', priority: 'auto', phase: 'playing', emotion: 'concerned' })
  assert.ok(params.get(mouth) > 0)
  env.win.MAO_PET.configure({ chatSync: false })
  assert.equal(params.get(mouth), 0)
  v.emit({ id: 'chat-b', priority: 'auto', phase: 'playing' })
  assert.equal(params.get(mouth), 0)
})
await test('聊天播放中流式文字、闲聊及音乐不会覆盖正在朗读的嘴型和气泡', async () => {
  const env = boot(), v = fakeVoice(env), { params } = await turnOn(env)
  emitChat(env, 'thinking', 'spoken-turn')
  v.setEnergy(.1); v.emit({ id: 'chat-c', priority: 'auto', phase: 'playing', text: '实际在播放', emotion: 'soothing' })
  emitChat(env, 'streaming', 'spoken-turn', '尚未读到的后续文本')
  env.win.MAO_PET.say('闲聊不该插进来')
  assert.equal(env.bubble().textContent, '实际在播放')
  env.win.NOIMPTY_MUSIC_PLAYER = { energy: () => 1 }
  params.clear(); env.win.MAO_PET.model().internalModel.hooks.get('afterMotionUpdate')()
  assert.ok(params.get(env.win.MAO_PET.config().mouthParam) > 0)
  assert.equal(params.has('ParamHairFront'), false)
})

console.log('\nMao 升级 · 拖动与失败恢复')
await test('拖动吸附最近侧并保存高度；拖后 pointertap 不触发戳或双击', async () => {
  const env = boot(); await turnOn(env)
  const stage = env.stage(), canvas = stage.querySelector('canvas'), m = env.win.MAO_PET.model()
  let captured = null, released = null
  canvas.setPointerCapture = id => { captured = id }; canvas.releasePointerCapture = id => { released = id }
  stage.getBoundingClientRect = () => ({ left: 1040, top: 400, width: 380, height: 480 })
  canvas.fire('pointerdown', pointerEvent(1100, 450))
  canvas.fire('pointermove', pointerEvent(180, 210))
  assert.equal(stage.dataset.dragging, '1'); assert.equal(captured, 7)
  canvas.fire('pointerup', pointerEvent(180, 210))
  assert.equal(released, 7); assert.equal(stage.dataset.dragging, undefined)
  assert.equal(env.storedSettings().side, 'left')
  assert.ok(env.storedSettings().bottomRatio > .6 && env.storedSettings().bottomRatio < .7)
  m.handlers.get('pointertap')(); assert.equal(m.motionCount || 0, 0)
  env.advance(401); m.handlers.get('pointertap')(); assert.equal(m.motionCount, 1)
})
await test('Pixi pointertap 先于 DOM pointerup 时，正在拖动的紧凑挂件也不展开或戳一下', async () => {
  const env = boot({ settingsSaved: { compact: true, autoCompact: false } }); await turnOn(env)
  const stage = env.stage(), canvas = stage.querySelector('canvas'), m = env.win.MAO_PET.model()
  stage.getBoundingClientRect = () => ({ left: 1200, top: 700, width: 88, height: 88 })
  canvas.fire('pointerdown', pointerEvent(1230, 730))
  canvas.fire('pointermove', pointerEvent(180, 210))
  assert.equal(stage.dataset.dragging, '1')
  // Pixi 注册监听更早：真实浏览器的 tap 在我们的 DOM up 回调之前到达。
  m.handlers.get('pointertap')()
  assert.equal(env.win.MAO_PET.settings().compact, true)
  assert.equal(stage.dataset.compact, '1'); assert.equal(m.motionCount || 0, 0)
  assert.equal(env.controlCalls.showActions, 0)
  canvas.fire('pointerup', pointerEvent(180, 210))
  assert.equal(stage.dataset.dragging, undefined)
  assert.equal(env.storedSettings().side, 'left'); assert.equal(env.storedSettings().compact, true)
  assert.equal(stage.dataset.compact, '1')
})

await test('取消拖动不持久化临时位置；键盘方向可移动，回车打开快捷卡', async () => {
  const env = boot(); await turnOn(env)
  const canvas = env.stage().querySelector('canvas'), before = JSON.stringify(env.storedSettings())
  canvas.fire('pointerdown', pointerEvent(150, 150))
  canvas.fire('pointermove', pointerEvent(400, 300))
  canvas.fire('pointercancel', pointerEvent(400, 300))
  assert.equal(JSON.stringify(env.storedSettings()), before); assert.equal(env.stage().dataset.dragging, undefined)
  canvas.fire('keydown', pointerEvent(0, 0, { key: 'ArrowLeft' }))
  canvas.fire('keydown', pointerEvent(0, 0, { key: 'ArrowUp' }))
  assert.equal(env.storedSettings().side, 'left'); assert.equal(env.storedSettings().bottomRatio, .05)
  canvas.fire('keydown', pointerEvent(0, 0, { key: 'Enter' }))
  assert.equal(env.controlCalls.showActions, 1)
})
await test('模型超时释放画布，迟到模型销毁，重试建立全新实例并复用运行时', async () => {
  const env = boot({ delayModel: true }); env.armLibs()
  const first = env.win.MAO_PET.show()
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  assert.equal(env.created.models.length, 1)
  env.fireTimeout(30000); await first
  assert.equal(env.win.MAO_PET.status().phase, 'error'); assert.equal(env.stage(), undefined)
  assert.equal(env.created.apps[0].destroyed.length > 0, true)
  env.releaseModel(); await tick()
  assert.equal(env.created.models[0].destroyCount, 1)
  const retry = env.win.MAO_PET.retry(); await tick()
  assert.equal(env.created.models.length, 2)
  env.releaseModel(); await retry
  assert.equal(env.win.MAO_PET.status().phase, 'ready')
  assert.equal(env.win.MAO_PET.model(), env.created.models[1]); assert.equal(env.scripts.length, 3)
})
await test('运行时超时可重试，不遗留 busy 状态或永不完成的 loading promise', async () => {
  const env = boot(); env.armLibs()
  const first = env.win.MAO_PET.show(); env.fireTimeout(20000); await first
  assert.equal(env.win.MAO_PET.status().phase, 'error'); assert.equal(env.button().dataset.busy, undefined)
  const retry = env.win.MAO_PET.retry()
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  await retry
  assert.equal(env.win.MAO_PET.status().phase, 'ready')
  assert.equal(env.created.models.length, 1)
})
await test('WebGL 上下文丢失清理旧绑定，并可从设置面板重试', async () => {
  const env = boot(); await turnOn(env)
  const canvas = env.stage().querySelector('canvas'), event = pointerEvent(0, 0)
  canvas.fire('webglcontextlost', event); await tick()
  assert.equal(event.prevented, true); assert.equal(canvas.handlers.size, 0)
  assert.equal(env.win.MAO_PET.status().phase, 'error')
  await env.controlOptions().onRetry()
  assert.equal(env.win.MAO_PET.status().phase, 'ready'); assert.equal(env.created.models.length, 2)
})

console.log('\nMao 升级 · 真实日程与冷却')
await test('读日程当前快照免网络请求，编辑完成触发一次庆祝并克隆输入', async () => {
  const env = boot(), tasks = [{ id: 'one', done: false }, { id: 'two', done: false }]
  let requests = 0
  env.win.NOIMPTY_SCHEDULE = { snapshot: () => ({ days: { [todayKey(env)]: tasks } }) }
  env.sandbox.fetch = () => { requests++; throw new Error('snapshot should avoid fetch') }
  await turnOn(env); assert.equal(requests, 0)
  const completed = tasks.map(task => ({ ...task, done: true }))
  emitSchedule(env, completed); flushTyping(env)
  assert.match(env.bubble().textContent, /今天的任务都完成了/)
  assert.equal(env.win.MAO_PET.model().face, env.win.MAO_PET.config().faces['星星眼'])
  completed[0].done = false
  env.win.MAO_PET.say('确认快照'); flushTyping(env)
  assert.equal(env.win.MAO_PET.model().face, env.win.MAO_PET.config().faces['笑'])
})
await test('反复取消/完成有一分钟冷却，远端同步与安静模式不庆祝', async () => {
  const env = boot(); await turnOn(env)
  const undone = [{ done: false }], done = [{ done: true }]
  emitSchedule(env, undone); emitSchedule(env, done)
  const first = env.timers.interval.length
  emitSchedule(env, undone); emitSchedule(env, done)
  assert.equal(env.timers.interval.length, first)
  env.advance(60001); emitSchedule(env, undone); emitSchedule(env, done)
  assert.equal(env.timers.interval.length, first + 1)
  const second = env.timers.interval.length
  env.advance(60001); emitSchedule(env, undone); emitSchedule(env, done, 'remote')
  assert.equal(env.timers.interval.length, second)
  env.win.MAO_PET.configure({ quiet: true })
  emitSchedule(env, undone); emitSchedule(env, done)
  assert.equal(env.timers.interval.length, second)
})
await test('锁住或聊天忙碌时日程更新不会抢话、庆祝或泄露任务状态', async () => {
  const env = boot(); await turnOn(env)
  emitSchedule(env, [{ done: false }]); emitChat(env, 'thinking')
  emitSchedule(env, [{ done: true }])
  assert.equal(env.bubble().textContent, '在想了喵…')
  emitChat(env, 'idle')
  env.win.NOIMPTY_GATE = { unlocked: () => false }
  emitSchedule(env, [{ done: true, autoWhy: '你发了私密文章' }])
  env.win.NOIMPTY_GATE = { unlocked: () => true }
  env.win.MAO_PET.say('检查锁后状态')
  assert.equal(env.win.MAO_PET.model().face, env.win.MAO_PET.config().faces['平静'])
})


console.log('\nMao 升级 · 后台与交错完成竞态')
await test('真实语音情绪枚举映射到表情，低强度回归平静', async () => {
  const env = boot(), v = fakeVoice(env); await turnOn(env)
  const m = env.win.MAO_PET.model(), faces = env.win.MAO_PET.config().faces
  for (const [emotion, expected] of Object.entries({ joy: '笑', sadness: '难过', comfort: '闭眼', surprise: '星星眼', serious: '平静', embarrassed: '脸红', teasing: '笑', annoyed: '生气' })) {
    v.emit({ id: 'emotions', priority: 'manual', phase: 'playing', emotion, intensity: .8 })
    assert.equal(m.face, faces[expected], emotion)
  }
  v.emit({ id: 'emotions', priority: 'manual', phase: 'playing', emotion: 'surprise', intensity: .1 })
  assert.equal(m.face, faces['平静'])
})
await test('重新开启联动和后台返回立即读取现有播放状态，不重复订阅或朗读', async () => {
  const env = boot(), v = fakeVoice(env), { params } = await turnOn(env)
  const pet = env.win.MAO_PET, mouth = pet.config().mouthParam
  v.setEnergy(.2); pet.configure({ chatSync: false })
  v.current({ id: 'already-playing', priority: 'manual', phase: 'playing', text: '已经在播放', emotion: 'joy', intensity: .8 })
  pet.configure({ chatSync: true })
  assert.equal(env.bubble().textContent, '已经在播放'); assert.ok(params.get(mouth) > 0)
  env.document.hidden = true; env.docListeners.get('visibilitychange')()
  assert.equal(params.get(mouth), 0)
  env.document.hidden = false; env.docListeners.get('visibilitychange')()
  assert.equal(env.bubble().textContent, '已经在播放'); assert.ok(params.get(mouth) > 0)
  assert.equal(v.subscriptions(), 1); assert.equal(v.spoken.length, 0)
})
await test('门禁关闭后的语音事件不显示文本或动嘴；空状态使旧语音气泡正常收尾', async () => {
  const env = boot(), v = fakeVoice(env), { params } = await turnOn(env)
  v.setEnergy(.2); v.emit({ id: 'public', priority: 'manual', phase: 'playing', text: '刚才的播报' })
  v.emit(null); env.fireTimeout(env.win.MAO_PET.config().speakMs)
  assert.equal(env.bubble().dataset.on, undefined)
  env.win.NOIMPTY_GATE = { unlocked: () => false }
  v.emit({ id: 'secret', priority: 'manual', phase: 'playing', text: '不该显示的文本' })
  assert.equal(env.bubble().dataset.on, undefined)
  assert.notEqual(env.bubble().textContent, '不该显示的文本')
  assert.equal(params.get(env.win.MAO_PET.config().mouthParam), 0)
})
await test('关闭互动语音立即停止 Mao 当前播放，外部聊天朗读不被取消', async () => {
  const env = boot(), v = fakeVoice(env), { params } = await turnOn(env)
  const pet = env.win.MAO_PET
  pet.voice(true); v.emit({ id: v.id(), priority: 'pet', phase: 'playing' })
  const before = v.stopped(); pet.voice(false)
  assert.equal(v.stopped(), before + 1); assert.equal(params.get(pet.config().mouthParam), 0)
  v.emit({ id: 'external', priority: 'manual', phase: 'playing', text: '外部语音' })
  const externalStops = v.stopped(); pet.voice(false)
  assert.equal(v.stopped(), externalStops)
})
await test('忙碌时双击仍能打开聊天，不被第一下的快捷卡吞掉', async () => {
  const env = boot(); let opens = 0
  env.win.NANALY = { open: () => { opens++ } }; await turnOn(env)
  emitChat(env, 'thinking')
  const tap = env.win.MAO_PET.model().handlers.get('pointertap')
  tap(); env.advance(100); tap()
  assert.equal(env.controlCalls.showActions, 1); assert.equal(opens, 1)
})
await test('后台开始的新轮在前台恢复流式，旧轮完成不覆盖；后台已完成不重新展示', async () => {
  const env = boot(); let current = null
  env.win.NANALY = { chatState: () => current }; await turnOn(env)
  emitChat(env, 'thinking', 'old')
  env.document.hidden = true; env.docListeners.get('visibilitychange')()
  emitChat(env, 'thinking', 'new')
  current = { phase: 'streaming', turnId: 'new', text: '前台接着显示' }
  emitChat(env, 'streaming', 'new', current.text)
  assert.equal(env.bubble().dataset.on, undefined)
  env.document.hidden = false; env.docListeners.get('visibilitychange')()
  assert.equal(env.bubble().textContent, '前台接着显示')
  emitChat(env, 'complete', 'old', '旧轮迟到'); assert.equal(env.bubble().textContent, '前台接着显示')
  env.document.hidden = true; env.docListeners.get('visibilitychange')()
  current = { phase: 'complete', turnId: 'new', text: '后台已完成' }
  emitChat(env, 'complete', 'new', current.text)
  env.document.hidden = false; env.docListeners.get('visibilitychange')()
  assert.equal(env.bubble().dataset.on, undefined)
})
await test('超时旧模型晚于新模型完成时，只销毁旧模型，不销毁新模型共享贴图', async () => {
  const env = boot({ delayModel: true, sharedTextures: true }); env.armLibs()
  const first = env.win.MAO_PET.show()
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  env.fireTimeout(30000); await first
  const retry = env.win.MAO_PET.retry(); await tick()
  env.releaseModel(1); await retry
  env.releaseModel(0); await tick()
  assert.equal(env.created.models[0].destroyCount, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(env.created.models[0].destroyOptions)), { children: true, texture: false, baseTexture: false })
  assert.equal(env.created.models[1].destroyCount || 0, 0)
  assert.equal(env.textures[0].destroyCalls.length, 0)
  await env.win.MAO_PET.hide()
  assert.deepEqual(env.textures[0].destroyCalls, [true])
})
await test('新模型仍加载时旧模型先返回，不释放共享贴图；最终全部取消后只释放一次', async () => {
  const env = boot({ delayModel: true, sharedTextures: true }); env.armLibs()
  const first = env.win.MAO_PET.show()
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  await env.win.MAO_PET.hide(); await first
  const retry = env.win.MAO_PET.show(); await tick()
  env.releaseModel(0); await tick()
  assert.equal(env.created.models[0].destroyCount, 1); assert.equal(env.textures[0].destroyCalls.length, 0)
  await env.win.MAO_PET.hide(); await retry
  assert.equal(env.textures[0].destroyCalls.length, 0, '仍有在途模型，不能提前释放它即将使用的纹理')
  env.releaseModel(1); await tick()
  assert.equal(env.created.models[1].destroyCount, 1)
  assert.deepEqual(env.textures[0].destroyCalls, [true])
  await env.win.MAO_PET.hide(); assert.deepEqual(env.textures[0].destroyCalls, [true])
})


await test('加载模型期间视口变窄，首次完成同步 stage 与 renderer 为当前紧凑尺寸', async () => {
  const env = boot({ delayModel: true, settingsSaved: null, innerWidth: 1440 }); env.armLibs()
  const loading = env.win.MAO_PET.show()
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  assert.equal(env.created.apps[0].opts.width, 380, '应用最初按桌面视口创建')
  env.win.innerWidth = 390
  env.releaseModel(); await loading
  assert.equal(env.stage().dataset.compact, '1')
  assert.equal(env.stage().style.width, '88px'); assert.equal(env.stage().style.height, '88px')
  assert.deepEqual(env.created.apps[0].resizes.at(-1), [88, 88])
  assert.match(env.stage().querySelector('canvas').style.clipPath, /^circle/)
})


await test('新文章从未发布转为已发布可庆祝；初次加载不庆祝，且共用任务完成冷却', async () => {
  const env = boot(); await turnOn(env)
  const noPost = [{ id: 'article', done: false }, { id: 'remaining', done: false }]
  const published = [{ id: 'article', done: true, autoWhy: '你发了《新文章》' }, { id: 'remaining', done: false }]
  emitSchedule(env, noPost, 'load')
  const beforeLoad = env.timers.interval.length
  emitSchedule(env, published, 'load')
  assert.equal(env.timers.interval.length, beforeLoad, '初次加载已有文章不应庆祝')
  emitSchedule(env, noPost, 'remote'); emitSchedule(env, published, 'remote')
  flushTyping(env)
  assert.equal(env.bubble().textContent, '今天又留下了一篇记录喵。')
  assert.equal(env.win.MAO_PET.model().face, env.win.MAO_PET.config().faces['星星眼'])
  const first = env.timers.interval.length
  emitSchedule(env, published, 'remote')
  emitSchedule(env, noPost, 'remote'); emitSchedule(env, published, 'remote')
  emitSchedule(env, published.map(task => ({ ...task, done: true })), 'edit')
  assert.equal(env.timers.interval.length, first, '重复发布和任务完成共享同一个一分钟冷却')
  env.advance(60001); emitSchedule(env, noPost, 'remote'); emitSchedule(env, published, 'remote')
  assert.equal(env.timers.interval.length, first + 1)
})

console.log(`\n${passed} 项通过`)
