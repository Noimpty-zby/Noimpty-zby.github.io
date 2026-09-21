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

const base = fileURLToPath(new URL('../../', import.meta.url))
const petSource = readFileSync(path.join(base, 'source/js/mao-pet.js'), 'utf8')
const model = JSON.parse(readFileSync(path.join(base, 'source/live2d/mao/mao_pro.model3.json'), 'utf8'))

let passed = 0
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name + '\n', error) }
}

// ────────────────── 一个够跑这段脚本的浏览器 ──────────────────

const boot = ({ saved = null, innerWidth = 1440, failAt = null, dpr = 2 } = {}) => {
  const doc = new Map()          // 事件类型 → 回调
  const win = new Map()
  const store = new Map(saved === null ? [] : [['nanaly-pet-visible', saved]])
  const attached = new Set()
  const scripts = []
  const timers = { interval: [], timeout: [] }
  const created = { apps: [], models: [] }
  let pending = null
  /* 双击判定按 Date.now() 的间隔算，真表没法测「两下隔了 400ms」这种情况 ——
   * 给沙箱一块自己能拨的表，测试想隔多久就隔多久。 */
  let clock = 1_700_000_000_000

  const make = tag => ({
    tagName: tag.toUpperCase(), dataset: {}, innerHTML: '', textContent: '',
    parentElement: null, style: { cssText: '' }, attrs: new Map(), handlers: new Map(),
    setAttribute(k, v) { this.attrs.set(k, v) },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null },
    addEventListener(t, fn) { this.handlers.set(t, fn) },
    removeEventListener(t) { this.handlers.delete(t) },
    fire(t, e) { const fn = this.handlers.get(t); return fn && fn(e) },
    appendChild(c) { c.parentElement = this; attached.add(c); return c },
    remove() { attached.delete(this) },
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
    innerWidth, devicePixelRatio: dpr, localStorage,
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
  vm.runInNewContext(petSource, sandbox)

  const stage = () => [...attached].find(n => n.id === 'mao-stage')
  return {
    win: window_, document, scripts, timers, created, stage,
    docListeners: doc, winListeners: win,
    advance: ms => { clock += ms },
    clockNow: () => clock,
    stored: () => (store.has('nanaly-pet-visible') ? store.get('nanaly-pet-visible') : null),
    button: () => document.getElementById('mao-toggle'),
    bubble: () => [...attached].find(n => n.id === 'mao-bubble'),
    detachStage: () => { const s = stage(); if (s) attached.delete(s) },
    // 三份运行时只在脚本「跑完」的那一刻才出现，提前塞等于绕过「到底插没插 script」
    armLibs: () => {
      const params = new Map()
      pending = () => {
        window_.Live2DCubismCore = {}
        window_.PIXI = {
          Application: class {
            constructor (opts) { this.opts = opts; this.stage = { addChild: () => {} }; this.renderer = { resize: () => {} }; created.apps.push(this) }
            destroy (...a) { this.destroyed = a }
          },
          live2d: {
            Live2DModel: {
              from: async (path_, opts) => {
                if (failAt === 'model') throw new Error('模型没取到')
                const m = {
                  path: path_, opts, scale: { set: v => { m.scaleValue = v } },
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
                  motion: g => { m.played = g },
                  expression: id => { m.face = id; (m.faces = m.faces || []).push(id) },
                  destroy: () => { m.destroyed = true }
                }
                created.models.push(m)
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
        if (scripts.filter(x => !x.onload).length === 3 && pending) { pending(); pending = null }
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

await test('★★ 加载中途按第二下不会建出第二个她', async () => {
  const env = boot()
  const { created } = env.armLibs()
  const first = env.button().fire('click')
  env.button().fire('click')
  for (let i = 0; i < 12; i++) { env.resolveScripts(); await tick() }
  await first
  assert.equal(created.models.length, 1)
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

console.log(`\n${passed} 项通过`)
