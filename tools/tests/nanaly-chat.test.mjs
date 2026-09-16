/* 对话窗口：她凭什么知道你想干什么。
 *
 * 主人的原话是「跟个人机一样，很死板，并且间隔很长的时间他也完全不知道」。
 * 查下来是三件事叠在一起，这个文件守住修好之后的样子：
 *
 *   1. 默认跑的是便宜模型 + 显式 thinking: 'disabled' —— 没有余力揣摩意图。
 *      现在按问题分档（auto / on / off），实质问题自动上推理模型。
 *   2. 人设里有四条叠加的「少说话」命令（限字令出现两次）。模型很听话，
 *      于是你拿到电报体。现在长度跟着问题走。
 *   3. 对话历史只有 role 和 content、没有时间，而它是跨天跨周从 localStorage
 *      恢复的 —— 在她眼里你上周那句和刚才那句紧挨着。现在每条带 at，
 *      中间的空白会被标成「（这里隔了 6 天）」。
 *
 * 这是浏览器脚本，没法 import，所以按字符串边界把几段切出来在隔离作用域里求值
 * （和 news-links.test.mjs 同一个办法，测的仍是真代码）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const src = readFileSync(join(process.cwd(), 'source/js/noimpty-ai.js'), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  assert.ok(a > 0 && b > a, `切不出这一段：${from.slice(0, 24)}`)
  return src.slice(a, b)
}

// 切片里那句 `let brain = ...` 会去读 localStorage，喂它一个空壳就行
const ctx = vm.createContext({
  LS_DEEP: 'nanaly-deep-v1',
  localStorage: { getItem: () => null, setItem: () => {} }
})
vm.runInContext(
  cut('  const HISTORY_SEND', '  // 送进模型之前就到这里为止') + '\n' +
  cut('  const wantsBrainRe', '  const BRAIN_LABEL') + '\n' +
  'globalThis.__x = { humanGap, withTimeMarks, wantsBrain, HISTORY_SEND }', ctx)
const { humanGap, withTimeMarks, wantsBrain, HISTORY_SEND } = ctx.__x
const setBrain = v => vm.runInContext(`brain = ${JSON.stringify(v)}`, ctx)

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR
// 钉死一个时刻：2026-09-17 12:00（北京）。用 Date.now() 的话，
// 凌晨跑这个文件时「三小时前」会掉到前一天去，测试就成了看时辰的。
const NOON = Date.parse('2026-09-17T04:00:00Z')

console.log('\n对话窗口 · 这句话值不值得动脑子')

check('★★ 实质问题自动上推理模型（「像人机」的头号原因就在这里）', () => {
  setBrain('auto')
  assert.equal(wantsBrain('这段递归为什么会栈溢出'), true)
  assert.equal(wantsBrain('尾递归和头递归的区别'), true)
  assert.equal(wantsBrain('帮我看看这个报错'), true)
  assert.equal(wantsBrain('我想把第三章那部分重写一下，你觉得从哪儿动手比较好'), true, '二十个字以上应该一律算实质问题')
})

check('闲聊不必花三倍的钱', () => {
  setBrain('auto')
  assert.equal(wantsBrain('在吗'), false)
  assert.equal(wantsBrain('谢谢喵'), false)
  assert.equal(wantsBrain('早'), false)
})

check('★ 带检索材料回来的一律上推理（要综合、要取舍）', () => {
  setBrain('auto')
  assert.equal(wantsBrain('在吗', 'web'), true)
  assert.equal(wantsBrain('在吗', 'site'), true)
})

check('常开 / 常关两挡压过自动判断', () => {
  setBrain('on')
  assert.equal(wantsBrain('在吗'), true)
  setBrain('off')
  assert.equal(wantsBrain('这段递归为什么会栈溢出', 'web'), false)
  setBrain('auto')
})

console.log('\n对话窗口 · 隔了多久')

check('时间差说人话', () => {
  assert.equal(humanGap(30 * MIN), '30 分钟')
  assert.equal(humanGap(3 * HOUR), '3 小时')
  assert.equal(humanGap(6 * DAY), '6 天')
  assert.equal(humanGap(90 * DAY), '3 个月')
})

check('★★ 换了一天就打日期分隔线 —— 她串的就是这个', () => {
  const now = NOON
  const out = withTimeMarks([
    { role: 'user', content: '上周问的那句', at: now - 6 * DAY },
    { role: 'assistant', content: '窝当时答的，还说了「今天」', at: now - 6 * DAY },
    { role: 'user', content: '今天又来了', at: now }
  ], NOON)
  assert.match(out[0].content, /（以下是 \d{4}-\d{2}-\d{2} 说的）/, '旧那天没标日期')
  assert.ok(!out[1].content.includes('以下是'), '同一天里只标一次')
  assert.match(out[2].content, /（以下是今天 2026-09-17 说的）/, '今天这轮没跟旧对话分开，或者没写出日期')
})

check('★★ 没有 at 的老历史标成「哪天不详」，而且不许编一个日期', () => {
  const out = withTimeMarks([
    { role: 'user', content: '很久以前存下的' },
    { role: 'assistant', content: '里面可能写着「今天」' },
    { role: 'user', content: '也没有时间' }
  ])
  assert.match(out[0].content, /（以前的对话，具体哪天不详）/)
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(out[0].content), '给不知道时间的对话编了个日期')
  assert.ok(!out[1].content.includes('以前的对话'), '这一句只标一次就够')
})

check('同一天里隔太久，补一条间隔标记', () => {
  const now = NOON
  const out = withTimeMarks([
    { role: 'user', content: '早上说的', at: now - 3 * HOUR },
    { role: 'assistant', content: '窝答的', at: now - 3 * HOUR },
    { role: 'user', content: '下午又来', at: now }
  ], NOON)
  assert.match(out[2].content, /（这里隔了 3 小时）/)
})

check('同一段对话里不打任何标记（三刻钟以内）', () => {
  const now = NOON
  const out = withTimeMarks([
    { role: 'user', content: '第一句', at: now - 5 * MIN },
    { role: 'assistant', content: '第二句', at: now }
  ], NOON)
  assert.ok(!out[1].content.includes('（'), '同一段对话里不该插标记')
})

check('★ at 不能跟着发给接口，原始历史也不许被改写', () => {
  const now = Date.now()
  const src2 = [{ role: 'user', content: '原文', at: NOON }]
  const out = withTimeMarks(src2, NOON)
  assert.deepEqual(Object.keys(out[0]).sort(), ['content', 'role'])
  assert.equal(src2[0].content, '原文', 'withTimeMarks 把存着的历史改掉了')
})

check('送进模型的条数不许再缩回 8 条（长对话会失忆）', () => {
  assert.ok(HISTORY_SEND >= 12, `现在只送 ${HISTORY_SEND} 条`)
})

console.log('\n对话窗口 · 系统消息的顺序（决定能不能命中缓存）')

check('★★ 「现在几点」要排在正文后面 —— 它每分钟都变，排前面会把整篇正文的缓存踩掉', () => {
  const body = cut('const buildMessages', 'return msgs')
  const art = body.indexOf('对方正在读这篇文章')
  const now = body.indexOf('nowLine()')
  const hist = body.indexOf('withTimeMarks(')
  assert.ok(art > 0, '找不到「正在读这篇文章」那条')
  assert.ok(now > art, '「现在几点」又排到正文前面去了 —— 最多 12000 字的正文会每轮重发')
  assert.ok(now < hist, '时间应该紧挨在历史前面')
})

check('人设永远是第一条（它一个字都不变，是最该被缓存的那块）', () => {
  const body = cut('const buildMessages', 'return msgs')
  assert.match(body, /const msgs = \[\{ role: 'system', content: PERSONA \}\]/)
})

console.log('\n对话窗口 · 读时间的规矩')

check('★★ 「历史里的今天不是现在的今天」这条必须写死在提示词里（错过三次）', () => {
  const rules = cut('const TIME_RULES', 'const nowLine')
  assert.match(rules, /历史里出现的「今天」/)
  assert.match(rules, /不是现在的今天/)
  assert.match(rules, /以前的对话，具体哪天不详/)
  // 防止再被「今天提交的」污染下一轮历史
  assert.match(rules, /尽量写出具体日期/)
})

console.log('\n对话窗口 · 人设')

// 切整段人设，不是只切到技术铁律为止 —— 少切一截，就漏掉了藏在后面那半段里的
// 「限字令」（第一版就漏了，那行还在引用一个已经被删掉的规矩）
const persona = cut('const PERSONA = `', '【你能操控这个博客】')

check('★★ 「限字令」那类叠加的少说话命令已经拿掉', () => {
  assert.ok(!/限字令/.test(persona), '限字令又回来了 —— 电报体就是这么来的')
  assert.ok(!/一句能说清就绝不说两句/.test(persona))
  assert.match(persona, /长度跟着问题走/)
})

check('★ 「读懂他想干什么」那一段还在，而且明确不许反问一串问题', () => {
  assert.match(persona, /读懂他想干什么/)
  assert.match(persona, /不要反问一串澄清问题/)
  assert.match(persona, /编一个像样的答案是这里最严重的错误/)
})

console.log(`\n${pass} 项通过`)
