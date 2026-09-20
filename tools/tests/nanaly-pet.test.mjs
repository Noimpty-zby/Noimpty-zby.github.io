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
const petSource = readFileSync(path.join(base, 'source/js/nanaly-pet.js'), 'utf8')
const model = JSON.parse(readFileSync(path.join(base, 'source/live2d/mao/mao_pro.model3.json'), 'utf8'))

let passed = 0
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name + '\n', error) }
}

// ────────────────── 一个够跑这段脚本的浏览器 ──────────────────

const boot = ({ saved = null, innerWidth = 1440, failAt = null } = {}) => {
  const doc = new Map()          // 事件类型 → 回调
  const win = new Map()
  const store = new Map(saved === null ? [] : [['nanaly-pet-visible', saved]])
  const attached = new Set()
  const scripts = []
  const timers = { interval: [], timeout: [] }
  const created = { apps: [], models: [] }
  let pending = null

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
    innerWidth, devicePixelRatio: 2, localStorage,
    addEventListener: (t, fn) => win.set(t, fn),
    removeEventListener: t => win.delete(t)
  }

  const sandbox = {
    window: window_, document, localStorage,
    console: { warn: () => {} },
    Math, JSON, Object, Number, String, Set, Map, Promise, Error, Array, Boolean,
    requestAnimationFrame: fn => { fn(); return 1 },
    setInterval: (fn, ms) => { timers.interval.push({ fn, ms }); return timers.interval.length },
    clearInterval: id => { if (id) timers.interval[id - 1] = null },
    setTimeout: (fn, ms) => { timers.timeout.push({ fn, ms }); return timers.timeout.length },
    clearTimeout: id => { if (id) timers.timeout[id - 1] = null }
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(petSource, sandbox)

  const stage = () => [...attached].find(n => n.id === 'nanaly-pet-stage')
  return {
    win: window_, document, scripts, timers, created, stage,
    docListeners: doc, winListeners: win,
    stored: () => (store.has('nanaly-pet-visible') ? store.get('nanaly-pet-visible') : null),
    button: () => document.getElementById('nanaly-pet-toggle'),
    bubble: () => [...attached].find(n => n.id === 'nanaly-pet-bubble'),
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
                    coreModel: { setParameterValueById: (id, v) => params.set(id, v) }
                  },
                  on: (t, fn) => m.handlers.set(t, fn), handlers: new Map(),
                  // 包围盒：画布 300×380 里她占中间那一块
                  getBounds: () => ({ x: 50, y: 20, width: 220, height: 360 }),
                  eventMode: 'auto',
                  motion: g => { m.played = g }, destroy: () => { m.destroyed = true }
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
  assert.equal(env.win.NANALY_PET.visible(), false)
})

await test('★★ 模型加载失败要把已经建好的画布收掉，不留一块空的', async () => {
  const env = boot({ failAt: 'model' })
  await turnOn(env)
  assert.equal(env.win.NANALY_PET.visible(), false)
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
  env.win.NANALY_PET.say('喵')
  assert.equal(bubble.dataset.on, '1', '气泡该露出来')
  const typing = env.timers.interval.filter(Boolean).pop()
  typing.fn(); assert.equal(bubble.textContent, '喵')
  const mouth = env.win.NANALY_PET.config().mouthParam
  assert.equal(params.get(mouth), 0, '最后一个字落地时嘴该闭上')

  env.win.NANALY_PET.say('喵喵')
  env.timers.interval.filter(Boolean).pop().fn()
  assert.ok(params.get(mouth) > 0, '还在说的时候嘴得是张开的')

  env.timers.timeout.filter(Boolean).pop().fn()
  assert.equal(bubble.dataset.on, undefined, '说完气泡要收回去')
  assert.equal(params.get(mouth), 0, '收回去之后嘴必须闭上，不能停在半张')
})

await test('★★ 一句还没说完又来一句，不能两个打字器一起往上写', async () => {
  const env = boot()
  await turnOn(env)
  env.win.NANALY_PET.say('前一句')
  const before = env.timers.interval.filter(Boolean).length
  env.win.NANALY_PET.say('后一句')
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
  const css = readFileSync(path.join(base, 'source/css/nanaly-pet.css'), 'utf8')
  for (const cls of used)
    assert.ok(css.includes('.' + cls), `图标用了 .${cls}，但 nanaly-pet.css 里没这个选择器`)
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
  assert.equal(m.played, env.win.NANALY_PET.config().tapGroup, '没播动作')
  assert.equal(env.bubble().dataset.on, '1', '没说话')
  const lines = env.win.NANALY_PET.config().tapLines
  env.timers.interval.filter(Boolean).pop().fn()
  assert.ok(lines.some(l => l.startsWith(env.bubble().textContent)), '说的不是被戳时那几句')
})

