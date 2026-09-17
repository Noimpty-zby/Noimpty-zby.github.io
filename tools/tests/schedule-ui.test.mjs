/* 日程页：把它真的跑起来。
 *
 * 2026-09-17 这一页整个空白过一次，原因是一行 `const活 = …`：
 * CJK 是合法的标识符字符，所以 `const活` 被当成**一个** token，
 * 整句成了「给未声明变量赋值」—— 解析期完全合法，只有在 'use strict' 下
 * 运行时才抛。node --check 过、js-syntax.test.mjs 过、构建过、部署过，
 * 只有打开页面才看得见。
 *
 * 根子不在那个变量名，在于**没有任何东西真的执行过这个文件**。
 * 所以这里搭一个最小 DOM，让它从头跑到 render 出 HTML 为止。
 * 和 privacy-gate 那次是同一个教训：只有语法检查等于没有检查。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}
const acheck = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const SRC = readFileSync(join(process.cwd(), 'source/js/schedule.js'), 'utf8')

const bjKey = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(d)
const TODAY = bjKey()
const LAST_WEEK = bjKey(new Date(Date.now() - 7 * 86400000))

const STUDY = {
  courses: [
    { leaf: 'Go', title: 'Go', url: '/extra/ai-infra/go/', chapters: ['基础', '切片', '接口'], n: 0, latest: '', posts: [] },
    { leaf: 'DSA', title: '数据结构与算法', url: '/in-class/dsa/', chapters: ['递归', '数组'], n: 1, latest: LAST_WEEK,
      posts: [{ title: '数据结构第二章：递归', url: '/x/', day: LAST_WEEK }] }
  ],
  posts: [{ day: LAST_WEEK, leaf: 'DSA', title: '数据结构第二章：递归', url: '/x/' }]
}
const SCHED = {
  updatedAt: '', days: {
    [LAST_WEEK]: [{ id: 'a', text: '逾期的那条', done: false }],
    [TODAY]: [
      { id: 'b', text: '今天要做的', done: false, when: { type: 'section', match: 'Go' } },
      { id: 'c', text: '做完了的', done: true }
    ]
  }
}

/** 最小 DOM：够 mount() → render() 跑完就行 */
const boot = ({ study = STUDY, sched = SCHED } = {}) => {
  let html = ''
  const node = () => ({
    addEventListener () {}, removeEventListener () {},
    set innerHTML (v) { html = v }, get innerHTML () { return html },
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, dataset: {}, style: {},
    classList: { add () {}, remove () {}, toggle () {} },
    focus () {}, scrollIntoView () {}
  })
  const root = node()
  const win = {
    NOIMPTY_STUDY: study,
    addEventListener () {}, setTimeout, clearTimeout,
    location: { origin: 'https://x.test', pathname: '/schedule/' },
    localStorage: { getItem: () => null, setItem () {}, removeItem () {} },
    fetch: () => Promise.resolve({ ok: true, json: async () => sched, text: async () => JSON.stringify(sched) })
  }
  const ctx = vm.createContext({
    window: win,
    document: {
      getElementById: id => (id === 'noimpty-schedule' ? root : null),
      querySelector: () => null, addEventListener () {}, createElement: () => node()
    },
    localStorage: win.localStorage, fetch: win.fetch, setTimeout, clearTimeout,
    Intl, Date, JSON, Math, console, URL
  })
  vm.runInContext(SRC, ctx)
  return { first: html, settled: () => html }
}

/* mount() 会先用空数据 render 一次，再等 loadData() 回来重渲一次。
 * 只看第一次的话，日程那半永远是空的 —— 那不是页面的行为，是测试写错了。 */
const bootLoaded = async opts => {
  const b = boot(opts)
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))
  return b.settled()
}

console.log('\n日程页 · 真的能跑起来')

check('★★ mount → render 不抛，而且产出了东西（那次空白就死在这一步）', () => {
  const html = boot().first
  assert.ok(html.length > 2000, `只产出了 ${html.length} 个字符，页面基本是空的`)
})

check('★★ 三块都在：回顾、计划、月历', () => {
  const html = boot().first
  ;[['sch-review', '这三个月那一块'], ['sch-plan', '接下来那一块'], ['sch-cal', '月历那一折'],
    ['sch-heat__grid', '热图'], ['sch-courses', '每门课的进度条'], ['sch-nextlist', '待办列表']]
    .forEach(([cls, name]) => assert.ok(html.includes(cls), `${name}（.${cls}）没渲染出来`))
})

check('★ 热图正好 91 格', () => {
  const html = boot().first
  const n = (html.match(/class="sch-heat__c"/g) || []).length
  assert.equal(n, 91, `热图有 ${n} 格`)
})

check('★ 每门课一条进度：写过的显示「几天没动」，没写过的显示「还没开始」', () => {
  const html = boot().first
  assert.match(html, /数据结构与算法/, '写过的那门没出现')
  assert.match(html, /还没开始/, '一篇没写的那门没标出来')
  assert.match(html, /7 天没动/, '没算出「隔了多久」')
})

await acheck('★★ 待办跨天摊平，逾期的标出来', async () => {
  const html = await bootLoaded()
  assert.match(html, /逾期的那条/)
  assert.match(html, /今天要做的/)
  assert.ok(!html.includes('做完了的') || html.indexOf('做完了的') > html.indexOf('sch-cal'),
    '已完成的不该出现在「接下来」里')
  assert.match(html, /sch-next is-late/, '逾期的没被标出来')
})

await acheck('★ section 条件显示成课程名，不是分类叶子名', async () => {
  const html = await bootLoaded()
  assert.match(html, /Go 多一篇/, '条件没显示成人话')
})

console.log('\n日程页 · 数据缺了也不能白屏')

await acheck('★★ 没有 NOIMPTY_STUDY（别的页面、或者标签没渲染）也要照常出日程', async () => {
  const html = await bootLoaded({ study: undefined })
  assert.ok(html.length > 1000, '学习总览的数据一缺，整页就白了')
  assert.match(html, /sch-nextlist/, '日程那半也没了')
})

check('★ 数据里少字段也不炸', () => {
  assert.doesNotThrow(() => boot({ study: { courses: [] } }))       // 没有 posts
  assert.doesNotThrow(() => boot({ study: { posts: [] } }))         // 没有 courses
  assert.doesNotThrow(() => boot({ study: 'not-an-object' }))
})

await acheck('★ 一条安排都没有的时候有话说，不是空白', async () => {
  const html = await bootLoaded({ sched: { updatedAt: '', days: {} } })
  assert.match(html, /没有待办了/)
})

console.log(`\n${pass} 项通过`)
