/* 学习时间线（tools/study-timeline.cjs + {% study_timeline %}）。
 *
 * 时间线是构建时从文章自动生成的，没有人会逐项去核对，所以这里盯住几件看页面才会发现的事：
 *   - 只收带 series 的学习文章，娜娜莉的周专栏、自我介绍不该混进来；
 *   - 从新到旧排，同一天的文章合成一项，月份标题上的篇数要对得上；
 *   - 系列颜色按第一次出现的先后编号，后来的系列不会抢走老系列的颜色；
 *   - 标题里的 < & 要转义，不能被当成 HTML。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { render } = require('../../study-timeline.cjs')

let pass = 0
const check = (name, fn) => { fn(); pass++; console.log(`  ✓ ${name}`) }

const posts = [
  { title: 'DSA 一', date: '2026-08-28', series: '数据结构与算法', url: '/a/' },
  { title: '周专栏', date: '2026-09-28', series: '', url: '/n/' },
  { title: 'Linux 二', date: '2026-09-05', series: 'Linux 命令行', url: '/b/' },
  { title: 'Git 零', date: '2026-09-05', series: 'Git', url: '/c/' },
  { title: 'GAMES 一', date: '2026-07-15', series: 'GAMES101', url: '/d/' },
  { title: '<b>Git & 合并</b>', date: '2026-09-20', series: 'Git', url: '/e/' }
]
const html = render(posts)

check('只收带 series 的文章，开头的总结数对了', () => {
  assert.doesNotMatch(html, /周专栏/)
  assert.match(html, /从 2026 年 7 月 15 日写下第一篇学习笔记到现在，一共 5 篇，分成 4 个系列：GAMES101 1 篇、数据结构与算法 1 篇、Linux 命令行 1 篇、Git 2 篇。/)
})

check('按月从新到旧，月份标题上的篇数对得上', () => {
  const months = [...html.matchAll(/<p>(\d+) 年 (\d+) 月 · (\d+) 篇<\/p>/g)].map(m => `${m[2]}:${m[3]}`)
  assert.deepEqual(months, ['9:3', '8:1', '7:1'])
  assert.ok(html.indexOf('9 月 20 日') < html.indexOf('9 月 5 日'))
})

check('同一天的文章合成一项', () => {
  const sameDay = html.match(/<time datetime="2026-09-05">[\s\S]*?<\/ul>/)[0]
  assert.match(sameDay, /Linux 二/); assert.match(sameDay, /Git 零/)
  assert.equal((html.match(/datetime="2026-09-05"/g) || []).length, 1)
})

check('系列颜色按第一次出现的先后编号', () => {
  const tone = name => html.match(new RegExp(`data-tone="(\\d)">${name}<`))[1]
  assert.equal(tone('GAMES101'), '0'); assert.equal(tone('数据结构与算法'), '1')
  assert.equal(tone('Linux 命令行'), '2'); assert.equal(tone('Git'), '3')
})

check('标题里的 HTML 特殊字符被转义', () => {
  assert.match(html, /&lt;b&gt;Git &amp; 合并&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<b>Git/)
})

check('没有学习文章时给出一句提示，页面和菜单都接好了', () => {
  assert.match(render([{ title: 'x', date: '2026-01-01', series: '', url: '/' }]), /还没有学习笔记/)
  assert.match(readFileSync('source/timeline/index.md', 'utf8'), /\{% study_timeline %\}/)
  assert.match(readFileSync('_config.butterfly.yml', 'utf8'), /时间线: \/timeline\/ \|\| fas fa-timeline/)
})

console.log(`\n${pass} study timeline checks passed`)