await test('★★ 双击开对话窗时，要把单击那句话收回去', async () => {
  /* 双击会先走一次单击，不收的话对话窗开了、她头顶还挂着句“干嘛戳我”。 */
  const env = boot()
  const { created } = await turnOn(env)
  let opened = 0
  env.win.NANALY = { open: () => { opened++ } }
  created.models[0].handlers.get('pointertap')()
  assert.equal(env.bubble().dataset.on, '1')
  env.stage().querySelector('canvas').fire('dblclick')
  assert.equal(opened, 1, '没把对话窗叫出来')
  assert.equal(env.bubble().dataset.on, undefined, '气泡还挂着')
  assert.ok(env.timers.interval.filter(Boolean).length === 1, '打字器没停，只该剩那个循环说话的')
})

await test('★★ 画布要按她的身体裁，旁边的空白不能拦点击', async () => {
  /* 她站右下角，画布比她大一圈 —— 不裁的话那圈透明的地方会把
   * 底下卡片的点击吃掉。clip-path 连命中判定一起裁，触屏上也算数。 */
  const env = boot()
  await turnOn(env)
  const clip = env.stage().querySelector('canvas').style.clipPath
  assert.ok(clip && clip.startsWith('inset('), '没给画布裁形：' + clip)
  // 壳里的包围盒是 x50 y20 w220 h360，画布 300×380，留 6px 富余
  const nums = clip.match(/-?[\d.]+/g).map(Number)
  assert.deepEqual(nums, [14, 24, 0, 44], '裁出来的边距和包围盒对不上：' + clip)
})

await test('★ Butterfly 右侧那竖按钮要抬到她之上，不然回顶点不到', () => {
  const css = readFileSync(path.join(base, 'source/css/nanaly-pet.css'), 'utf8')
  const hit = css.match(/#rightside\s*\{[^}]*z-index:\s*(\d+)/)
  assert.ok(hit, 'nanaly-pet.css 里没把 #rightside 抬上去')
  const petZ = Number(boot().win.NANALY_PET.config().zIndex)
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

await test('★★ 窄屏上不许糊一脸：画布不超过视口宽度的 44%', async () => {
  for (const [width, expected] of [[1440, 300], [800, 300], [600, 264], [390, 172]]) {
    const env = boot({ innerWidth: width })
    const { created } = await turnOn(env)
    assert.equal(created.apps[0].opts.width, expected, `视口 ${width}px 时画布宽该是 ${expected}px`)
    assert.ok(created.apps[0].opts.width <= Math.max(150, width * 0.44) + 1)
  }
})

await test('★ 横向落点要听 CONFIG.anchorX 的', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  const { anchorX } = env.win.NANALY_PET.config()
  assert.equal(created.models[0].pos[0], created.apps[0].opts.width * anchorX)
  assert.equal(created.models[0].pos[1], created.apps[0].opts.height, '脚底要贴着下边站住')
})

await test('★★ 按设备像素比渲染，高分屏上她才不是糊的', async () => {
  const env = boot()
  const { created } = await turnOn(env)
  assert.equal(created.apps[0].opts.resolution, 2)
  assert.equal(created.apps[0].opts.autoDensity, true)
  assert.equal(created.apps[0].opts.backgroundAlpha, 0, '背景得是透的，不然她脚下一块方底')
})

await test('★★ 她得压在对话面板和三个按钮下面', async () => {
  const env = boot()
  await turnOn(env)
  const mine = Number(env.win.NANALY_PET.config().zIndex)
  assert.ok(env.stage().style.cssText.includes(`z-index:${mine}`), '层级没写到她那块 DOM 上')
  const css = readFileSync(path.join(base, 'source/css/noimpty-ai.css'), 'utf8')
    + readFileSync(path.join(base, 'source/css/nanaly-pet.css'), 'utf8')
  const others = [...css.matchAll(/z-index:\s*(\d{4,})/g)].map(m => Number(m[1]))
  assert.ok(others.length >= 2, '没从 css 里读到对话窗那几层，这条对比不算数')
  assert.ok(mine < Math.min(...others),
    `她在 ${mine}，对话窗最低那层在 ${Math.min(...others)} —— 会挡在面板前面`)
})

await test('★★ CONFIG 指的模型文件真的在，且它引用的每个文件都在', async () => {
  const env = boot()
  const config = env.win.NANALY_PET.config()
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
  const { idleGroup, tapGroup } = env.win.NANALY_PET.config()
  const groups = Object.keys(model.FileReferences.Motions || {})
  assert.ok(groups.includes(idleGroup), `待机分组 "${idleGroup}" 不在模型里，她会一直杵着不动。有的是：${groups.map(g => JSON.stringify(g))}`)
  assert.ok(groups.includes(tapGroup), `戳她的分组 "${tapGroup}" 不在模型里，点了不会有反应`)
})

await test('★ 嘴型参数得是这个模型 LipSync 组里那个', () => {
  const lip = (model.Groups || []).find(g => g.Name === 'LipSync')
  assert.ok(lip, '模型没有 LipSync 组')
  const env = boot()
  assert.ok(lip.Ids.includes(env.win.NANALY_PET.config().mouthParam),
    `mouthParam 不在 LipSync 组里（组里是 ${lip.Ids.join(', ')}），说话时嘴不会动`)
})

console.log(`\n${passed} 项通过`)
