/* 页脚时间胶囊的日期数学。
 *
 * 「已经三个月零几天」这种话，是最容易写错又最不容易被发现的东西 ——
 * 页面上永远显示着一个看起来挺像样的数字，错了也不会报错。所以这里不靠
 * 挑几个例子对答案，而是拿一条**可逆性**当主检：把算出来的
 * 年/月/日/时/分/秒 依次加回起点，必须一秒不差地回到终点。
 * 借位只要错一天，这条立刻崩。
 *
 * 顺带钉住两个具体的坑：
 *   1. 1 月 31 日 → 3 月 1 日。逐位相减再借一个二月仍然是负数，
 *      朴素的借位算法在这里会给出负的天数。
 *   2. 1 月 31 日 + 1 个月。不夹日号的话 Date 会顺延到 3 月 3 日。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../source/js/site-clock.js', import.meta.url), 'utf8')
const win = {}
// mount() 找不到页脚就会自己退出，这里只要它别抛异常
vm.runInNewContext(source, {
  window: win, Date, Number, String, Object,
  document: { readyState: 'complete', querySelector: () => null, getElementById: () => null, addEventListener() {} }
})
const C = win.NOIMPTY_CLOCK

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name) }
const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s)
/* vm 里造出来的对象带的是另一个 realm 的原型，deepStrictEqual 会因此判不等。
 * 摊回宿主这边再比，比的才是内容。 */
const age = (from, to) => ({ ...C.elapsed(from, to) })

/* 把差值加回去，看能不能原样回到终点。加的顺序和 elapsed 拆的顺序一致：
 * 先整月（带夹日号），再按毫秒补天时分秒。 */
const rebuild = (from, age) =>
  new Date(C.addMonths(from, age.y * 12 + age.mo).getTime()
    + ((age.d * 24 + age.h) * 60 + age.mi) * 60000 + age.s * 1000)

console.log('\n时间胶囊 · 月份推进')

test('★★ 加月份时日号要夹到当月最后一天，不能顺延到下个月', () => {
  assert.equal(+C.addMonths(at(2026, 1, 31), 1), +at(2026, 2, 28), '1 月 31 日 + 1 个月应是 2 月 28 日')
  assert.equal(+C.addMonths(at(2024, 1, 31), 1), +at(2024, 2, 29), '闰年要落在 2 月 29 日')
  assert.equal(+C.addMonths(at(2026, 3, 31), 1), +at(2026, 4, 30))
  assert.equal(+C.addMonths(at(2026, 12, 15), 1), +at(2027, 1, 15), '跨年份要正确进位')
  assert.equal(+C.addMonths(at(2026, 5, 30, 16, 43, 3), 12), +at(2027, 5, 30, 16, 43, 3), '时分秒不该被动过')
})

console.log('\n时间胶囊 · 差值可逆')

test('★★ 任取一对时刻，拆出来的差值加回去必须一秒不差地回到终点', () => {
  const from = at(2026, 5, 30, 16, 43, 3)
  const spots = [
    at(2026, 5, 30, 16, 43, 4), at(2026, 6, 1), at(2026, 6, 29, 16, 43, 2),
    at(2026, 6, 30, 16, 43, 3), at(2026, 9, 20, 15, 42, 7), at(2027, 2, 28, 23, 59, 59),
    at(2028, 2, 29, 0, 0, 1), at(2030, 12, 31, 23, 59, 59), at(2036, 5, 30, 16, 43, 3)
  ]
  for (const to of spots) {
    const age = C.elapsed(from, to)
    assert.equal(+rebuild(from, age), +to, `${to.toISOString()} 加不回去 —— 借位错了：${JSON.stringify(age)}`)
    assert.ok(age.d < 32 && age.h < 24 && age.mi < 60 && age.s < 60 && age.mo < 12,
      '各位必须已经进位完：' + JSON.stringify(age))
    assert.ok(Object.values(age).every(n => n >= 0), '不许出现负数：' + JSON.stringify(age))
  }
})

