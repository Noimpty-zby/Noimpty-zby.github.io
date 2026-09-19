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
  'globalThis.__x = { humanGap, withTimeMarks, wantsBrain, HISTORY_SEND, historyWindow }', ctx)
const { humanGap, withTimeMarks, wantsBrain, HISTORY_SEND, historyWindow } = ctx.__x
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
  assert.equal(wantsBrain('帮我分析第三章那部分应该怎样重新组织'), true)
  assert.equal(wantsBrain('今天散步看到很多可爱的小猫，回来想和你说说这些轻松的小事'), false, '不能只因超过二十字就强制升档')
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

console.log('\n对话窗口 · 消息的顺序（决定能不能命中缓存）')

/* 一条规矩：越不变的越往前排。谁排在「变的东西」后面，谁就每轮按未命中重发。
 *
 *   人设 → 读时间的规矩+文章清单 → 正文/检索材料 → 站点地图 → 历史 → 现在几点+记忆
 *
 * 这四条各钉住其中一段。 */

check('人设永远是第一条（它一个字都不变，是最该被缓存的那块）', () => {
  const body = cut('const buildMessages', 'return msgs')
  assert.match(body, /const msgs = \[\{ role: 'system', content: PERSONA \}\]/)
})

check('★★ 读时间的规矩 + 文章清单紧跟人设，排在正文和检索材料前面', () => {
  const body = cut('const buildMessages', 'return msgs')
  const rules = body.indexOf('TIME_RULES')
  const metadata = body.indexOf('Promise.all([postDigest(), selfLog()])')
  const research = body.indexOf('research.prepare(')
  const evidence = body.indexOf('content: result.context')
  assert.ok(metadata > 0 && rules > metadata && research > rules && evidence > research, '元数据或真实检索材料顺序不完整')
  assert.ok(rules < evidence,
    '规矩和文章清单又被挪到正文/检索材料后面了 —— 那 1800 字会每轮按未命中重发')
})

check('★★ 站点地图是条件插入的，必须压在正文后面', () => {
  const body = cut('const buildMessages', 'return msgs')
  const art = body.indexOf('content: result.context')
  const map = body.indexOf('站点地图（操作URL只能从这里挑')
  assert.ok(map > art,
    '地图挪到正文前面了 —— 一句带「去」「找」的闲话就会把最多 12000 字的正文缓存踩掉')
})

check('★★ 每轮都变的排最后：历史在前，「现在几点」和「他最近问过」在后', () => {
  const body = cut('const buildMessages', 'return msgs')
  const hist = body.indexOf('withTimeMarks(')
  const now = body.indexOf('nowLine()')
  const mem = body.indexOf('memoryDigest()')
  assert.ok(hist > 0 && now > 0 && mem > 0, '切片里少了东西')
  assert.ok(now > hist, '「现在几点」又排到历史前面了 —— 它每分钟都变，整段历史会跟着重发')
  assert.ok(mem > hist, '「他最近问过」每说一句就变一次，不能排在历史前面')
})

check('★★ 行动日志与文章清单并行读取，快照排在检索材料和当前时间前', () => {
  const body = cut('const buildMessages', 'return msgs')
  const self = body.indexOf('selfLog()')
  const art = body.indexOf('content: result.context')
  const now = body.indexOf('nowLine()')
  assert.ok(self > 0, '行动日志没进提示词 —— 她又不知道自己今天干了什么了')
  assert.ok(self < art, '行动日志快照应与元数据一起排在动态检索材料前')
  assert.ok(self < now, '行动日志不该排在「现在几点」后面')
})

check('★★ 人设里要写死「你不只是这个聊天框」', () => {
  const p = cut('const PERSONA = `', '【被夸奖时】')
  assert.match(p, /你不只是这个聊天框/, '这一节没了 —— 她会答成「窝只是个聊天助手」')
  assert.match(p, /窝只是个聊天助手/, '缺少那条明确的反例')
  assert.match(p, /巡逻/, '没告诉她自己还会巡逻')
  assert.match(p, /随笔/, '没告诉她自己还会写随笔')
})

console.log('\n对话窗口 · 送哪一段历史')

const turns = n => Array.from({ length: n }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user', content: '第 ' + i + ' 条', at: NOON + i * MIN
}))

check('短对话原样全送', () => {
  const list = turns(6)
  const out = historyWindow(list)
  assert.equal(out.list.length, 6)
  assert.equal(out.anchorAt, list[0].at)
})

