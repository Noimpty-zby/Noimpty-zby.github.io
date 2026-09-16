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
  'globalThis.__x = { humanGap, withGaps, wantsBrain, HISTORY_SEND }', ctx)
const { humanGap, withGaps, wantsBrain, HISTORY_SEND } = ctx.__x
const setBrain = v => vm.runInContext(`brain = ${JSON.stringify(v)}`, ctx)

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR

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

check('★★ 隔了很久的那条会被标出来，模型才知道中间断过', () => {
  const now = Date.now()
  const out = withGaps([
    { role: 'user', content: '上周问的那句', at: now - 6 * DAY },
    { role: 'assistant', content: '窝当时答的', at: now - 6 * DAY },
    { role: 'user', content: '今天又来了', at: now }
  ])
  assert.match(out[2].content, /（这里隔了 6 天）/)
  assert.ok(!out[1].content.includes('这里隔了'), '同一段对话里不该插标记')
})

check('同一段对话里不打标记（三刻钟以内）', () => {
  const now = Date.now()
  const out = withGaps([
    { role: 'user', content: '第一句', at: now - 5 * MIN },
    { role: 'assistant', content: '第二句', at: now }
  ])
  assert.ok(out.every(m => !m.content.includes('这里隔了')))
})

check('★ 老历史没有 at → 不标。不知道就别瞎标', () => {
  const out = withGaps([
    { role: 'user', content: '很久以前存下的' },
    { role: 'assistant', content: '也没有时间' }
  ])
  assert.ok(out.every(m => !m.content.includes('这里隔了')))
})

check('★ at 不能跟着发给接口，原始历史也不许被改写', () => {
  const now = Date.now()
  const src2 = [{ role: 'user', content: '原文', at: now }]
  const out = withGaps(src2)
  assert.deepEqual(Object.keys(out[0]).sort(), ['content', 'role'])
  assert.equal(src2[0].content, '原文', 'withGaps 把存着的历史改掉了')
})

check('送进模型的条数不许再缩回 8 条（长对话会失忆）', () => {
  assert.ok(HISTORY_SEND >= 12, `现在只送 ${HISTORY_SEND} 条`)
})

console.log('\n对话窗口 · 系统消息的顺序（决定能不能命中缓存）')

check('★★ 「现在几点」要排在正文后面 —— 它每分钟都变，排前面会把整篇正文的缓存踩掉', () => {
  const body = cut('const buildMessages', 'return msgs')
  const art = body.indexOf('对方正在读这篇文章')
  const now = body.indexOf('await nowContext()')
  const hist = body.indexOf('withGaps(')
  assert.ok(art > 0, '找不到「正在读这篇文章」那条')
  assert.ok(now > art, 'nowContext 又排到正文前面去了 —— 最多 12000 字的正文会每轮重发')
  assert.ok(now < hist, '时间应该紧挨在历史前面')
})

check('人设永远是第一条（它一个字都不变，是最该被缓存的那块）', () => {
  const body = cut('const buildMessages', 'return msgs')
  assert.match(body, /const msgs = \[\{ role: 'system', content: PERSONA \}\]/)
})

console.log('\n对话窗口 · 人设')

const persona = cut('const PERSONA = `', '【技术问题上的铁律')

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