test('★★ 每个月的 31 号起算都要可逆（朴素借位就是死在这批上）', () => {
  for (const startMonth of [1, 3, 5, 7, 8, 10, 12])
    for (let step = 1; step <= 400; step += 7) {
      const from = at(2026, startMonth, 31, 23, 59, 59)
      const to = new Date(from.getTime() + step * 86400000 + 1000)
      const age = C.elapsed(from, to)
      assert.equal(+rebuild(from, age), +to, `${startMonth} 月 31 日 + ${step} 天不可逆`)
      assert.ok(age.d >= 0, `${startMonth} 月 31 日 + ${step} 天算出了负的天数`)
    }
})

test('★★ 逐秒推进时不许倒退，也不许跳过', () => {
  // 跨月边界一秒一秒走，总秒数必须严格递增 1
  const from = at(2026, 1, 31, 12, 0, 0)
  let prev = -1
  for (let i = 0; i < 400; i++) {
    const to = new Date(at(2026, 2, 28, 23, 59, 30).getTime() + i * 1000)
    const total = Math.floor((to - from) / 1000)
    assert.equal(total, prev < 0 ? total : prev + 1, '测试自身的步进坏了')
    prev = total
    const age = C.elapsed(from, to)
    assert.equal(+rebuild(from, age), +to, '跨 2→3 月边界时不可逆')
  }
})

console.log('\n时间胶囊 · 边界与文案')

test('★ 终点早于起点、无效日期都归零，不显示负数', () => {
  for (const bad of [[at(2026, 9, 1), at(2026, 8, 1)], [new Date('x'), at(2026, 9, 1)],
    [at(2026, 9, 1), new Date('x')], ['不是日期', at(2026, 9, 1)]])
    assert.deepEqual(age(bad[0], bad[1]), { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 })
  assert.deepEqual(age(at(2026, 9, 1), at(2026, 9, 1)), { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 })
})

test('★★ 开头的零位不念出来，秒永远保留', () => {
  assert.equal(C.formatAge({ y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 7 }), '7 秒')
  assert.equal(C.formatAge({ y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 }), '0 秒', '刚上线那一刻也要有话说')
  assert.equal(C.formatAge({ y: 0, mo: 3, d: 21, h: 22, mi: 59, s: 4 }), '3 个月 21 天 22 小时 59 分 4 秒')
  assert.equal(C.formatAge({ y: 1, mo: 0, d: 0, h: 5, mi: 0, s: 2 }), '1 年 0 个月 0 天 5 小时 0 分 2 秒',
    '中间的零要留着，只砍开头的')
  assert.doesNotMatch(C.formatAge({ y: 0, mo: 0, d: 2, h: 0, mi: 0, s: 0 }), /^0/)
})

test('★ 当下那一行：星期对得上，时分秒补零', () => {
  const noon = C.formatNow(at(2026, 9, 20, 9, 5, 3))
  assert.equal(noon.date, '2026 年 9 月 20 日')
  assert.equal(noon.week, '周日', '2026-09-20 是周日')
  assert.deepEqual([noon.hh, noon.mm, noon.ss], ['09', '05', '03'], '个位数必须补零，否则每天有几小时整块牌是抖的')
  const midnight = C.formatNow(at(2026, 1, 1, 0, 0, 0))
  assert.deepEqual([midnight.hh, midnight.mm, midnight.ss], ['00', '00', '00'])
  assert.equal(C.formatNow(at(2026, 12, 31, 23, 59, 59)).week, '周四')
})

console.log('\n时间胶囊 · 生日')

