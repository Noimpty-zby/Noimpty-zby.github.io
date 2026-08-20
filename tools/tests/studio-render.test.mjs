/* 策划室页面的排版渲染测试。
 *
 * 为什么这一段值得单独测：source/js/studio.js 里那个 md2html 是**手写的**
 * markdown 渲染器，不是库。手写的理由是策划文档有几种它自己的写法
 * （「**标签** —— 正文」、「✗ 反面例子」、「⭐ 这条最重要」），
 * 通用渲染器只会把它们渲染成一段普通文字，而那正是最该被看见的几句。
 *
 * 手写的代价是：**排版错了不会报错，只会变难看**，而难看是没人报 bug 的。
 * 所以它需要测试 —— 而它恰好是整个文件里最纯的一段函数，最好测。
 *
 * 怎么测：studio.js 是一个立即执行的浏览器脚本，这里搭一个最小的假 DOM
 * 把它跑起来，然后从它挂在 window 上的调试接口里取 md2html。
 * 不解析、不截取源码 —— 那样测的就不是真正跑在页面上的那份代码了。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '../../source/js/studio.js')

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

/* 最小假 DOM。只要够 mount() 走完就行 ——
 * 它拿到 root 之后会 bind、expose，然后 load() 因为没配仓库名而提前返回。 */
const makeNode = () => ({
  dataset: {}, innerHTML: '',
  addEventListener() {}, closest: () => null, querySelector: () => null,
  querySelectorAll: () => []
})

