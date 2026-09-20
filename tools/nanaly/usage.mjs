/* 这些自动任务一天要跑十几次，钱花在没人看得见的地方。
 *
 * narrate.mjs 早就把每次响应里的 usage 接住了，但只在跑完 console.log 一行，
 * 跟着 Actions 日志一起过期 —— 于是「这个月贵了」除了看账单没有第二个来源，
 * 更没法回答「是谁贵的」。这里把每轮的账按任务落盘，日报再摊出来。
 *
 * 只记 token 数，不算钱：单价会变，各家计费口径也不一样，编一个金额出来
 * 比不给更糟。要换算的时候拿这份数乘当时的单价，别把猜的价格写进文件。
 *
 * 这个文件不发布。source/_data 下只有 lockdown.js 显式路由的才出得去，
 * 用量是自己看的东西，没有理由送进浏览器。 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { bjStamp } from './journal.mjs'
import { pushWithRetry, useNanalyIdentity } from './git.mjs'

export const FILE = 'source/_data/nanaly-usage.json'
export const KEEP_DAYS = 90
export const KEEP = 600

const DRY = process.argv.includes('--dry')

const int = value => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

const validTask = value => value && typeof value === 'object' && !Array.isArray(value)

/* 一条记录 = 一次运行。保留到任务这一层，日报再按需要往上卷。
 * 存明细而不是存好的汇总：汇总口径以后会改，原始数据改不回来。 */
export const pruneRuns = (runs, now = Date.now()) => {
  const cutoff = now - KEEP_DAYS * 86400000
  return (Array.isArray(runs) ? runs : [])
    .filter(r => r && typeof r.job === 'string' && Number.isFinite(r.ts) && r.ts >= cutoff && validTask(r.tasks))
    .sort((a, b) => a.ts - b.ts)
    .slice(-KEEP)
}

export const readRuns = () => {
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'))
    const list = Array.isArray(raw) ? raw : raw?.runs
    if (!Array.isArray(list)) throw new Error('用量记录缺少 runs 数组')
    return pruneRuns(list)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    // 读不出来不是拦住整轮任务的理由，但也不能把坏文件覆盖掉。
    throw new Error('用量记录读取失败，保留原文件：' + String(error.message).slice(0, 100))
  }
}

const write = runs => {
  if (!existsSync('source/_data')) mkdirSync('source/_data', { recursive: true })
  writeFileSync(FILE, JSON.stringify({ v: 1, runs }, null, 2) + '\n')
}

/* 把 MODEL_STATE.byTask 归一化。调用方直接把那个对象递进来即可。 */
export const shapeTasks = byTask => {
  const out = {}
  for (const [name, t] of Object.entries(byTask || {})) {
    if (!validTask(t)) continue
    const row = { calls: int(t.calls), hit: int(t.hit), miss: int(t.miss), out: int(t.out) }
    // 一次都没调用、也没烧 token 的任务不占地方。
    if (row.calls || row.hit || row.miss || row.out) out[String(name).slice(0, 40)] = row
  }
  return out
}

/* 记一轮。一个请求都没发就什么都不记 —— 空跑不该在账上留行。 */
export const recordRun = (job, byTask, { now = Date.now() } = {}) => {
  const tasks = shapeTasks(byTask)
  if (!Object.keys(tasks).length) return null
  const entry = { ts: now, at: bjStamp(now), job: String(job).slice(0, 40), tasks }
  if (DRY) { console.log(`  [演练] 会记一轮用量：${entry.job}`); return entry }
  try {
    write(pruneRuns([...readRuns(), entry], now))
    console.log(`  用量已记账：${entry.job}`)
  } catch (error) {
    // 记账失败不该把已经干完的活儿一起拖垮，但要说出来。
    console.log(`  用量写不进去（${String(error.message || error).slice(0, 80)}），不影响刚才那件事`)
    return null
  }
  return entry
}

/* 按任务卷起来。days 为 0 表示不限时间。 */
export const rollup = (runs, { days = 1, now = Date.now() } = {}) => {
  const cutoff = days > 0 ? now - days * 86400000 : 0
  const tasks = {}
  let calls = 0, hit = 0, miss = 0, out = 0, matched = 0
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || run.ts < cutoff) continue
    matched++
    for (const [name, t] of Object.entries(run.tasks || {})) {
      const slot = (tasks[name] ||= { calls: 0, hit: 0, miss: 0, out: 0 })
      slot.calls += int(t.calls); slot.hit += int(t.hit); slot.miss += int(t.miss); slot.out += int(t.out)
      calls += int(t.calls); hit += int(t.hit); miss += int(t.miss); out += int(t.out)
    }
  }
  // 未命中缓存的输入是最贵的那部分，按它排序 —— 想省钱先看这一列。
  const ranked = Object.entries(tasks)
    .map(([name, t]) => ({ name, ...t, input: t.hit + t.miss }))
    .sort((a, b) => b.miss - a.miss || b.out - a.out)
  return { runs: matched, calls, hit, miss, out, input: hit + miss, ranked }
}

export const kilo = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(int(n))

/* 日报跑在自己的 job 里，不提交就等于白记 —— runner 一拆，写进去的文件就没了。
 * 娜娜莉那班有行动日志同车，不需要这个；这里是给日报用的。
 *
 * 失败只说一声，绝不往外抛：邮件比记账重要得多，不能因为账没记上就让日报红掉。 */
export const commitUsage = async ({ run = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }) } = {}) => {
  if (DRY) { console.log('  [演练] 不提交用量记账'); return false }
  try {
    if (!existsSync(FILE)) return false
    if (!run('status', '--porcelain', '--', FILE).trim()) return false
    useNanalyIdentity(run)
    run('add', FILE)
    run('commit', '-m', '娜娜莉：更新用量记账')
    pushWithRetry(run, '用量记账')
    console.log('  用量记账已提交并推送')
    return true
  } catch (error) {
    console.log('  用量记账没提交上（' + String(error.message || error).slice(0, 140) + '），这一轮的账会缺一笔')
    return false
  }
}
