/* 行动日志：她那几个分身靠这一本认出彼此。
 *
 * 这个文件守住三件事：
 *   1. 日志本身不会无限长，也不会被脏数据搞炸
 *   2. 摘要的**措辞**——它同时进七个分身的提示词，写不对她就把自己干的事
 *      说成「另一个程序干的」，那这本日志就白记了
 *   3. 前端那份标签表和后端这份对得上（浏览器脚本没法 import，只能抄一份）
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pruneEntries, journalDigest, bjStamp, WHO, KEEP, KEEP_DAYS } from '../nanaly/journal.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const DAY = 86400000
const NOON = Date.parse('2026-09-17T04:00:00Z')   // 北京 2026-09-17 12:00
const entry = (ts, who, what) => ({ ts, at: bjStamp(ts), who, what })

console.log('\n行动日志 · 存什么、扔什么')

check('★ 太老的扔掉，不许让她读到上个月的事还以为是昨天的', () => {
  const out = pruneEntries([
    entry(NOON - (KEEP_DAYS + 5) * DAY, 'patrol', '很久以前的'),
    entry(NOON - DAY, 'reply', '昨天的')
  ], NOON)
  assert.equal(out.length, 1)
  assert.equal(out[0].what, '昨天的')
})

check('★ 条数封顶 —— 某天疯狂回了一百条评论，不能把整本日志挤满', () => {
  const many = Array.from({ length: KEEP + 40 }, (_, i) => entry(NOON - (KEEP + 40 - i) * 60000, 'reply', '第 ' + i + ' 条'))
  const out = pruneEntries(many, NOON)
  assert.equal(out.length, KEEP)
  assert.equal(out[out.length - 1].what, '第 ' + (KEEP + 39) + ' 条', '剪掉的应该是最旧的那头')
})

check('脏数据不会让它炸（缺字段、时间不是数字、null）', () => {
  const out = pruneEntries([
    null,
    { who: 'patrol' },
    { who: 'patrol', what: '没有时间戳' },
    { ts: NaN, who: 'reply', what: '时间是 NaN' },
    entry(NOON - DAY, 'notes', '正常的一条')
  ], NOON)
  assert.equal(out.length, 1)
  assert.equal(out[0].what, '正常的一条')
})

check('按时间排好序，不管塞进来的顺序', () => {
  const out = pruneEntries([
    entry(NOON - DAY, 'reply', '后'),
    entry(NOON - 3 * DAY, 'patrol', '先')
  ], NOON)
  assert.deepEqual(out.map(e => e.what), ['先', '后'])
})

console.log('\n行动日志 · 摘要的措辞（这一段决定她认不认得出那是自己）')

check('空日志给空串 —— 没东西可说就别往提示词里塞一个空壳', () => {
  assert.equal(journalDigest([], { now: NOON }), '')
})

check('★★ 必须说清「这是你自己做的」，否则她会说成「另一个程序干的」', () => {
  const d = journalDigest([entry(NOON - 3600000, 'patrol', '巡逻了 29 篇')], { now: NOON })
  assert.match(d, /你自己/, '没说这是她自己做的')
  assert.match(d, /同一只猫/, '没说清几个分身是同一个人')
  assert.match(d, /窝/, '没告诉她提到这些事时自称「窝」')
  assert.ok(!/系统|另一个程序/.test(d.replace(/别说成[^\n]*/g, '')), '措辞里别留下「系统」这种叫法')
})

check('★ 标签用中文，不是 patrol / reply 这种键名', () => {
  const d = journalDigest([entry(NOON, 'reply', 'x'), entry(NOON, 'column', 'y')], { now: NOON })
  assert.match(d, /回评/)
  assert.match(d, /随笔/)
  assert.ok(!/- \S+ reply：/.test(d), '把键名直接印出来了')
})

check('★ limit 和 sinceDays 都管用（随笔要读一整周，回评只要最近几条）', () => {
  const list = Array.from({ length: 30 }, (_, i) => entry(NOON - (30 - i) * DAY, 'notes', '第 ' + i))
  const few = journalDigest(list, { limit: 3, now: NOON })
  assert.equal(few.split('\n').filter(l => l.startsWith('- ')).length, 3)
  const week = journalDigest(list, { sinceDays: 8, limit: 40, now: NOON })
  assert.equal(week.split('\n').filter(l => l.startsWith('- ')).length, 8)
})

console.log('\n行动日志 · 前后端两份标签表')

check('★★ 对话窗口那份 JOURNAL_WHO 和这边的 WHO 必须一字不差', () => {
  // 浏览器脚本没法 import，所以那边抄了一份。抄了就会走散，这里盯着。
  const src = readFileSync(join(process.cwd(), 'source/js/noimpty-ai.js'), 'utf8')
  const m = src.match(/const JOURNAL_WHO = \{([\s\S]*?)\}/)
  assert.ok(m, 'noimpty-ai.js 里找不到 JOURNAL_WHO')
  const front = {}
  ;[...m[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)].forEach(x => { front[x[1]] = x[2] })
  assert.deepEqual(front, WHO,
    '前后端的分身标签表对不上 —— 那边会把新分身印成英文键名。改一边记得改另一边')
})

console.log('\n行动日志 · 公开仓库的边界')

check('★★ 对话窗口只读不写：前端不许存在任何往日志里写的路径', () => {
  const src = readFileSync(join(process.cwd(), 'source/js/noimpty-ai.js'), 'utf8')
  // 这个仓库是公开的（见 source/_data/noimpty-profile.md 开头）。
  // 主人和她的私聊一旦写进日志就是公开的，所以这条是定死的。
  assert.ok(!/nanaly-journal[^)]*\b(PUT|POST|contents\/)/i.test(src),
    '对话窗口里出现了往日志写东西的路径 —— 仓库是公开的，聊天内容不许进去')
  assert.ok(!/loadJournal[\s\S]{0,200}githubToken/.test(src),
    '读日志的地方附近出现了 GitHub token，像是要往回写')
})

console.log(`\n${pass} 项通过`)
