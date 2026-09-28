// 切页转场「贴纸泡泡」（source/js/page-transition.js）的逻辑测试：在假 DOM 里跑脚本，
// 手动推进动画、帧和定时器。画面效果另用真实浏览器逐帧截图验收，这里管状态和收尾。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/page-transition.js', 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))

class Events {
  constructor() { this.listeners = new Map() }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(callback)
  }
  emit(type, data = {}) {
    for (const callback of [...(this.listeners.get(type) || [])]) callback({ type, ...data })
  }
}

class FakeAnimation {
  constructor(element, keyframes, options) {
    Object.assign(this, { element, keyframes, options, state: 'running' })
    this.finished = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject })
  }
  finish() { if (this.state === 'running') { this.state = 'finished'; this.resolve(this) } }
  cancel() {
    if (this.state === 'running') this.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    this.state = 'cancelled'
  }
}

// 链接：可以带卡片上的角色图标和标题
const anchor = (href, { text = '', icon = '', heading = '', title = '', aria = '' } = {}) => {
  const attributes = { href, title, 'aria-label': aria }
  const iconNode = icon && { getAttribute: name => name === 'class' ? `kw kw--one kw--${icon}` : null }
  const headingNode = heading && { textContent: heading }
  return {
    href: 'http://blog.test' + href, textContent: text,
    getAttribute: name => attributes[name] || null,
    querySelector: selector => selector === 'svg.kw--one' ? iconNode || null : selector.startsWith('h1') ? headingNode || null : null,
    closest: () => null
  }
}

function boot({ reduce = false, animateThrows = false, pjax = true } = {}) {
  const animations = []
  const timers = new Map()
  const frames = []
  const images = []
  let nextTimer = 0
  const make = tag => {
    const attributes = new Map()
    const node = {
      tagName: tag.toUpperCase(), className: '', hidden: false, children: [], parentNode: null, textContent: '', src: '',
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
      removeAttribute: name => attributes.delete(name),
      appendChild(child) { child.parentNode = this; this.children.push(child); return child },
      set innerHTML(_) {},
      get isConnected() { return this.root === true || Boolean(this.parentNode?.isConnected) }
    }
    node.animate = (keyframes, options) => {
      if (animateThrows) throw new Error('Web Animations unavailable')
      const animation = new FakeAnimation(node, keyframes, options)
      animations.push(animation)
      return animation
    }
    return node
  }
  const document = Object.assign(new Events(), {
    hidden: false, readyState: 'complete', createElement: make, querySelectorAll: () => []
  })
  document.body = Object.assign(make('body'), { root: true })
  const reduced = { matches: reduce, addEventListener() {} }
  const handled = []
  const window = Object.assign(new Events(), {
    innerWidth: 1000, innerHeight: 800,
    location: { href: 'http://blog.test/' },
    navigator: {},
    matchMedia: query => query.includes('reduced-motion') ? reduced : { matches: false, addEventListener() {} },
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.push(fn); return frames.length },
    requestIdleCallback: () => 0,
    Image: class { set src(value) { images.push(value) } },
    pjax: pjax ? { handleResponse(...args) { handled.push(args) } } : undefined
  })
  window.window = window
  vm.runInContext(source, vm.createContext({ window, document, URL }))

  const root = () => document.body.children.find(node => node.className === 'noimpty-pt')
  const running = () => animations.filter(animation => animation.state === 'running')
  const app = {
    window, document, animations, timers, images, handled, root, running,
    api: window.__noimptyPageTransition,
    state: () => root()?.getAttribute('data-state') ?? null,
    click(link, x = 120, y = 40, detail = 1) {
      document.emit('click', { target: { closest: () => link }, clientX: x, clientY: y, detail })
    },
    send(link) { document.emit('pjax:send', link ? { triggerElement: link } : {}) },
    complete() { document.emit('pjax:complete') },
    error() { document.emit('pjax:error') },
    // Pjax 在 send 之后才把响应交给 handleResponse
    respond(...args) { window.pjax.handleResponse.apply(window.pjax, args) },
    frames: () => { while (frames.length) frames.shift()() },
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn() } },
    async finishAll() { running().forEach(animation => animation.finish()); await tick(); await tick() }
  }
  return app
}

