/* 娜娜莉随笔的标题解析测试。
 *
 * 为什么需要它：线上出过一篇标题叫
 *   《窝在服务器角落看了三天提交记录，主人像只被 UE5 追着跑的仓鼠。日程更新从 8 月 13 日一路滚到 16 日，中间还》
 * 的文章 —— 正好 60 个字，因为老代码是「第一行当标题，slice(0, 60)」。
 * 她那次没按格式写、直接从正文开始，于是正文第一段被当成标题砍断，
 * 而且那一段同时从正文里消失了。
 *
 * 现在改成显式分隔符 + 校验，拆不出来整篇丢掉。这个文件守住它。
 */
import assert from 'node:assert/strict'
import { parseColumn, bjWeek } from '../nanaly/column.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const BODY = '窝扫了一眼提交记录。\n\n' + '主人这周把 UE5 第四章写完了，蓝图那一节写得比前几篇清楚，至少没再把状态机写成 if 地狱。'.repeat(5)

console.log('\n娜娜莉随笔 · 标题解析')

check('★ 正常情况：标题和正文都拆得出来', () => {
  const r = parseColumn(`标题：主人这周终于把第四章写完了\n===正文===\n${BODY}`)
  assert.ok(r, '没解析出来')
  assert.equal(r.title, '主人这周终于把第四章写完了')
  assert.ok(r.content.startsWith('窝扫了一眼'))
})

check('★ 她没写分隔符、直接从正文开始 → 整篇丢掉（不再把正文当标题）', () => {
  assert.equal(parseColumn(BODY), null)
})

check('★ 标题栏里塞了一整段正文 → 丢掉（这就是线上那次的形态）', () => {
  const long = '窝在服务器角落看了三天提交记录，主人像只被 UE5 追着跑的仓鼠。日程更新从 8 月 13 日一路滚到 16 日，中间还改了三次时区'
  assert.equal(parseColumn(`标题：${long}\n===正文===\n${BODY}`), null)
})

check('★ 标题里有句号 → 丢掉（那是一句话，不是标题）', () => {
  assert.equal(parseColumn(`标题：主人这周很忙。窝很闲。\n===正文===\n${BODY}`), null)
})

check('有分隔符但没有「标题：」→ 丢掉', () => {
  assert.equal(parseColumn(`随便一句话\n===正文===\n${BODY}`), null)
})

check('正文太短 → 丢掉', () => {
  assert.equal(parseColumn('标题：短\n===正文===\n就这一句'), null)
})

check('标题外面的井号、引号、书名号都会被剥掉', () => {
  assert.equal(parseColumn(`标题：## 「主人的第四章」\n===正文===\n${BODY}`).title, '主人的第四章')
  assert.equal(parseColumn(`标题：《被 UE5 追着跑的一周》\n===正文===\n${BODY}`).title, '被 UE5 追着跑的一周')
})

check('空输入 / 垃圾输入不会炸', () => {
  assert.equal(parseColumn(''), null)
  assert.equal(parseColumn(null), null)
  assert.equal(parseColumn('   '), null)
})

console.log('\n娜娜莉随笔 · 周编号（北京时间）')

/* 8/12 和 8/13 落在相邻的两个周桶里，正好能把「按哪个时区取日期」这件事暴露出来。
 * 关键的一对：UTC 8/12 16:30 —— 按 UTC 是 12 号，按北京时间已经是 13 号 00:30。 */
const utcLateNight = new Date('2026-08-12T16:30:00Z')   // 北京 8/13 00:30
const bjSameDayNoon = new Date('2026-08-13T04:00:00Z')  // 北京 8/13 12:00
const bjPrevDayNoon = new Date('2026-08-12T04:00:00Z')  // 北京 8/12 12:00

check('★ 按北京日期算：UTC 还在 12 号、北京已到 13 号 → 跟着 13 号走', () => {
  assert.equal(bjWeek(utcLateNight), bjWeek(bjSameDayNoon),
    '取日期时用的还是 UTC，跨北京零点的那几个小时会算错')
})

check('★ 北京的 12 号和 13 号确实分属两个周桶（保证上面那条测得到东西）', () => {
  assert.notEqual(bjWeek(bjPrevDayNoon), bjWeek(bjSameDayNoon))
})

check('同一天的不同时刻属于同一周', () => {
  assert.equal(bjWeek(new Date('2026-08-18T02:00:00Z')), bjWeek(new Date('2026-08-18T09:00:00Z')))
})

check('周编号是两位数，能排序', () => {
  assert.match(bjWeek(new Date('2026-01-05T00:00:00Z')), /^2026-w\d{2}$/)
})

console.log(`\n${pass} 项通过`)
