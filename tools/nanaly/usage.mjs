import { randomUUID } from 'node:crypto'
import { bjStamp } from './journal.mjs'
import { readPrivateContent, appendPrivateContent, flushPrivateContent } from '../private-content-client.mjs'

export const FILE = 'usage' // Logical backend record.
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
  const raw = readPrivateContent('usage')
  return pruneRuns(Array.isArray(raw) ? raw : raw.runs)
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
  const entry = { id: randomUUID(), ts: now, at: bjStamp(now), job: String(job).slice(0, 40), tasks }
  if (DRY) { console.log('  [演练] 会增加一条私密用量记录'); return entry }
  appendPrivateContent('usage', entry, runs => pruneRuns(runs, now))
  console.log('  已暂存一条私密用量记录')
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

export const commitUsage = async () => {
  if (DRY) return false
  return flushPrivateContent('usage')
}