const settled = app => {
  assert.ok(!app.root() || app.root().hidden, '遮罩收起')
  assert.equal(app.state(), null)
  assert.equal(app.running().length, 0, '没有还在跑的动画')
  assert.equal(app.timers.size, 0, '没有挂着的定时器')
}

test('目的地：顶栏、卡片、文章、子页和不认识的路径', () => {
  const { describe } = boot().api
  assert.deepEqual({ ...describe(anchor('/in-class/', { text: ' core' }), 'http://blog.test/in-class/') }, { character: 'books', label: '自学课内' })
  assert.deepEqual({ ...describe(anchor('/', { text: '首页' }), 'http://blog.test/') }, { character: 'balloon', label: '首页' })
  assert.deepEqual({ ...describe(anchor('/in-class/dsa/', { icon: 'tree', heading: '数据结构与算法', text: '01 数据结构与算法 Abdul Bari' }), 'http://blog.test/in-class/dsa/') },
    { character: 'tree', label: '数据结构与算法' }, '卡片上画的角色和标题优先')
  assert.deepEqual({ ...describe(anchor('/2026/09/26/Linux/', { aria: '阅读：Linux 命令行第七章：cat、less、head、tail' }), 'http://blog.test/2026/09/26/Linux/') },
    { character: 'pencil', label: 'Linux 命令行第七章：cat、…' }, '文章用铅笔，长标题截到 18 个字')
  assert.deepEqual({ ...describe(null, 'http://blog.test/in-class/csapp/') }, { character: 'books', label: '下一页' }, '子页沿用板块的角色')
  assert.deepEqual({ ...describe(null, 'http://blog.test/whatever/') }, { character: 'star', label: '下一页' })
})

test('一次完整的切页：从点击处鼓起、盖满才换页、新页面到了才打开、最后收干净', async () => {
  const app = boot()
  const link = anchor('/in-class/', { text: 'core' })
  app.click(link, 120, 40)
  app.send(link)
  assert.equal(app.root().hidden, false)
  assert.equal(app.state(), 'cover')
  const [mascot, label] = [app.root().children[3].children[1], app.root().children[3].children.at(-2)]
  assert.equal(mascot.src, '/img/kawaii/books.svg')
  assert.equal(label.textContent, '自学课内')
  const waves = app.running().filter(animation => /noimpty-pt__wave/.test(animation.element.className))
  assert.equal(waves.length, 3)
  assert.deepEqual(waves.map(wave => wave.keyframes[0].clipPath),
    ['circle(11.0px at 120.0px 40.0px)', 'circle(8.0px at 120.0px 40.0px)', 'circle(0.0px at 120.0px 40.0px)'], '三层从点击处鼓起，边宽一开始就在')

  // 响应先到：压住，不换页
  app.respond('<html>new</html>', { status: 200 })
  await tick()
  assert.equal(app.handled.length, 0, '底色没盖满之前不交给 Pjax 换页')
  waves.at(-1).finish()
  await tick(); await tick()
  assert.equal(app.handled.length, 1, '盖满就放行')
  assert.equal(app.handled[0][0], '<html>new</html>')

  // 换好了，但小角色还没弹完：继续等
  app.complete(); app.frames()
  await tick()
  assert.equal(app.state(), 'cover')
  await app.finishAll()
  assert.equal(app.state(), 'reveal', '三件事都齐了才打开')
  const closing = app.running()
  assert.equal(closing.filter(animation => /wave/.test(animation.element.className)).every(animation => /^circle\(0\.0px at 500\.0px 376\.0px\)$/.test(animation.keyframes.at(-1).clipPath)), true, '收拢到小角色中心')
  await app.finishAll()
  settled(app)
})

