/* 日程三方合并的测试。
 *
 * 这里要证明的核心一条：浏览器保存不会抹掉别人（娜娜莉的定时任务、另一台设备）
 * 在你打开页面之后做的改动 —— 同时你自己的改动也必须活下来。
 *
 * 做法：把 schedule.js 放进一个最小的假 DOM 里跑起来，
 * 然后直接拿它暴露出来的 mergeDays 做断言。测的是真代码，不是复制品。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const src = readFileSync(new URL('../../source/js/schedule.js', import.meta.url), 'utf8')

const noop = () => {}
const fakeEl = () => ({
  dataset: {}, className: '', textContent: '', innerHTML: '',
  addEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  closest: () => null, matches: () => false
})

const sandbox = {
  console,
  setTimeout, clearTimeout,
  Intl, Date, JSON, Math, Map, Set, Object, Array, String, Number,
  TextEncoder, TextDecoder, Uint8Array,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  fetch: async () => { throw new Error('no network in test') },
  AbortSignal: { timeout: () => null },
  localStorage: {
    _m: {},
    getItem (k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null },
    setItem (k, v) { this._m[k] = String(v) },
    removeItem (k) { delete this._m[k] }
  },
  document: { getElementById: () => null, createElement: fakeEl },
  window: { addEventListener: noop }
}
sandbox.window.localStorage = sandbox.localStorage
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(src, sandbox, { filename: 'schedule.js' })

const { mergeDays } = sandbox.window.NOIMPTY_SCHEDULE
assert.ok(typeof mergeDays === 'function', 'mergeDays 没暴露出来')

const T = (id, text, extra = {}) => ({ id, text, done: false, ...extra })
// 注意：vm 里造出来的数组和宿主的 Array 不是同一个 realm，
// assert.deepEqual 会因为原型不同而判不等。统一搬回宿主数组再比。
const idsOf = (days, k) => Array.from(days[k] || [], t => t.id)
const find = (days, k, id) => (days[k] || []).find(t => t.id === id)

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

console.log('\n三方合并')

check('娜娜莉自动勾的 done 不会被我这边的旧状态顶回去', () => {
  const base = { '2026-08-13': [T('a', '写复盘')] }
  const mine = { '2026-08-13': [T('a', '写复盘'), T('b', '买菜')] }        // 我只加了 b
  const theirs = { '2026-08-13': [T('a', '写复盘', { done: true, autoWhy: '你发了《X》' })] }
  const out = mergeDays(base, mine, theirs)
  assert.equal(find(out, '2026-08-13', 'a').done, true, 'a 应该保持已完成')
  assert.equal(find(out, '2026-08-13', 'a').autoWhy, '你发了《X》')
  assert.ok(find(out, '2026-08-13', 'b'), 'b 应该还在')
})

check('我改过的那条以我为准，不被远端顶掉', () => {
  const base = { d: [T('a', '旧文字')] }
  const mine = { d: [T('a', '新文字')] }
  const theirs = { d: [T('a', '别人改的文字')] }
  const out = mergeDays(base, mine, theirs)
  assert.equal(find(out, 'd', 'a').text, '新文字')
})

check('我删掉的、远端没动过的，删除生效', () => {
  const base = { d: [T('a', 'x'), T('b', 'y')] }
  const mine = { d: [T('a', 'x')] }
  const theirs = { d: [T('a', 'x'), T('b', 'y')] }
  const out = mergeDays(base, mine, theirs)
  assert.deepEqual(idsOf(out, 'd'), ['a'])
})

check('我删掉的、但远端改过的，保留远端的（宁可多留也不误删）', () => {
  const base = { d: [T('a', 'x'), T('b', 'y')] }
  const mine = { d: [T('a', 'x')] }
  const theirs = { d: [T('a', 'x'), T('b', 'y', { done: true })] }
  const out = mergeDays(base, mine, theirs)
  assert.deepEqual(idsOf(out, 'd').sort(), ['a', 'b'])
})

check('远端新增的日子不会因为我这边没有就消失', () => {
  const base = {}
  const mine = { '2026-08-13': [T('a', '我写的')] }
  const theirs = { '2026-08-20': [T('z', '手机上写的')] }
  const out = mergeDays(base, mine, theirs)
  assert.deepEqual(idsOf(out, '2026-08-13'), ['a'])
  assert.deepEqual(idsOf(out, '2026-08-20'), ['z'])
})

check('把任务挪到别的一天，跟着我走', () => {
  const base = { '2026-08-13': [T('a', 'x')] }
  const mine = { '2026-08-14': [T('a', 'x')] }
  const theirs = { '2026-08-13': [T('a', 'x')] }
  const out = mergeDays(base, mine, theirs)
  assert.equal(out['2026-08-13'], undefined, '原来那天应该空了')
  assert.deepEqual(idsOf(out, '2026-08-14'), ['a'])
})

check('两边都没动 = 原样', () => {
  const base = { d: [T('a', 'x'), T('b', 'y')] }
  const out = mergeDays(base, JSON.parse(JSON.stringify(base)), JSON.parse(JSON.stringify(base)))
  assert.deepEqual(idsOf(out, 'd'), ['a', 'b'])
})

check('远端是空的（真的被清空了），我没动的也跟着清，我动过的留下', () => {
  const base = { d: [T('a', 'x'), T('b', 'y')] }
  const mine = { d: [T('a', 'x'), T('b', 'y改过')] }
  const theirs = {}
  const out = mergeDays(base, mine, theirs)
  assert.deepEqual(idsOf(out, 'd'), ['b'])
})

check('顺序：我这边的排前面，远端新增的排后面', () => {
  const base = {}
  const mine = { d: [T('m1', '一'), T('m2', '二')] }
  const theirs = { d: [T('t1', '远端的')] }
  const out = mergeDays(base, mine, theirs)
  assert.deepEqual(idsOf(out, 'd'), ['m1', 'm2', 't1'])
})

check('完成条件（when）算改动，不会被远端的旧条件覆盖', () => {
  const base = { d: [T('a', 'x')] }
  const mine = { d: [T('a', 'x', { when: { type: 'post', match: '作业二' } })] }
  const theirs = { d: [T('a', 'x')] }
  const out = mergeDays(base, mine, theirs)
  assert.deepEqual(find(out, 'd', 'a').when, { type: 'post', match: '作业二' })
})

check('脏数据（缺 id / 不是数组）不会让合并炸掉', () => {
  const out = mergeDays(
    { d: [null, { text: '没有 id' }] },
    { d: 'not-an-array', e: [T('a', 'x')] },
    { d: [T('b', 'y')] }
  )
  assert.deepEqual(idsOf(out, 'e'), ['a'])
  assert.deepEqual(idsOf(out, 'd'), ['b'])
})

console.log(`\n${pass} 项通过`)
