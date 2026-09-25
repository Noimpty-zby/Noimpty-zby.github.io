/* front-matter 的日期 → 永久链接。
 *
 * 为什么需要它：线上真的因此丢过东西。
 * nanaly-2026-w35.md 的 front-matter 写的是 `date: 2026-08-31 00:05:53`，
 * 而这篇在线上的地址是 /2026/08/30/nanaly-2026-w35/ —— 差一天。
 * 原因是 _config.yml 里 timezone: 'Asia/Shanghai'：永久链接取的是那一刻的
 * **UTC 日期**，front-matter 写的却是**北京挂钟**，凌晨发的文章两者差一天。
 *
 * 老代码直接抠 front-matter 的前十个字符，于是给那篇算出一个不存在的地址：
 * 三条批注永远贴不上去。更难发现的是它不会自愈 —— 推出来的路径「看起来还活着」，
 * 孤儿清理不删它，哈希又对得上、不会重写，就那么永久卡着，
 * 唯一的症状是那篇随笔上没有猫爪。
 *
 * 而且这个坏法会重演：随笔的 cron 是周日 12:00 UTC（北京 20:00），
 * 但 GitHub 的定时漂移几个小时是常态 —— 8-30 那次跑在 16:06 UTC 就越过了北京的午夜，
 * 9-13 那次跑在 15:39 UTC，差 21 分钟又要中一次。
 */
import assert from 'node:assert/strict'
import { utcDay, postPath, wallClockMs } from '../../nanaly/permalink.mjs'
import { pathOf } from '../../nanaly/notes.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const post = date => `---\ntitle: 随便什么标题\ndate: ${date}\n---\n\n正文。`

console.log('\n永久链接 · 北京挂钟 → UTC 日期')

check('★★ 凌晨发的文章，URL 比 front-matter 早一天（w35 的真实数据）', () => {
  assert.equal(
    postPath('source/_posts/nanaly-2026-w35.md', post('2026-08-31 00:05:53')),
    '/2026/08/30/nanaly-2026-w35/',
    '按 front-matter 直接抠年月日的老写法会推出 /2026/08/31/，那个地址不存在')
})

check('白天发的文章不受影响（全站 28 篇都在这一档）', () => {
  assert.equal(postPath('source/_posts/homework-three.md', post('2026-07-20 21:25:04')),
    '/2026/07/20/homework-three/')
  assert.equal(utcDay('2026-09-14 21:50:00'), '2026/09/14')
  assert.equal(utcDay('2026-08-21 10:00:00'), '2026/08/21')
})

check('★ 分界线是北京时间 08:00', () => {
  assert.equal(utcDay('2026-08-31 07:59:59'), '2026/08/30')
  assert.equal(utcDay('2026-08-31 08:00:00'), '2026/08/31')
})

check('跨月、跨年一样要对', () => {
  assert.equal(utcDay('2026-09-01 00:30:00'), '2026/08/31')
  assert.equal(utcDay('2027-01-01 03:00:00'), '2026/12/31')
})

check('自己带了时区的写法按标准解析，别再减一次 8 小时', () => {
  assert.equal(utcDay('2026-08-31T00:05:53+08:00'), '2026/08/30')
  assert.equal(utcDay('2026-08-31T00:05:53Z'), '2026/08/31')
})

check('只有日期没有时间的，原样用 —— YAML 按 UTC 零点解析它，那不是挂钟值', () => {
  assert.equal(utcDay('2026-08-31'), '2026/08/31')
})

check('推不出来就返回 null，不要瞎猜一个日期', () => {
  assert.equal(postPath('source/_posts/x.md', '---\ntitle: 没日期\n---\n正文。'), null)
  assert.equal(utcDay(''), null)
  assert.equal(utcDay('八月三十一号'), null)
  assert.equal(utcDay(null), null)
})

console.log('\n永久链接 · 挂钟换算本身（数篇数也在用它）')

check('★★ 不带时区的那串是北京挂钟，不是跑测试那台机器的本地时间', () => {
  /* 这一条和机器时区无关，所以在 UTC 的 CI 上和 UTC+8 的开发机上结论一样。
   * 换回 Date.parse('2026-09-19T14:46:00') 的话，这里在 UTC 上会差 8 小时 ——
   * 2026-09-19 就是这么让部署红掉的：CI 把当天下午发的文章当成了未来。 */
  assert.equal(wallClockMs('2026-09-19 14:46:00'), Date.parse('2026-09-19T06:46:00Z'))
  assert.equal(wallClockMs('2026-08-31 00:05:53'), Date.parse('2026-08-30T16:05:53Z'))
})

check('带时区的、只有日期的，各按各的规矩，别再减一次 8 小时', () => {
  assert.equal(wallClockMs('2026-08-31T00:05:53Z'), Date.parse('2026-08-31T00:05:53Z'))
  assert.equal(wallClockMs('2026-08-31T00:05:53+08:00'), Date.parse('2026-08-30T16:05:53Z'))
  assert.equal(wallClockMs('2026-08-31'), Date.UTC(2026, 7, 31))
})

check('读不出来的返回 null（不是 0 —— 0 会被当成 1970 年，比什么都早）', () => {
  assert.equal(wallClockMs(''), null)
  assert.equal(wallClockMs('八月三十一号'), null)
  assert.equal(wallClockMs(null), null)
})

check('notes.mjs 的 pathOf 走的是同一套（老名字还在被测试和调用方用着）', () => {
  assert.equal(pathOf('source/_posts/nanaly-2026-w35.md', post('2026-08-31 00:05:53')),
    '/2026/08/30/nanaly-2026-w35/')
})

console.log(`\n${pass} 项通过`)