test('★★ 生日写成带时区的字面量，不随构建机器的时区漂移', () => {
  assert.equal(C.BIRTH.toISOString(), '2026-05-30T08:43:03.000Z', '东八区 16:43:03 就是 UTC 08:43:03')
  assert.match(readFileSync(new URL('../../source/js/site-clock.js', import.meta.url), 'utf8'),
    /new Date\('2026-05-30T16:43:03\+08:00'\)/, '一旦写成不带时区的字符串，换台机器就整体偏移')
  // 生日必须对得上第一篇文章，不然「小站活了多久」是个编出来的数
  assert.match(readFileSync(new URL('../../source/_posts/my-first-post.md', import.meta.url), 'utf8'),
    /^date: 2026-05-30 16:43:03$/m, '第一篇文章的日期变了，生日要跟着改')
})

console.log('\n时间胶囊 · 真的挂得上去')

/* 够用就好的 DOM：只实现 mount() 真正碰到的那几样。
 * 时钟可控 —— 秒针要能一秒一秒推着走，才验得出「跳了没」「停没停」。 */
class Node2 {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = new Map(); this._text = '' }
  // SVG 那边是 setAttribute('class', …) 设的，className 必须和它是同一份
  get className() { return this.getAttribute('class') || '' }
  set className(v) { this.setAttribute('class', v) }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text }
  set textContent(v) { this._text = String(v); this.children = [] }
  setAttribute(k, v) { this.attrs.set(k, String(v)) }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null }
  // 真实 DOM 里 el.id = 'x' 会反射成属性，垫片不照做就测不出真行为
  get id() { return this.getAttribute('id') || '' }
  set id(v) { this.setAttribute('id', v) }
  append(...n) { this.children.push(...n) }
  prepend(...n) { this.children.unshift(...n) }
  get dataset() {
    const self = this
    return new Proxy({}, { set: (_t, k, v) => (self.setAttribute('data-' + k, v), true),
      get: (_t, k) => self.getAttribute('data-' + k) })
  }
  all() { return this.children.flatMap(c => [c, ...c.all()]) }
  querySelectorAll(sel) {
    const attr = sel.match(/^\[([\w-]+)\]$/)
    if (attr) return this.all().filter(n => n.getAttribute(attr[1]) !== null)
    if (sel.startsWith('#')) return this.all().filter(n => n.id === sel.slice(1))
    return this.all().filter(n => n.className.split(/\s+/).includes(sel.slice(1)))
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
}

/* 锚点用本地时间分量，不用带时区的字面量。
 * 时间牌按访客本机时区显示（设计如此），拿一个绝对时刻当锚点的话，
 * 断言出来的时分秒会跟着跑测试那台机器的时区变 —— 本地绿、CI（UTC）红。 */
const bootDom = (startMs = at(2026, 9, 20, 15, 42, 7).getTime(), { built = true } = {}) => {
  let nowMs = startMs
  const pending = []
  class FakeDate extends Date {
    constructor(...a) { a.length ? super(...a) : super(nowMs) }
    static now() { return nowMs }
    static parse(...a) { return Date.parse(...a) }
  }
  /* 照着 section-hub.js 搭出来的真实那一列：
   * 问候语 / 大标题 / 副标题 / 按钮。时间牌要落在标题和副标题之间。 */
  const hero = new Node2('div'); hero.id = 'site-info'
  const greeting = new Node2('p'); greeting.className = 'sakura-greeting'
  const title = new Node2('h1'); title.id = 'site-title'
  title.after = node => hero.children.splice(hero.children.indexOf(title) + 1, 0, node)
  const subtitle = new Node2('p'); subtitle.id = 'site-subtitle'
  const actions = new Node2('div'); actions.className = 'sakura-hero-actions'
  // built=false 模拟 section-hub 还没跑到 append 副标题那一步
  hero.append(greeting, title)
  if (built) hero.append(subtitle, actions)
  const finishHub = () => hero.append(subtitle, actions)
  const listeners = {}
  const doc = {
    readyState: 'complete', hidden: false,
    createElement: t => new Node2(t),
    createElementNS: (_ns, t) => new Node2(t),
    querySelector: sel => sel.includes('site-info') ? hero : null,
    getElementById: id => hero.all().find(n => n.id === id) || null,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn) },
    removeEventListener: (t, fn) => { const a = listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) }
  }
  const win = { addEventListener: () => {}, removeEventListener: () => {} }
  vm.runInNewContext(source, {
    window: win, document: doc, Date: FakeDate, Number, String, Object, Math, JSON,
    setTimeout: (fn, ms) => { const id = { fn, ms }; pending.push(id); return id },
    clearTimeout: id => { const i = pending.indexOf(id); if (i >= 0) pending.splice(i, 1) }
  })
  return {
    hero, doc, finishHub, api: win.NOIMPTY_CLOCK, pending, listeners,
    // pjax 换页：整块 hero 被替换，旧的时间牌连同它一起消失
    repaint: () => { hero.children = [greeting, title, subtitle, actions] },
    box: () => hero.children.find(n => n.id === 'noimpty-clock'),
    slot: k => hero.children.find(n => n.id === 'noimpty-clock')
      .querySelectorAll('[data-clock]').find(n => n.getAttribute('data-clock') === k),
    step: seconds => { nowMs += seconds * 1000; const due = pending.splice(0); due.forEach(t => t.fn()) }
  }
}

