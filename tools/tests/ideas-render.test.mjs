/* 点子文章的排版测试。
 *
 * 主人的原话：「我看了点子的文章可读性很差，不美观，感觉纯是文字的堆砌，
 * 里面有东西但是没有让人阅读的欲望。」
 *
 * 那次的根因不是审美，是渲染器有洞：她写的引用角标是 [[1]](网址) 这种双层方括号，
 * 而链接正则写的是 \[([^\]\n]+)\]\(...\) —— [^\]] 在里面那个 ] 就停了，整条匹配不上。
 * 于是每个引用都原样露出来，正文里插满长长的裸网址，看着当然像文字堆砌。
 *
 * 所以这个文件盯的是「渲染出来的东西里不该有 markdown 残渣」：
 *   - 角标必须变成上标，正文里不许再出现裸网址
 *   - 表格必须是 table，不是一堆竖线
 *   - ===结束=== 这类她自己加的标记必须清掉
 *   - 每个机制要各自成节，否则又是一根柱子
 *   - 她换个写法（忘了井号、标题里塞角标）也不能渲染坏
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ideas-vault.js 是给浏览器写的 IIFE。这里造一个最小的 window/document
// 把它跑起来，再把 md2html 抠出来测 —— 测的就是线上真正跑的那份代码。
const md2html = (() => {
  const src = readFileSync(join(process.cwd(), 'source/js/ideas-vault.js'), 'utf8')
  const g = globalThis
  g.window = { addEventListener() {} }
  g.document = { getElementById: () => null }
  g.localStorage = { getItem: () => null }
  const patched = src
    .replace('(() => {', '(() => {\n  const __hand = () => { globalThis.__md2html = md2html }')
    .replace(/\n  mount\(\)\n/, '\n  __hand()\n')
  ;(0, eval)(patched)
  if (typeof globalThis.__md2html !== 'function') throw new Error('没能从 ideas-vault.js 里取出 md2html')
  return globalThis.__md2html
})()

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

console.log('\n点子排版：引用角标（就是这个洞让文章看着像文字堆砌）')

check('★ [[1]](网址) 渲染成上标，正文里不留裸网址', () => {
  const h = md2html('场景按 BPM 呼吸 [[1]](https://a.example/hifi)。判定窗口 ±120ms。')
  assert.ok(/<sup class="iv-cite">/.test(h), '没做成上标角标')
  assert.ok(/<a href="https:\/\/a\.example\/hifi"/.test(h), '角标没挂上链接')
  assert.ok(!/\[\[1\]\]/.test(h), '原始的 [[1]] 还露在正文里')
  assert.ok(!/>[^<]*https:\/\//.test(h), '正文里还有裸网址：' + h)
})

check('★ 多个角标各自独立，编号不串', () => {
  const h = md2html('甲 [[1]](https://a.example/x) 乙 [[2]](https://b.example/y)')
  const nums = [...h.matchAll(/<sup class="iv-cite"><a[^>]*>(\d+)<\/a>/g)].map(m => m[1])
  assert.deepEqual(nums, ['1', '2'])
})

check('普通的 [文字](网址) 照常是链接', () => {
  const h = md2html('看 [这份拆解](https://a.example/x) 就懂了。')
  assert.ok(/<a href="https:\/\/a\.example\/x"[^>]*>这份拆解<\/a>/.test(h))
})

check('★ 角标链接一律新标签页打开、带 noopener', () => {
  const h = md2html('甲 [[1]](https://a.example/x)')
  assert.ok(/target="_blank"/.test(h) && /rel="noopener noreferrer"/.test(h))
})

check('★ 只有 http/https 会变成链接，javascript: 原样当文字', () => {
  const h = md2html('点 [[1]](javascript:alert(1)) 和 [坏的](javascript:alert(2))')
  // 判据是「有没有生成 href」，不是「文本里有没有出现这几个字」——
  // 转义之后当文字显示是安全的，当链接才不安全。
  assert.ok(!/href="javascript:/i.test(h), 'javascript: 变成链接了：' + h)
  assert.ok(!/<a\b/.test(h), '根本不该生成任何链接：' + h)
})

check('★ 网址里带引号也撑不开属性', () => {
  const h = md2html('甲 [[1]](https://a.example/x"onmouseover="alert(1))')
  // 注意：href="…&quot;onmouseover=&quot;…" 是安全的 —— 实体在属性解析之后才还原，
  // 不会变成第二个属性。所以这里要找的是「标签里出现了没被转义的事件属性」，
  // 而不是把实体还原之后再找。这一条已经在真实浏览器里用 DOM 核对过。
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(h), '标签里冒出了事件属性：' + h)
  assert.ok(/href="https:\/\//.test(h), '正经的 https 链接被误伤了：' + h)
})

console.log('\n点子排版：她自己加的标记要清掉')

check('★ ===结束=== / ===正文=== 不许漏进正文', () => {
  const h = md2html('正文一段。\n\n===结束===\n')
  assert.ok(!/===/.test(h), '收尾标记还在：' + h)
  assert.ok(/正文一段/.test(h), '把正文也一起吃掉了')
})

check('★ 标题里的角标被摘掉（标题挂角标很难看）', () => {
  const h = md2html('## 全局节拍（出自《X》）→ 解决问题 1 [[2]](https://b.example/y)\n\n正文。')
  assert.ok(!/iv-cite/.test(h.split('</h3>')[0]), '标题里还挂着角标')
  assert.ok(/解决问题 1/.test(h), '把标题内容也切没了')
})

check('整行只有加粗 = 她忘了写井号，掰成小标题', () => {
  const h = md2html('**为什么它比打分好**\n\n因为音乐本身变了。')
  assert.ok(/<h4>为什么它比打分好<\/h4>/.test(h), '没掰成小标题：' + h)
})

console.log('\n点子排版：结构')

check('★ 每个机制各自成节（否则从头到尾一根柱子）', () => {
  const h = md2html('引子。\n\n## 甲（出自《A》）→ 解决问题 1\n\n内容一。\n\n## 乙（出自《B》）→ 解决问题 2\n\n内容二。')
  assert.equal((h.match(/<section class="iv-sec"/g) || []).length, 2)
  assert.equal((h.match(/<\/section>/g) || []).length, 2, '节没有正确闭合')
})

check('★ 小标题拆成 机制名 / 出处 / 解决问题 N 三块', () => {
  const h = md2html('## 全局节拍可视化（出自《Hi-Fi RUSH》）→ 解决问题 1\n\n内容。')
  assert.ok(/<h3 class="iv-sec__h">全局节拍可视化/.test(h), '机制名没拆出来')
  assert.ok(/<span class="iv-sec__tag">解决问题 1<\/span>/.test(h), '问题角标没拆出来')
  assert.ok(/出自 《Hi-Fi RUSH》/.test(h), '出处没拆出来')
})

check('她换了写法（不带出自、不带箭头）也不能渲染坏', () => {
  const h = md2html('## 就一个普通标题\n\n内容。')
  assert.ok(/<h3 class="iv-sec__h">就一个普通标题<\/h3>/.test(h), h)
})

check('★ 两个以上机制才生成目录，一个的时候不生成', () => {
  const two = md2html('## 甲 → 解决问题 1\n\nx\n\n## 乙 → 解决问题 2\n\ny')
  assert.ok(/<nav class="iv-toc">/.test(two), '两节应该有目录')
  assert.equal((two.match(/<a href="#iv-s/g) || []).length, 2)
  const one = md2html('## 甲 → 解决问题 1\n\nx')
  assert.ok(!/iv-toc/.test(one), '只有一节不该有目录')
})

check('目录锚点和小节 id 对得上（点了要能跳）', () => {
  const h = md2html('## 甲 → 问题 1\n\nx\n\n## 乙 → 问题 2\n\ny')
  const ids = [...h.matchAll(/<section class="iv-sec" id="([^"]+)"/g)].map(m => m[1])
  const hrefs = [...h.matchAll(/<a href="#([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(hrefs, ids)
})

check('★ 「**标签** —— 内容」拆成标签 + 内容两块', () => {
  const h = md2html('1. **它到底怎么运作** —— 同一把武器有四种形态。')
  assert.ok(/<li class="iv-kv">/.test(h), '没识别成带标签的条目：' + h)
  assert.ok(/<b class="iv-kv__k">它到底怎么运作<\/b>/.test(h))
  assert.ok(/<span class="iv-kv__v">同一把武器有四种形态。<\/span>/.test(h))
})

check('普通列表项不会被误当成带标签的条目', () => {
  const h = md2html('- 打得准 → 加一层旋律轨')
  assert.ok(!/iv-kv/.test(h), h)
  assert.ok(/<li>打得准 → 加一层旋律轨<\/li>/.test(h))
})

console.log('\n点子排版：表格 / 代码 / 引用')

check('★ markdown 表格渲染成 table，不是一堆竖线', () => {
  const h = md2html('| 维度 | 代价 |\n|---|---|\n| 音色分层 | 中 |\n| 数字评分 | 低 |')
  assert.ok(/<table>/.test(h), '没渲染成表格：' + h)
  assert.equal((h.match(/<th>/g) || []).length, 2)
  assert.equal((h.match(/<tr>/g) || []).length, 3)
  assert.ok(!/\|/.test(h.replace(/<[^>]+>/g, '')), '正文里还有竖线')
})

check('表格后面的正文照常渲染（不会被表格吃掉）', () => {
  const h = md2html('| a | b |\n|---|---|\n| 1 | 2 |\n\n后面这段要还在。')
  assert.ok(/后面这段要还在/.test(h))
})

check('长得像表格但没有分隔行的，不当表格处理', () => {
  const h = md2html('|这只是一句话里带了竖线|')
  assert.ok(!/<table>/.test(h))
})

check('代码块原样保留，里面的 markdown 不被解析', () => {
  const h = md2html('```cpp\nint a = **x**; // [[1]](https://a.example/y)\n```')
  assert.ok(/<pre><code>/.test(h))
  assert.ok(/\*\*x\*\*/.test(h), '代码块里的星号被当成加粗了')
  assert.ok(!/iv-cite/.test(h), '代码块里的角标被当成引用了')
})

