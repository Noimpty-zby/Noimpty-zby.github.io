/* 模型用量记账。
 *
 * 为什么需要它：narrate.mjs 早就把每次响应里的 usage 接住了，但只在跑完
 * console.log 一行，跟着 Actions 日志一起过期。于是「这个月贵了」除了看账单
 * 没有第二个来源，更答不出「是谁贵的」—— 而每项任务的频次和该不该用推理模型
 * 是分开的决定，混成一个总数就没法单独调。
 *
 * 这里守四件事：
 *   1. 归因要按任务分开，推理档要单独算（不是一个价钱）
 *   2. 空跑不留账；坏文件不被覆盖
 *   3. 汇总按「未命中缓存的输入」排序 —— 那是最贵的一列
 *   4. 这份数据不发布：它是自己看的，没有理由送进浏览器
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const U = await import('../../nanaly/usage.mjs')
const NOW = Date.parse('2026-09-20T12:00:00Z'), DAY = 86400000

const run = (ts, job, tasks) => ({ ts, at: 'x', job, tasks })
const task = (calls, hit, miss, out) => ({ calls, hit, miss, out })

// 在临时目录里跑，绝不碰仓库里真实的记账文件
const sandbox = async fn => {
  const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'nanaly-usage-'))
  mkdirSync(join(dir, 'source/_data'), { recursive: true })
  // 必须 await 再切回去：否则 finally 会赶在异步用例跑完之前把 cwd 换掉。
  try { process.chdir(dir); return await fn(dir) } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }) }
}

console.log('\n模型用量 · 记账')

await test('★★ 空跑不留账，一个请求都没发就不该在账面上占一行', async () => {
  await sandbox(() => {
    assert.equal(U.recordRun('nanaly', {}), null)
    assert.equal(U.recordRun('nanaly', { 批注: task(0, 0, 0, 0) }), null, '全是 0 的任务也不算账')
    assert.equal(existsSync(U.FILE), false, '什么都没发生就不该创建文件')
  })
})

await test('★★ 一轮记一条，保留到任务这一层', async () => {
  await sandbox(() => {
    U.recordRun('nanaly', { 批注: task(4, 8000, 22000, 3000), 巡逻: task(1, 0, 1200, 200) }, { now: NOW })
    const runs = U.readRuns()
    assert.equal(runs.length, 1)
    assert.equal(runs[0].job, 'nanaly')
    assert.deepEqual(Object.keys(runs[0].tasks).sort(), ['巡逻', '批注'])
    assert.equal(runs[0].tasks.批注.miss, 22000, '未命中的输入是最贵的那列，必须原样存下来')
    U.recordRun('daily-report', { 小结: task(1, 0, 900, 100) }, { now: NOW + 1000 })
    assert.equal(U.readRuns().length, 2, '两个 job 各记各的，不互相覆盖')
  })
})

await test('★★ 坏掉的记账文件不会被当成空的悄悄覆盖', async () => {
  await sandbox(() => {
    for (const bad of ['broken', 'null', '7', '{"runs":{}}']) {
      writeFileSync(U.FILE, bad)
      assert.throws(() => U.readRuns(), /读取失败/)
      assert.equal(readFileSync(U.FILE, 'utf8'), bad, '原文件必须原封不动')
    }
  })
})

await test('★ 过期的、格式坏的记录被剔除，总条数有上限', () => {
  const runs = [
    run(NOW - 200 * DAY, 'nanaly', { a: task(1, 0, 1, 1) }),   // 超出保留期
    run(NOW - DAY, 'nanaly', { a: task(1, 0, 1, 1) }),
    { ts: NOW, job: 'nanaly' },                                 // 没有 tasks
    { ts: NOW, tasks: { a: task(1, 0, 1, 1) } },                // 没有 job
    run(NaN, 'nanaly', { a: task(1, 0, 1, 1) })
  ]
  assert.equal(U.pruneRuns(runs, NOW).length, 1)
  const many = Array.from({ length: U.KEEP + 50 }, (_, i) => run(NOW - i * 1000, 'nanaly', { a: task(1, 0, 1, 1) }))
  assert.equal(U.pruneRuns(many, NOW).length, U.KEEP)
})

await test('★★ 汇总按任务分开，并按未命中的输入排序 —— 想省钱先看这一列', () => {
  const runs = [
    run(NOW - 3600e3, 'nanaly', { 批注: task(4, 8000, 22000, 3000), 回评: task(1, 0, 4000, 600) }),
    run(NOW - 7200e3, 'nanaly', { 批注: task(2, 1000, 3000, 400) }),
    run(NOW - 5 * DAY, 'nanaly', { 资讯正文: task(3, 0, 99000, 5000) })   // 窗口之外
  ]
  const day = U.rollup(runs, { days: 1, now: NOW })
  assert.equal(day.runs, 2, '只算窗口内的轮次')
  assert.equal(day.miss, 22000 + 4000 + 3000)
  assert.equal(day.input, day.hit + day.miss)
  assert.deepEqual(day.ranked.map(t => t.name), ['批注', '回评'], '未命中多的排前面')
  assert.equal(day.ranked[0].calls, 6, '同一任务跨轮次要累加')
  const week = U.rollup(runs, { days: 7, now: NOW })
  assert.equal(week.ranked[0].name, '资讯正文', '放宽窗口后最贵的那项才露出来')
})

console.log('\n模型用量 · 归因')

await test('★★ 不同任务分别记账，推理档单独算（不是一个价钱）', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-key'
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = fn => realTimeout(fn, 0)
  const reply = usage => async () => ({ ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }], usage }) })
  const N = await import('../../daily-report/narrate.mjs')

  globalThis.fetch = reply({ prompt_tokens: 1000, prompt_cache_hit_tokens: 600, prompt_cache_miss_tokens: 400, completion_tokens: 50 })
  await N.ask('s', 'u', 100, { label: '批注' })
  await N.ask('s', 'u', 100, { label: '批注' })
  globalThis.fetch = reply({ prompt_tokens: 2000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 2000, completion_tokens: 900 })
  await N.ask('s', 'u', 100, { label: '小结', deep: true })

  const by = N.MODEL_STATE.byTask
  assert.deepEqual(Object.keys(by).sort(), ['小结（推理）', '批注'], '推理档必须自成一项，别和普通档混账')
  assert.equal(by.批注.calls, 2)
  assert.equal(by.批注.hit, 1200); assert.equal(by.批注.miss, 800)
  assert.equal(by['小结（推理）'].out, 900)
  // 总数仍然要对得上各项之和，否则两处口径会悄悄分叉
  const sum = Object.values(by).reduce((a, t) => a + t.miss, 0)
  assert.equal(N.MODEL_STATE.tokens.miss, sum)

  const shaped = U.shapeTasks(by)
  assert.equal(shaped.批注.miss, 800, 'shapeTasks 不该改数')
  assert.equal(U.shapeTasks({ 坏的: 'not-an-object', 空的: task(0, 0, 0, 0) }).坏的, undefined)
})

console.log('\n模型用量 · 日报那块')

await test('★★ 卡片列出每项任务，并给出七天日均做对照', async () => {
  const { renderEmail } = await import('../../daily-report/render.mjs')
  const runs = [
    run(NOW - 3600e3, 'nanaly', { 批注: task(4, 8000, 22000, 3000) }),
    run(NOW - 5 * DAY, 'nanaly', { 资讯正文: task(3, 0, 70000, 5000) })
  ]
  const html = renderEmail({ opening: '', traffic: {}, comments: {}, screen: null, newPosts: [], feedbacks: [],
    health: { checks: [], worst: 'ok' }, schedule: null,
    usage: U.rollup(runs, { days: 1, now: NOW }), usageWeek: U.rollup(runs, { days: 7, now: NOW }),
    windowLabel: '', site: 'https://example.com' })
  assert.match(html, /模型用量/)
  assert.match(html, /批注/, '要能看出是谁花的')
  assert.match(html, /七天日均/, '只给当天的数说明不了问题，要有对照')
  assert.doesNotMatch(html, /资讯正文/, '当天那块不该混进窗口外的任务')
  // 一分钱都没花的日子要说清楚，不要渲染成一张空卡片
  const quiet = renderEmail({ opening: '', traffic: {}, comments: {}, screen: null, newPosts: [], feedbacks: [],
    health: { checks: [], worst: 'ok' }, schedule: null, usage: U.rollup([], { days: 1, now: NOW }), usageWeek: null,
    windowLabel: '', site: 'https://example.com' })
  assert.match(quiet, /没记到用量/)
})

console.log('\n模型用量 · 和行动日志同车')

await test('★★ 只有用量变了的那种运行照样提交，但不叫部署（这份数据不发布）', async () => {
  const { commitJournal, FILE: JOURNAL } = await import('../../nanaly/journal.mjs')
  await sandbox(async () => {
  writeFileSync(JOURNAL, JSON.stringify({ v: 1, entries: [] }))
  writeFileSync(U.FILE, JSON.stringify({ v: 1, runs: [] }))
  const calls = []
  // status 只对用量文件报变化，日志那边是干净的
  const run = (...args) => {
    calls.push(args)
    if (args[0] === 'status') return args.includes(U.FILE) ? ' M ' + U.FILE : ''
    return ''
  }
  const deployNeeded = await commitJournal({ run, extra: [U.FILE] })
  const committed = calls.find(a => a[0] === 'commit')
  assert.ok(committed, '账还是要提交的，不然 runner 一拆就没了')
  assert.match(committed[2], /用量记账/, '提交信息不该谎称更新了行动日志')
  assert.equal(deployNeeded, false, '用量不发布，为它跑一次部署是白跑')
  assert.ok(!calls.some(a => a[0] === 'add' && a.includes(JOURNAL)), '没变的文件不该被 add 进去')
  })
})

console.log('\n模型用量 · 不许外泄')

await test('★★ 记账文件不发布 —— 它是自己看的，没有理由送进浏览器', () => {
  // 只认文件名。浏览器那边另有一个同名前缀的 localStorage 键和 CSS 类，
  // 是对话窗口自己那份 token 显示，跟这份 CI 侧的记账没有关系。
  const lockdown = readFileSync('scripts/noimpty-lockdown.js', 'utf8')
  assert.doesNotMatch(lockdown, /nanaly-usage\.json/, 'lockdown 一旦给它开路由，用量就会变成站上的一个文件')
  if (existsSync('public')) assert.equal(existsSync('public/nanaly-usage.json'), false, '产物里出现了用量文件')
  // 她的提示词只该看见行动日志，不该看见 token 数
  assert.doesNotMatch(readFileSync('source/js/noimpty-ai.js', 'utf8'), /nanaly-usage\.json/,
    '对话窗口读到它，token 数就进了她的上下文')
})

console.log(`\n${passed} 项通过`)