test('Pjax 报错：不打开旧页面，等主题整页跳转；4 秒后还没走才撤', async () => {
  const app = boot()
  app.send(anchor('/life/'))
  await app.finishAll()
  app.complete(); app.error(); app.frames()
  await tick()
  assert.equal(app.state(), 'cover', '报错那次 complete 不算数')
  app.fire(4000)
  assert.equal(app.state(), null)
  settled(app)
})

test('404：主题在同一层遮罩下接着请求 404 页，等它到了再打开', async () => {
  const app = boot()
  app.send(anchor('/no-such-page/'))
  await app.finishAll()
  app.complete(); app.error(); app.send() // 主题的 pjax:error 处理里马上 loadUrl('/404')
  app.frames()
  await tick()
  assert.equal(app.state(), 'cover', '坏页面那次 complete 不能把旧页面露出来')
  app.complete(); app.frames()
  await app.finishAll()
  assert.equal(app.state(), 'reveal')
  await app.finishAll()
  settled(app)
})

test('盖着的时候又点了别的链接：旧响应丢掉，按新的来', async () => {
  const app = boot()
  app.send(anchor('/life/'))
  app.respond('old')
  app.send(anchor('/extra/')) // 还在 cover，接着用这层遮罩
  app.respond('new')
  await app.finishAll()
  assert.deepEqual(app.handled.map(args => args[0]), ['new'], '旧页面的响应不再换进来')
  app.complete(); app.frames()
  await app.finishAll(); await app.finishAll()
  settled(app)
})

test('打开的时候又点：重新盖上，不留半截动画', async () => {
  const app = boot()
  app.send(anchor('/life/'))
  await app.finishAll()
  app.complete(); app.frames()
  await app.finishAll()
  assert.equal(app.state(), 'reveal')
  app.send(anchor('/extra/'))
  assert.equal(app.state(), 'cover')
  assert.equal(app.animations.filter(animation => animation.state === 'running').length, 4, '只剩新的三层泡泡和小角色')
  app.complete(); app.frames()
  await app.finishAll(); await app.finishAll()
  settled(app)
})

test('卡住 10 秒：撤掉遮罩，压着的响应照样放行', async () => {
  const app = boot()
  app.send(anchor('/life/'))
  app.respond('late')
  app.fire(10000)
  await tick(); await tick()
  assert.deepEqual(app.handled.map(args => args[0]), ['late'], '撤掉遮罩后页面照样能换')
  settled(app)
})

test('减少动态效果：不出遮罩，也不压 Pjax 的响应', () => {
  const app = boot({ reduce: true })
  app.send(anchor('/life/'))
  assert.equal(app.root(), undefined)
  app.respond('page')
  assert.equal(app.handled.length, 1)
})

test('动画接口抛异常：直接撤掉，导航照常', () => {
  const app = boot({ animateThrows: true })
  app.send(anchor('/life/'))
  app.respond('page')
  assert.equal(app.handled.length, 1)
  settled(app)
})

test('键盘回车从正中鼓起；后退按地址认目的地；代码跳页是通用的星星', () => {
  const app = boot()
  const link = anchor('/life/', { text: 'life' })
  app.click(link, 0, 0, 0)
  app.send(link)
  const wave = app.running().find(animation => /wave--fill/.test(animation.element.className))
  assert.equal(wave.keyframes[0].clipPath, 'circle(0.0px at 500.0px 400.0px)')
  app.api.reset()

  app.window.location.href = 'http://blog.test/news/' // popstate：地址先变
  app.send()
  const mascot = app.root().children[3].children[1]
  assert.equal(mascot.src, '/img/kawaii/newspaper.svg')
  app.complete(); app.api.reset()

  app.send() // 地址没变：主题或助手用 loadUrl 跳页
  assert.equal(mascot.src, '/img/kawaii/star.svg')
  app.api.reset()
  settled(app)
})

test('pageshow（从往返缓存回来）把遮罩收掉', () => {
  const app = boot()
  app.send(anchor('/life/'))
  app.window.emit('pageshow')
  settled(app)
})