check('行内代码里的星号也不被当成加粗', () => {
  const h = md2html('写成 `a ** b` 就行。')
  assert.ok(/<code>a \*\* b<\/code>/.test(h), h)
})

check('多行引用合成一个 blockquote', () => {
  const h = md2html('> 第一行\n> 第二行')
  assert.equal((h.match(/<blockquote>/g) || []).length, 1)
  assert.equal((h.match(/<\/blockquote>/g) || []).length, 1)
})

console.log('\n点子排版：来源清单')

check('★ 来源清单单独成块，并显示域名', () => {
  const h = md2html('正文。\n\n---\n\n### 参考来源\n\n1. [某个拆解](https://a.example/hifi)\n2. [另一个](https://b.example/x)')
  assert.ok(/<ol class="iv-refs">/.test(h), '来源清单没套上样式：' + h)
  assert.ok(/<span class="iv-refs__host">a\.example<\/span>/.test(h), '没显示域名')
  assert.ok(/<h3 class="iv-refs__head">/.test(h))
})

check('★ 来源清单前面那条分隔线要去掉（否则卡片底部多一道横杠）', () => {
  const h = md2html('正文。\n\n---\n\n### 参考来源\n\n1. [x](https://a.example/x)')
  assert.ok(!/<hr>/.test(h), '多余的分隔线还在：' + h)
})