test('★★ 正好落在大标题和副标题之间', () => {
  const d = bootDom()
  assert.equal(d.hero.children.length, 5, '没挂上去')
  const order = d.hero.children.map(n => n.id || n.className)
  assert.deepEqual(order, ['sakura-greeting', 'site-title', 'noimpty-clock', 'site-subtitle', 'sakura-hero-actions'],
    '顺序不对 —— 它必须夹在标题和副标题之间，上面的标题才会被顶上去、下面两段才会被推下来')
  const box = d.box()
  assert.equal(box.id, 'noimpty-clock')
  assert.equal(box.getAttribute('aria-label'), '站点时间与运行时长')
  for (const k of ['date', 'week', 'hh', 'mm', 'ss', 'age']) assert.ok(d.slot(k), '缺插槽 ' + k)
  assert.equal(box.querySelectorAll('.noimpty-clock__sep').length, 2, '时分秒之间要有两个冒号')
  // 猫耳沿用娜娜莉那张脸的形状，两只耳朵 + 两片内耳
  assert.equal(box.querySelectorAll('.noimpty-clock__ear').length, 2, '缺猫耳')
  assert.equal(box.querySelectorAll('.noimpty-clock__ear-in').length, 2, '缺内耳')
  // 一秒一跳的内容必须对读屏隐藏，否则会一直打断朗读
  assert.equal(box.querySelector('.noimpty-clock__dial').getAttribute('aria-hidden'), 'true')
  assert.equal(box.querySelector('.noimpty-clock__age').getAttribute('aria-hidden'), 'true')
})

test('★★ 首次绘制就有内容，不是先露一个空壳', () => {
  const d = bootDom()
  assert.equal(d.slot('date').textContent, '2026 年 9 月 20 日')
  assert.equal(d.slot('week').textContent, '周日')
  assert.deepEqual([d.slot('hh').textContent, d.slot('mm').textContent, d.slot('ss').textContent], ['15', '42', '07'])
  assert.match(d.slot('age').textContent, /^3 个月 \d+ 天 \d+ 小时 \d+ 分 \d+ 秒$/)
  assert.equal(d.box().getAttribute('data-ready'), '1', '没标 ready 的话 CSS 里它是透明的')
  assert.ok(d.box().querySelector('.noimpty-clock__dial').getAttribute('datetime'), 'time 元素要有机器可读的值')
})

