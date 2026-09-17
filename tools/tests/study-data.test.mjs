/* 学习总览的数据源。
 *
 * 章节清单是从 track 页的 HTML 里**现解析**的，不另外维护一份 ——
 * 好处是不用两头同步，代价是那几页的写法一改就可能静默解析出 0 章：
 * 页面上只是少一个「共几章」的分母和「从课程铺任务」的按钮，不报错、
 * 构建全绿，没人会发现。这个文件就是拦这个的。
 *
 * scripts/ 下的是 Hexo 脚本（CommonJS + 依赖全局 hexo），没法直接 import，
 * 所以按字符串边界把两个纯函数切出来在隔离作用域里求值。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const SRC = readFileSync(join(process.cwd(), 'scripts/noimpty-study.js'), 'utf8')
const cut = (from, to) => {
  const a = SRC.indexOf(from), b = SRC.indexOf(to, a)
  assert.ok(a > 0 && b > a, `切不出这一段：${from.slice(0, 24)}`)
  return SRC.slice(a, b)
}
const ctx = vm.createContext({})
vm.runInContext(
  cut('const chaptersOf = ', 'const build = ') +
  '\nglobalThis.__x = { chaptersOf, leafOf }', ctx)
const { leafOf } = ctx.__x
// vm 里造出来的数组和这边不是同一个 Array 原型，deepEqual 会因此不相等 ——
// 摊平成本 realm 的数组再比，比的才是内容
const chaptersOf = raw => [...ctx.__x.chaptersOf(raw)]

const walk = dir => readdirSync(dir).flatMap(e => {
  const p = join(dir, e)
  return statSync(p).isDirectory() ? walk(p) : (e === 'index.md' ? [p] : [])
})
const tracks = [...walk('source/in-class'), ...walk('source/extra')]
  .map(f => ({ f, raw: readFileSync(f, 'utf8') }))
  .filter(p => /^type:\s*noimpty-track/m.test(p.raw))

console.log('\n学习总览 · 章节清单解析')

check('★★ 每个 track 页都能解析出它的分类叶子（没有它整门课就不见了）', () => {
  const bad = tracks.filter(p => !leafOf(p.raw)).map(p => p.f)
  assert.deepEqual(bad, [], '这几页里找不到 {% section_posts X %}：\n      ' + bad.join('\n      '))
})

check('★★ 在学和待学的课都要解析出章节清单', () => {
  /* 游戏开发那两条线已经告一段落，没有章节清单也无所谓；
   * 其余每一门都要有 —— 一篇都没写的那几门恰恰最需要「从课程铺任务」。 */
  const SKIP = ['GAMES101', 'UE5-Looman', 'Life', '娜娜莉']
  const bad = tracks
    .map(p => ({ leaf: leafOf(p.raw), n: chaptersOf(p.raw).length, f: p.f }))
    .filter(x => !SKIP.includes(x.leaf) && x.n === 0)
  assert.deepEqual(bad.map(x => `${x.leaf}（${x.f}）`), [],
    '这几门解析出 0 章 —— 多半是那一页的列表写法变了')
})

check('★ 按结构认，不按小标题认', () => {
  // 线上这三页的小标题各写各的，照标题切的话 CSAPP 和 Docker 永远是 0 章
  const titles = ['课程覆盖', 'Lab 清单（这门课的真正内容）', '预计会覆盖', '随便什么标题']
  titles.forEach(h => {
    const raw = `<h3>${h}</h3><ul>
      <li><b>甲</b> —— 说明</li><li><b>乙</b> —— 说明</li><li><b>丙</b> —— 说明</li></ul>`
    assert.deepEqual(chaptersOf(raw), ['甲', '乙', '丙'], `小标题是「${h}」时解析不出来`)
  })
})

check('★ 两条以下的列表不算章节清单（那多半是别的东西）', () => {
  assert.deepEqual(chaptersOf('<ul><li><b>甲</b> —— x</li><li><b>乙</b> —— y</li></ul>'), [])
})

check('取第一个像章节清单的列表，后面的不管', () => {
  const raw = `<ul><li><b>甲</b></li><li><b>乙</b></li><li><b>丙</b></li></ul>
               <ul><li><b>丁</b></li><li><b>戊</b></li><li><b>己</b></li></ul>`
  assert.deepEqual(chaptersOf(raw), ['甲', '乙', '丙'])
})

check('没有列表、格式不对、空串都不炸', () => {
  assert.deepEqual(chaptersOf(''), [])
  assert.deepEqual(chaptersOf('<p>一段话</p>'), [])
  assert.deepEqual(chaptersOf('<ul><li>没有 b 标签</li></ul>'), [])
  assert.equal(leafOf(''), '')
})

check('★ 叶子名里带空格的也要认（Transformer 推理机制）', () => {
  assert.equal(leafOf('{% section_posts Transformer 推理机制 %}'), 'Transformer 推理机制')
  assert.equal(leafOf('{%section_posts Go%}'), 'Go')
})

console.log('\n学习总览 · 数据挂在页面上')

check('★★ 日程页必须挂着 {% study_data %}，否则整块总览是空的', () => {
  const md = readFileSync('source/schedule/index.md', 'utf8')
  assert.match(md, /\{%\s*study_data\s*%\}/)
})

check('★★ 这份数据只内联在页面里，不许另发一个可以直接 GET 的文件', () => {
  /* 里面是一整串文章标题和课程清单。摊成 /schedule/study.json 就是又一个
   * 「不用打开页面就能知道这站上有什么」的口子 —— 和当初把 /about/ 收回去、
   * 娜娜莉的行动日志要加密，是同一条理由。 */
  assert.ok(!/generator\.register/.test(SRC),
    'noimpty-study.js 里出现了 generator —— 它会生成一个能直接下载的文件')
  assert.match(SRC, /tag\.register\('study_data'/)
})

check('★ 标题里的 </script> 不会把页面劈开', () => {
  assert.match(SRC, /replace\(\/<\\\/\/g/, '没有转义 </，一个带 </script> 的标题就能让整页的脚本断掉')
})

console.log(`\n${pass} 项通过`)