const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    getElementById: id => (id === 'noimpty-studio' ? makeNode() : null),
    querySelector: () => null
  },
  setTimeout, clearTimeout, fetch: async () => { throw new Error('测试里不该发网络请求') },
  TextEncoder, atob: s => Buffer.from(s, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64')
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.window.addEventListener = () => {}

vm.createContext(sandbox)
vm.runInContext(readFileSync(SRC, 'utf8'), sandbox, { filename: 'studio.js' })

const md = sandbox.window.NOIMPTY_STUDIO && sandbox.window.NOIMPTY_STUDIO.md2html
assert.ok(md, '没能从页面脚本里拿到 md2html —— expose() 是不是改了？')

// 把 HTML 压成一行，方便断言里写期望
const flat = s => String(s).replace(/\n+/g, '')

console.log('\n策划室排版 · 策划文档特有的几种写法')

check('★★ 「**标签** —— 正文」独立成段时被拎成两层，不是一堵墙', () => {
  const h = md('**评委第一眼看到什么** —— 一张棋子视角的桌面截图')
  assert.match(h, /class="sd-kvp"/)
  assert.match(h, /<b class="sd-kv__k">评委第一眼看到什么<\/b>/)
  assert.match(h, /一张棋子视角的桌面截图/)
})

check('★ 中文冒号不触发段落标签（那是正常句子，不是标签）', () => {
  const h = md('**注意**：这一节不是「目标玩家」，别看错了')
  assert.doesNotMatch(h, /sd-kvp/, '「**注意**：…」是一句完整的话，拆开反而读不通')
  assert.match(h, /<strong>注意<\/strong>/)
})

check('★★ 无序列表里的「**标签**：正文」照旧拎成 sd-kv', () => {
  const h = md('- **一眼可辨**：截图里有没有一个没见过的画面\n- **可完成**：90 人日内做不做得完')
  assert.equal((h.match(/class="sd-kv"/g) || []).length, 2)
})

check('★★ ✓ / ✗ 的好例坏例分色，扫一眼就知道哪句是反面教材', () => {
  const h = md('✗「打击感要强」\n\n✓「命中时 3 帧顿帧、镜头 0.15 秒 8cm 位移」')
  assert.match(h, /class="sd-eg is-bad"/)
  assert.match(h, /class="sd-eg is-good"/)
  assert.match(h, /打击感要强/)
})

check('★ 列表项里的 ✗ 同样分色', () => {
  const h = md('- ✗ 市面上很少有\n- ✓ 和《Maquette》的差别在于你被棋盘规则约束')
  assert.match(h, /<li class="sd-eg is-bad">/)
  assert.match(h, /<li class="sd-eg is-good">/)
})

check('★★ ⭐ / ⚠️ / ⛔ 开头的段落变成提示块，不是一段碰巧带表情的文字', () => {
  assert.match(md('⭐ 这个游戏不是做给你自己玩的'), /class="sd-callout is-star"/)
  assert.match(md('⚠️ 这一条对算账很关键，别搞错'), /class="sd-callout is-warn"/)
  assert.match(md('⛔ 不能作为主赛道'), /class="sd-callout is-stop"/)
})

check('★ 光一个符号、后面没内容 → 当普通文字，不做成空提示块', () => {
  const h = md('⭐')
  assert.doesNotMatch(h, /sd-callout/)
})

check('★ 连写的符号（⭐⭐）算一个记号，第二个不掉进正文当错字', () => {
  const h = md('⭐⭐ 这一节是整份总纲里最重要的一节')
  assert.match(h, /<i class="sd-co__m">⭐⭐<\/i>/)
  assert.doesNotMatch(h, /sd-co__b">⭐/, '第二个符号不该出现在正文开头')
})

check('★★ 带色引用块里的提示块不再套第二层框', () => {
  const h = md('> ⚠️ 这一节是我最硬的约束\n>\n> 后面还有一段')
  assert.match(h, /<blockquote class="sd-quote is-warn">/)
  assert.match(h, /sd-callout is-warn is-bare/, '外面那层已经有颜色了，里面只留记号')
})

check('★★ 「标签 —— 正文」的续行要落在正文块里，不能掉到外面', () => {
  const h = md('- **换算成人日**：一年按 40 个可用周算，\n  20 小时/周 = 800 小时')
  assert.match(h, /<span class="sd-kv__v">一年按 40 个可用周算，<br>20 小时\/周 = 800 小时<\/span>/)
})

console.log('\n策划室排版 · 结构')

check('★★ 嵌套列表保持层级，不被拍平成一层', () => {
  const h = flat(md('- 内容与系统\n  - 核心循环\n  - 系统设计\n- 投稿与展示'))
  assert.match(h, /<ul><li>内容与系统<\/li><ul><li>核心循环<\/li><li>系统设计<\/li><\/ul><li>投稿与展示<\/li><\/ul>/)
})

check('★★ 列表项换行续写不会把列表从中间劈开', () => {
  const h = flat(md('1. 第一条主张\n   这一条还有半句话\n2. 第二条主张'))
  assert.equal((h.match(/<ol/g) || []).length, 1, '只该有一个列表')
  assert.match(h, /第一条主张<br>这一条还有半句话/)
})

check('★★ 松散列表（项之间隔空行）不会被切成好几段，编号也不会重来', () => {
  const h = flat(md('1. 甲\n\n2. 乙\n\n3. 丙'))
  assert.equal((h.match(/<ol/g) || []).length, 1)
  assert.equal((h.match(/<li>/g) || []).length, 3)
})

check('★ 有序列表从别的数字开始时，带上 start（正文里「见第 3 条」才对得上）', () => {
  assert.match(md('3. 第三条\n4. 第四条'), /<ol start="3">/)
  assert.doesNotMatch(md('1. 第一条'), /start=/)
})

check('★★ 引用块里的结构留得住（列表、小标题不再塌成一坨）', () => {
  const h = flat(md('> 为什么这么处理：\n>\n> - 第一个原因\n> - 第二个原因'))
  assert.match(h, /<blockquote>/)
  assert.match(h, /<blockquote>.*<ul><li>第一个原因<\/li><li>第二个原因<\/li><\/ul>.*<\/blockquote>/)
})

check('★ 引用块以 ⚠️ 开头时，整块带上警示样式', () => {
  assert.match(md('> ⚠️ 这一节是我最硬的约束，比时间还硬'), /<blockquote class="sd-quote is-warn">/)
})

check('★★ 表格的对齐信息不再被丢掉（人日那一列要能靠右）', () => {
  const h = md('| 项 | 人日 |\n|:---|---:|\n| 核心循环 | 12 |')
  assert.match(h, /<th class="is-left">项<\/th>/)
  assert.match(h, /<th class="is-right">人日<\/th>/)
  assert.match(h, /<td class="is-right">12<\/td>/)
})

check('★ 表格照常渲染，文字列不加多余的 class', () => {
  const h = md('| 甲 | 乙 |\n|---|---|\n| 一 | 二 |\n| 三 | 四 |')
  assert.match(h, /<th>甲<\/th>/)
  assert.match(h, /<td>四<\/td>/)
})

/* 「人日」那一列每份文档里都有，而模型写表格时几乎从不写 |---:|。
 * 全靠左的话 2 / 3 / 12 / 16 的个位对不齐，得逐字比才看得出量级 ——
 * 而看量级正是这张表存在的理由。 */
check('★★ 整列都是数字时自动靠右（人日那一列）', () => {
  const h = md('| 模块 | 人日 |\n|---|---|\n| 相机基架 | 2 |\n| 状态机 | 3 |\n| 合计 | 16 |')
  assert.match(h, /<th class="is-right">人日<\/th>/)
  assert.match(h, /<td class="is-right">16<\/td>/)
  assert.match(h, /<td>相机基架<\/td>/, '文字那一列不该被动')
})

check('★ 一格是文字就退回默认，不瞎猜', () => {
  const h = md('| 模块 | 人日 |\n|---|---|\n| 甲 | 2 |\n| 乙 | 待估 |')
  assert.doesNotMatch(h, /is-right/)
})

/* 日期全是数字和横杠，但它是标签不是量 —— 靠右没有意义，
 * 而且窄列里会被折成「2026- / 08-19」两行。已否决清单那张表就长这样。 */
check('★★ 日期列不当数字（否则会被折行，且靠右没意义）', () => {
  const h = md('| 时间 | 试的是什么 |\n|---|---|\n| 2026-08-19 | 甲 |\n| 2026-08-20 | 乙 |')
  assert.doesNotMatch(h, /is-right/)
})

check('★ 范围和百分比仍然算数字', () => {
  const h = md('| 项 | 值 |\n|---|---|\n| 甲 | 3–5 |\n| 乙 | 21% |')
  assert.match(h, /<td class="is-right">3–5<\/td>/)
})

check('★ 作者写了对齐就听作者的，不被自动规则盖掉', () => {
  const h = md('| 模块 | 人日 |\n|---|:---:|\n| 甲 | 2 |\n| 乙 | 3 |')
  assert.match(h, /<td class="is-center">2<\/td>/)
})

check('★ 代码块带上语言标签（技术方案里 C++ 和伪码混着写）', () => {
  const h = md('```cpp\nUE_LOG(LogTemp, Warning, TEXT("x"));\n```')
  assert.match(h, /class="sd-code__lang">cpp</)
  assert.match(h, /<pre><code>UE_LOG/)
})

check('★ 代码块里的内容不被当 markdown 解析', () => {
  const h = md('```\n- 这不是列表\n**这不是加粗**\n```')
  assert.doesNotMatch(h, /<li>/)
  assert.doesNotMatch(h, /<strong>/)
})

check('★ ━━━ 当分割线（提示词里用它分隔小节）', () => {
  assert.match(md('上面\n\n━━━━━━━━\n\n下面'), /<hr>/)
})

console.log('\n策划室排版 · 不能坏的老行为')

check('★★ HTML 被转义，文档里的尖括号不会变成标签', () => {
  const h = md('用 <script>alert(1)</script> 试试')
  assert.doesNotMatch(h, /<script>/)
  assert.match(h, /&lt;script&gt;/)
})

/* 引用块是递归渲染的（为了留住里面的列表和小标题）。递归时**不能**再走一遍
 * esc + inline —— 走两遍的话 < 会变成 &amp;lt;，页面上就直接显示出
 * 「&lt;」这几个字符；加粗会变成字面的 <strong> 标签文字。 */
check('★★ 递归渲染引用块时不会二次转义', () => {
  const h = md('> 判断 a < b 时用 **这个**，别用 &')
  assert.match(h, /a &lt; b/, '尖括号该转义一次')
  assert.doesNotMatch(h, /&amp;lt;/, '转义两次的话页面上会显示出「&lt;」这几个字')
  assert.doesNotMatch(h, /&amp;amp;/, '& 同理')
  assert.match(h, /<strong>这个<\/strong>/, '引用块里的加粗要真的加粗，不能变成字面标签')
})

check('★ front matter 被剥掉，不会渲染成正文', () => {
  const h = md('---\ntitle: "立项书"\nrevision: 3\n---\n\n正文开始')
  assert.doesNotMatch(h, /revision/)
  assert.match(h, /正文开始/)
})

check('★ 标题进目录，三个以上才给目录', () => {
  const few = md('# 一\n\n正文\n\n## 二\n\n正文')
  assert.doesNotMatch(few, /sd-toc/)
  const many = md('# 一\n\n正文\n\n## 二\n\n正文\n\n## 三\n\n正文')
  assert.match(many, /sd-toc/)
  assert.match(many, /<h2 class="sd-h sd-h--1"/)
})

check('★ 整行只有一个加粗 → 当成忘了写井号的小标题', () => {
  assert.match(md('**核心循环**'), /<h4 class="sd-h sd-h--3"/)
})

check('★ 行内代码和链接照常', () => {
  const h = md('用 `Geometry Script` 做布尔，见 [文档](https://example.com/a)')
  assert.match(h, /<code>Geometry Script<\/code>/)
  assert.match(h, /<a href="https:\/\/example\.com\/a" target="_blank"/)
})

check('★★ 空输入不炸', () => {
  assert.equal(typeof md(''), 'string')
  assert.equal(typeof md(null), 'string')
  assert.equal(typeof md(undefined), 'string')
})

check('★★ 一份真实文档跑下来，标签是配平的', () => {
  const doc = [
    '---', 'title: "立项书"', '---', '',
    '# 一句话', '', '俯视角解谜：你不直接移动角色，而是改变地形属性。', '',
    '## 目标观众', '',
    '1. **比赛评委** —— 前十几秒看到什么', '   这一条还有半句', '2. **面试官** —— 会追问哪个技术点', '',
    '## 差异化', '',
    '✗「市面上很少有」', '✓「和 Maquette 的差别是你被棋盘规则约束」', '',
    '> ⚠️ 这一条撞了硬约束', '>', '> - 美术要原创', '> - 所以不可行', '',
    '| 系统 | 人日 |', '|:---|---:|', '| 核心循环 | 12 |', '',
    '```cpp', 'int main() { return 0; }', '```', '',
    '━━━━━━━━', '', '## 这一份我到底该怎么读', '', '看两节就够。'
  ].join('\n')
  const h = md(doc)
  const open = (t) => (h.match(new RegExp('<' + t + '(\\s[^>]*)?>', 'g')) || []).length
  const close = (t) => (h.match(new RegExp('</' + t + '>', 'g')) || []).length
  ;['ul', 'ol', 'li', 'p', 'blockquote', 'table', 'pre', 'div'].forEach(t =>
    assert.equal(open(t), close(t), `<${t}> 没配平：开 ${open(t)} 闭 ${close(t)}`))
  assert.match(h, /sd-toc/)
  assert.match(h, /sd-eg is-bad/)
  assert.match(h, /sd-quote is-warn/)
  assert.match(h, /is-right/)
})

console.log(`\n${pass} 项通过`)