test('★★ 秒针真的走，而且对齐到整秒', () => {
  const d = bootDom(at(2026, 9, 20, 15, 42, 7).getTime() + 400)
  assert.equal(d.pending.length, 1, '第一次绘制后要排下一跳')
  assert.equal(d.pending[0].ms, 600, '应当只等到整秒，而不是死等 1000ms')
  d.step(1)
  assert.equal(d.slot('ss').textContent, '08')
  d.step(52)
  assert.deepEqual([d.slot('mm').textContent, d.slot('ss').textContent], ['43', '00'], '分钟要跟着进位')
})

test('★★ 页面藏起来就停表，回来再走 —— 后台标签页不该每秒醒一次', () => {
  const d = bootDom()
  assert.equal(d.pending.length, 1)
  d.doc.hidden = true
  d.listeners.visibilitychange.forEach(fn => fn())
  assert.equal(d.pending.length, 0, '藏起来之后还在排队')
  d.doc.hidden = false
  d.listeners.visibilitychange.forEach(fn => fn())
  assert.equal(d.pending.length, 1, '回来之后没重新走')
})

test('★ 重复挂载不会挂出第二个（pjax 切页会再调一次）', () => {
  const d = bootDom()
  d.api.mount(); d.api.mount()
  assert.equal(d.hero.children.length, 5)
})

test('★★ JS 吐出的每个类名都有样式，CSS 里也没有死样式', () => {
  // 类名打错一个字不会报错，只会静默地少一块样式 —— 这种事看不见，只能靠对表。
  const pick = text => [...new Set(text.match(/noimpty-clock__[a-z-]+/g) || [])].sort()
  const inJs = pick(readFileSync(new URL('../../source/js/site-clock.js', import.meta.url), 'utf8'))
  const inCss = pick(readFileSync(new URL('../../source/css/site-clock.css', import.meta.url), 'utf8'))
  assert.deepEqual(inJs.filter(c => !inCss.includes(c)), [], '这些类没有样式')
  assert.deepEqual(inCss.filter(c => !inJs.includes(c)), [], 'CSS 里写了但 JS 不产出')
})

test('★★ 就算比 section-hub 先跑，顺序照样对（两边都挂在 DOMContentLoaded 上）', () => {
  // 我先挂：这时副标题还不存在，只能认标题往后插；随后它 append 副标题和按钮
  const d = bootDom(undefined, { built: false })
  assert.ok(d.box(), '副标题还没建出来时不该放弃挂载')
  d.finishHub()
  assert.deepEqual(d.hero.children.map(n => n.id || n.className),
    ['sakura-greeting', 'site-title', 'noimpty-clock', 'site-subtitle', 'sakura-hero-actions'],
    '谁先跑都要落在标题和副标题之间')
})

test('★★ pjax 换页后不留下跑飞的秒表和监听', () => {
  /* hero 被整块换掉时旧节点脱离文档，守卫放行、重新挂载 —— 但旧的 setTimeout
   * 链和 visibilitychange 监听不会自己消失。不拆的话每回一次首页就多积一份，
   * 它们还在对着已经不在文档里的节点每秒写字。 */
  const d = bootDom()
  assert.equal(d.pending.length, 1)
  const before = d.listeners.visibilitychange.length
  d.repaint()
  d.api.mount()
  assert.equal(d.pending.length, 1, '旧秒表没停，现在有两条在跑')
  assert.equal(d.listeners.visibilitychange.length, before, '监听越积越多')
  // 新的那块还得是活的
  d.step(1)
  assert.ok(d.box(), '换页之后没挂回来')
  assert.equal(d.slot('ss').textContent, '08')
})

test('★ 猫耳居中压在整排表盘上，不是挂在左边那块牌上', () => {
  const css = readFileSync(new URL('../../source/css/site-clock.css', import.meta.url), 'utf8')
  const rule = css.match(/\.noimpty-clock__ears\s*\{[^}]*\}/)[0]
  assert.match(rule, /left:\s*50%/, '耳朵没居中会看着是歪的')
  assert.match(rule, /translate:\s*-50%/, '只给 left:50% 不回拉一半，等于整体偏右')
})

console.log(`\n${passed} 项通过`)