check('★★ 起点钉住：又说了两句，送出去那一段的起点不变（前缀才接得上）', () => {
  const first = historyWindow(turns(18))
  const next = historyWindow(turns(20), first.anchorAt)
  assert.equal(next.anchorAt, first.anchorAt,
    '窗口每轮往前挪了一条 —— 整段历史（十几条、几千 token）每轮都会按未命中重发')
  assert.equal(next.list[0].content, first.list[0].content)
})

check('长到上限才重新取一段，一次挪一整段', () => {
  const first = historyWindow(turns(18))
  const over = historyWindow(turns(30), first.anchorAt)
  assert.notEqual(over.anchorAt, first.anchorAt, '超过上限了还不重新取')
  assert.equal(over.list.length, HISTORY_SEND, '重新取的时候应该正好取最近 HISTORY_SEND 条')
})

check('锚找不着（老历史没有 at、或者那条已经被挤出去了）退回最近那一段，不炸', () => {
  const old = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: '旧的 ' + i }))
  const out = historyWindow(old, 12345)
  assert.equal(out.list.length, HISTORY_SEND)
  assert.equal(out.anchorAt, 0, '没有 at 的历史不该编一个锚出来')
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

console.log('\n对话窗口 · 本地快速通道（别把真问题当成导航吞掉）')

const navCtx = vm.createContext({})
vm.runInContext(
  cut('  const SECTIONS = [', '  const absUrl') +
  cut('  const norm = t =>', '  // 站点地图') +
  cut('  const NAV_RE =', '  const tryLocalCommand') +
  '\nglobalThis.__n = { SECTIONS, norm, similarity, NAV_RE }', navCtx)
const { SECTIONS, norm, similarity, NAV_RE } = navCtx.__n

// tryLocalCommand 那段带 DOM，切不出来直接跑，所以这里照抄它的两道门槛。
// 线上的地图还会带上全部文章，extra 就是用来补那几条的。
const decide = (t, extra = []) => {
  const m = t.match(NAV_RE)
  if (!m) return 'model'
  const q = norm(m[2])
  const scored = [...SECTIONS, ...extra].map(item => {
    let best = similarity(q, norm(item.label))
    item.alias.forEach(a => { best = Math.max(best, similarity(q, norm(a))) })
    return { item, score: best }
  }).sort((a, b) => b.score - a.score)
  const [first, second] = scored
  if (first.score >= 0.62 && (!second || first.score - second.score >= 0.12)) return 'goto:' + first.item.label
  const cands = first.score >= 0.6 ? scored.filter(x => x.score >= 0.5).slice(0, 4) : []
  return cands.length >= 2 ? 'choose' : 'model'
}

check('★★ 别名藏在问句里，不许当成导航 —— 那等于把问题整句吞掉', () => {
  assert.equal(decide('看一下我的 Git 笔记里有没有写 amend'), 'model')
  assert.equal(decide('看看 Linux 那篇讲的 man -k 是什么意思'), 'model')
  assert.equal(decide('看看这段递归为什么会栈溢出'), 'model')
  assert.equal(decide('去掉这个循环会怎么样'), 'model')
})

check('★ 真要跳转的还是照跳', () => {
  assert.equal(decide('打开资讯'), 'goto:资讯')
  assert.equal(decide('去日程'), 'goto:日程')
  assert.equal(decide('看看 GAMES101'), 'goto:GAMES101')
})

check('★★ 两个方向的「包含」不是一回事：打简称要跳，蹭到别名不跳', () => {
  // 真文章标题长这样，别名 git 只占它很小一截
  const post = [{ label: 'Git 第一章：工作区、暂存区、仓库 —— 一次改动的三段路', alias: [] }]
  // 查询 ⊂ 页面名 = 打了个简称
  assert.equal(decide('去 Git 第一章', post), 'goto:Git 第一章：工作区、暂存区、仓库 —— 一次改动的三段路',
    '按简称跳文章又跳不动了')
  // 页面名 ⊂ 查询 = 一句真问题恰好蹭到别名
  assert.equal(decide('看一下我的 Git 笔记里有没有写 amend', post), 'model')
})