check('来源清单不会被包进上一个机制的卡片里', () => {
  const h = md2html('## 甲 → 问题 1\n\nx\n\n### 参考来源\n\n1. [x](https://a.example/x)')
  assert.ok(h.indexOf('</section>') < h.indexOf('iv-refs__head'), '来源被塞进小节里了')
})

console.log('\n点子排版：整篇跑一遍（就是她真实的输出形状）')

const REAL = `---
title: "把「听得懂」做成判定"
stars: 4
---

这次挑的两个，分别对应第 1 和第 2 个问题。

## 全局节拍可视化（出自《Hi-Fi RUSH》）→ 解决问题 1

1. **它到底怎么运作** —— 场景按 BPM 呼吸 [[1]](https://a.example/hifi)。
2. **代价和风险** —— 美术风格会被锁死。

## 连段音色分层（出自《NecroDancer》）→ 解决问题 2

窝觉得这个才是该抄的 [[2]](https://b.example/x)。

| 维度 | 可读性 |
|---|---|
| 音色分层 | 高 |

===结束===

---

### 参考来源

1. [Hi-Fi RUSH GDC](https://a.example/hifi)
2. [NecroDancer postmortem](https://b.example/x)
`

check('★ 真实形状：该有的结构都在，不该有的残渣都没了', () => {
  const h = md2html(REAL)
  assert.ok(/iv-toc/.test(h), '没有目录')
  assert.equal((h.match(/<section class="iv-sec"/g) || []).length, 2, '机制没有各自成节')
  assert.equal((h.match(/<sup class="iv-cite">/g) || []).length, 2, '角标数不对')
  assert.ok(/<table>/.test(h), '表格没渲染')
  assert.ok(/<ol class="iv-refs">/.test(h), '来源清单没渲染')
  assert.ok(/iv-lead/.test(h), '开头那段没有单独样式')

  const plain = h.replace(/<[^>]+>/g, '')
  assert.ok(!/===/.test(plain), '收尾标记漏出来了')
  assert.ok(!/https?:\/\//.test(plain), '正文里还有裸网址')
  assert.ok(!/\[\[/.test(plain), '原始角标漏出来了')
  assert.ok(!/^---$/m.test(plain), 'front matter 漏出来了')
  assert.ok(!/stars:/.test(plain), 'front matter 漏出来了')
})

check('★ 开场那段排在目录前面（先说清讲什么，再给跳转清单）', () => {
  const h = md2html('这次挑的两个。\n\n## 甲 → 问题 1\n\nx\n\n## 乙 → 问题 2\n\ny')
  assert.ok(h.indexOf('iv-lead') < h.indexOf('iv-toc'), '目录跑到开场白前面了')
  assert.ok(h.indexOf('iv-toc') < h.indexOf('iv-sec'), '目录跑到正文后面了')
})

check('★ 她没分节、通篇两大段时，第一段不套开场白的框', () => {
  // 套上去会变成「一个粉色大框里塞了两百字」，比不做样式还难看
  const long = '这个机制来自某个游戏，做法是把判定窗口拉宽。'.repeat(8)
  const h = md2html(long + '\n\n另一段。')
  assert.ok(!/iv-lead/.test(h), '长段落被当成开场白了')
})

check('★ 开场那段里的行内代码要正常还原（占位符曾经漏在这里）', () => {
  // 把开场白单独拎出来做样式之后，占位符还原只跑在剩下那半边，
  // 于是第一段里的代码变成了一个看不见的占位字符。
  const h = md2html('先用 `AnimNotify` 打个点。\n\n## 甲 → 问题 1\n\nx')
  assert.ok(/<code>AnimNotify<\/code>/.test(h), '开场白里的行内代码没还原：' + JSON.stringify(h.slice(0, 120)))
  assert.ok(!/\u0000/.test(h), '渲染结果里残留了占位符')
})

check('★ 结尾那句「只能先做一个选哪个」单独站出来，不被包进最后一张卡片', () => {
  const h = md2html('## 甲 → 问题 1\n\nx\n\n结尾：如果只能先做一个，选甲。')
  assert.ok(/<p class="iv-final">/.test(h), '结尾没被拎出来：' + h)
  assert.ok(h.indexOf('</section>') < h.indexOf('iv-final'), '结尾还在卡片里')
})

check('空的 / 垃圾输入不会炸', () => {
  assert.equal(typeof md2html(''), 'string')
  assert.equal(typeof md2html(null), 'string')
  assert.equal(typeof md2html('#'), 'string')
  assert.equal(typeof md2html('|||'), 'string')
  assert.equal(typeof md2html('## '), 'string')
})

check('★ HTML 被钝化，不给她的输出留下注入口子', () => {
  const h = md2html('<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>')
  assert.ok(!/<img/i.test(h) && !/<script/i.test(h), h)
  assert.ok(/&lt;img/.test(h))
})

console.log(`\n${pass} 项通过`)