check('★ 本地自己办掉的那几件事要进历史，不能只画在屏幕上', () => {
  assert.match(src, /const say = \(mine, hers\) => \{ addMsg\('me', mine\); addMsg\('her', hers\); logTurn\(mine, hers\)/,
    'tryLocalCommand 里的 say 不见了')
  assert.match(cut('  const afterNav = ()', '  // 本地快速通道'), /logHer\(line\)/,
    '跳转之后那句话又只画在屏幕上了')
})

console.log('\n对话窗口 · 「上网搜」「全站搜」两个前缀')

const modeCtx = vm.createContext({})
vm.runInContext(
  cut('  const WEB_PREFIX', '  /* 这几条消息的') +
  cut('  const modeOf = t =>', '  const submit') +
  '\nglobalThis.__m = { modeOf, WEB_PREFIX, SITE_PREFIX }', modeCtx)
const { modeOf, WEB_PREFIX, SITE_PREFIX } = modeCtx.__m

check('★★ 冒号是必须的：「上网搜索是怎么实现的」不许真花钱去联网搜', () => {
  assert.equal(modeOf('上网搜索是怎么实现的'), 'article')
  assert.equal(modeOf('上网搜功能用不了'), 'article')
  assert.equal(modeOf('上网搜：DeepSeek 最新价格'), 'web')
})

check('★ 判断模式和剥前缀用同一份正则（以前「全站搜：」剥得掉却认不出）', () => {
  assert.equal(modeOf('全站搜：递归'), 'site')
  assert.equal(modeOf('全站搜一下：递归'), 'site')
  assert.equal('全站搜：递归'.replace(SITE_PREFIX, ''), '递归')
  assert.equal('全站搜一下：递归'.replace(SITE_PREFIX, ''), '递归')
  assert.equal('上网搜：今天的新闻'.replace(WEB_PREFIX, ''), '今天的新闻')
})

console.log('\n对话窗口 · 中断')

check('★★ full 必须声明在 try 外面 —— catch 里那句清理要读它', () => {
  const send = cut('  const send = async (', '  // ---------------- 事件')
  const decl = send.indexOf('let full')
  const tryAt = send.indexOf('    try {')
  assert.ok(decl > 0, '找不到 full 的声明')
  assert.ok(decl < tryAt, 'full 又被挪回 try 里面了 —— 一中断就 ReferenceError，空气泡永远删不掉')
  assert.ok(!/const full = await stream/.test(send), 'full 不能再用 const 声明在 try 里')
  assert.match(send, /logTurn\(text, part \+/, '说了一半被打断的，也要进历史')
})

check('★ 忙的时候发送键是「停」键', () => {
  assert.match(src, /busy \? stopStream\(\) : submit\(\)/, '没有叫停的办法了')
})


const checkAsync = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (error) { console.log('  ✗ ' + name + '\n      ' + error.message); process.exitCode = 1 }
}
const journalHarness = () => {
  let clock = NOON, reads = 0, fails = false
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])) } static now() { return clock } }
  const context = vm.createContext({ Date: FakeDate, searchRevision: 0, window: { NOIMPTY_SEARCH: {
    async loadJournal() { reads++; if (fails) throw new Error('LOCKED'); return [{ at: '2026-09-17T04:00:00Z', who: 'patrol', what: '已记录的巡检 ' + reads }] },
    explain: value => value
  } } })
  vm.runInContext(cut('  const JOURNAL_WHO', '  /* 怎么读时间') + '\nglobalThis.selfLog = selfLog', context)
  return { selfLog: context.selfLog, reads: () => reads, advance: ms => { clock += ms }, fail: value => { fails = value } }
}
await checkAsync('行动日志只缓存一分钟，过期重读并明确它是已发布快照', async () => {
  const h = journalHarness(), initial = await h.selfLog()
  assert.match(initial, /已发布的日志快照，不是实时运行状态/)
  h.advance(59999); assert.equal(await h.selfLog(), initial); assert.equal(h.reads(), 1)
  h.advance(2); assert.notEqual(await h.selfLog(), initial); assert.equal(h.reads(), 2)
})
await checkAsync('锁定时读不到的日志不缓存，解锁后下一次读取会恢复', async () => {
  const h = journalHarness(); h.fail(true)
  assert.match(await h.selfLog(), /现在读不出来/)
  h.fail(false); assert.match(await h.selfLog(), /已记录的巡检 2/)
  assert.equal(h.reads(), 2)
})

console.log(`\n${pass} 项通过`)
