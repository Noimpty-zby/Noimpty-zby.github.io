/* 娜娜莉的模型调用：重试、失败原因、健康检查。
 *
 * 为什么需要它：2026-09-14 主人发了递归那篇，当晚日报的读后反馈那一格
 * 只有一句「没能调用模型，这次跳过反馈」。模型本身好好的 —— 十一个小时后
 * 同一把 key、同一个模型给同一篇文章写了三条批注 —— 挂的只是那一次调用，
 * 而那一步 tries=1，一个超时或者一个 502 就把当天唯一的机会用光了。
 *
 * 更难受的是事后查不出来：失败原因只 console.error 在 Actions 日志里，
 * 邮件上那句话对 401、429、超时、没配 key 全是同一种说法，
 * 而 Actions 的日志过一段时间就没了。工作流那晚还是全绿的。
 *
 * 所以这里守三件事：
 *   1. 不传 retries 的调用必须自带一次重试（4xx 除外，重试没有意义）
 *   2. 降级文案必须带上真实原因，而且分得清「没配 key」和「调用失败」
 *   3. 她哑了，健康检查那张表上必须有一行，不能全绿
 */
import assert from 'node:assert/strict'

let pass = 0
const check = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

// 退避是真的要睡 5 秒的。把定时器换掉，这个文件测的是逻辑不是耐心。
const realTimeout = globalThis.setTimeout
globalThis.setTimeout = fn => realTimeout(fn, 0)

// ask() 每次失败都会往 stderr 打一行。这里故意制造失败，收起来别刷屏 ——
// 顺便还要拿它验一件事：日志上看不看得出是哪一格挂的。
const logs = []
console.error = (...a) => logs.push(a.map(String).join(' '))

let sent = []
const answer = (...responses) => {
  sent = []
  let i = 0
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body))
    return responses[Math.min(i++, responses.length - 1)]()
  }
}
const said = text => () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) })
const broke = (status, body = '') => () => ({ ok: false, status, text: async () => body })
const blank = finish => () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' }, finish_reason: finish }] }) })

process.env.DEEPSEEK_API_KEY = 'test-key'
const N = await import('../../daily-report/narrate.mjs')

console.log('\n娜娜莉的模型 · 重试')

await check('★★ 不传 retries 的调用自带一次重试（递归那篇的反馈就是这么丢的）', async () => {
  answer(broke(502, 'bad gateway'), said('写好了喵'))
  assert.equal(await N.ask('sys', 'user', 100), '写好了喵')
  assert.equal(sent.length, 2, '只发了一次就放弃 —— 默认重试没生效')
})

await check('429 也重试（限流缓一下就好）', async () => {
  answer(broke(429, 'rate limited'))
  assert.equal(await N.ask('sys', 'user', 100), null)
  assert.equal(sent.length, 2)
})

await check('★ key 错、余额空这类 4xx 一次就放弃，别白烧', async () => {
  answer(broke(401, 'Authentication Fails'))
  assert.equal(await N.ask('sys', 'user', 100), null)
  assert.equal(sent.length, 1, '4xx 还重试，等于把同一个错误问了两遍')
})

await check('显式传 retries: 0 仍然只试一次（资讯那种自己算过账的调用还能退出去）', async () => {
  answer(broke(500))
  await N.ask('sys', 'user', 100, { retries: 0 })
  assert.equal(sent.length, 1)
})

await check('calls / fails 数的是逻辑调用：重试两次只算挂了一次', async () => {
  const was = { calls: N.MODEL_STATE.calls, fails: N.MODEL_STATE.fails }
  answer(broke(500))
  await N.ask('sys', 'user', 100)
  assert.equal(sent.length, 2)
  assert.equal(N.MODEL_STATE.calls - was.calls, 1)
  assert.equal(N.MODEL_STATE.fails - was.fails, 1)
})

await check('截断或过滤的非空回答不会成为完整产物，过滤不重复请求', async () => {
  for (const finish of ['length', 'content_filter']) {
    answer(() => ({ ok: true, json: async () => ({ choices: [{ message: { content: '只有一半的回答' }, finish_reason: finish }] }) }))
    assert.equal(await N.ask('sys', 'user', 100), null)
    assert.equal(sent.length, finish === 'content_filter' ? 1 : 2)
    assert.match(N.MODEL_STATE.why, /截断|过滤/)
  }
})

await check('后续成功不会抹除同轮较早失败原因，健康报告仍能定位问题', async () => {
  answer(broke(401, 'invalid key'))
  await N.ask('sys', 'user', 100)
  const previous = N.MODEL_STATE.why
  answer(said('成功'))
  assert.equal(await N.ask('sys', 'user', 100), '成功')
  assert.equal(N.MODEL_STATE.why, previous)
})

console.log('\n娜娜莉的模型 · 记账')

/* 响应里的 usage 以前被整个丢掉，于是「这个月的钱花在哪一步」查不出来 ——
 * 账单上「输入（未命中缓存）」高得离谱时，只能在本地搭探针去猜。 */
const usage = (o) => () => ({ ok: true, status: 200, json: async () => ({
  choices: [{ message: { content: '写好了' }, finish_reason: 'stop' }], usage: o }) })

await check('★★ 命中和未命中分开记（两个价钱）', async () => {
  // 用一份干净的模块实例：上面那些故意失败的调用已经把账本弄脏了
  const fresh = await import('../../daily-report/narrate.mjs?usage-detail')
  globalThis.fetch = async () => usage({
    prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens: 50 })()
  await fresh.ask('sys', 'user', 100)
  assert.equal(fresh.MODEL_STATE.tokens.hit, 800)
  assert.equal(fresh.MODEL_STATE.tokens.miss, 200)
  assert.equal(fresh.MODEL_STATE.tokens.out, 50)
  assert.match(fresh.tokenSummary(), /命中缓存 80%/)
})

await check('★ 接口没给缓存明细时整笔算未命中，不编一个好看的命中率', async () => {
  const fresh = await import('../../daily-report/narrate.mjs?usage-nodetail')
  globalThis.fetch = async () => usage({ prompt_tokens: 500, completion_tokens: 20 })()
  await fresh.ask('sys', 'user', 100)
  assert.equal(fresh.MODEL_STATE.tokens.hit, 0)
  assert.equal(fresh.MODEL_STATE.tokens.miss, 500)
  assert.match(fresh.tokenSummary(), /没有缓存明细/)
})

await check('一次都没调用过 → 不出这一行', async () => {
  const fresh = await import('../../daily-report/narrate.mjs?usage-empty')
  assert.equal(fresh.tokenSummary(), '')
})

console.log('\n娜娜莉的模型 · 降级文案要说清是哪一种失败')

await check('★★ 读后反馈的降级文案带上真实原因，不再是一句笼统的「没能调用模型」', async () => {
  answer(broke(401, 'Authentication Fails'))
  logs.length = 0
  const text = await N.reviewPost({ title: '数据结构第二章', series: '数据结构与算法', body: '正文' })
  assert.match(text, /调用模型失败/)
  assert.match(text, /401/, '邮件上看不出是 401 还是超时，等于还得去翻 CI 日志')
  assert.ok(logs.some(l => l.includes('读后反馈')), '日志里看不出是哪一格挂的')
})

await check('正文为空（max_tokens 被推理吃光）要说得能照着改', async () => {
  answer(blank('length'))
  const text = await N.reviewPost({ title: 'x', body: 'y' })
  assert.match(text, /max_tokens/)
})

await check('评论筛查跳过时同样写明原因', async () => {
  answer(broke(503))
  const r = await N.screenComments([{ who: '路人', body: '随便说点什么' }])
  assert.deepEqual(r.flagged, [], '筛查挂了不能顺手把评论判成可疑')
  assert.match(r.note, /503/)
})

// 没配 key 是另一条路径：一个请求都不发，所以也不会往日志里写任何东西。
// 它得用一份干净的模块实例来测（KEY 是 import 时读的）。
delete process.env.DEEPSEEK_API_KEY
const K = await import('../../daily-report/narrate.mjs?nokey')

await check('★ 没配 key 就说没配 key，不能把上一次调用留下的旧原因端出来', async () => {
  K.MODEL_STATE.why = '429 上一次限流留下的陈值'
  globalThis.fetch = async () => { throw new Error('没有 key 还发请求了') }
  const text = await K.reviewPost({ title: 'x', body: 'y' })
  assert.match(text, /没有配置 DEEPSEEK_API_KEY/)
  assert.doesNotMatch(text, /429/, '读到了上一次的陈值 —— 原因写错比不写更误导人')
})

console.log('\n娜娜莉的模型 · 健康检查那一行')

const { checkModel, worstOf } = await import('../../daily-report/health.mjs')

await check('★★ 她哑了整晚，这张表不能是全绿的', () => {
  const c = checkModel({ keyless: false, calls: 3, fails: 3, why: '429 rate limited' })
  assert.equal(c.level, 'bad')
  assert.ok(c.items.some(i => i.note.includes('429')), '连最后一次为什么挂都没写')
})

await check('挂了一次报警告，并且把原因带进邮件', () => {
  const c = checkModel({ keyless: false, calls: 5, fails: 1, why: 'TimeoutError' })
  assert.equal(c.level, 'warn')
  assert.ok(c.items.some(i => i.note.includes('TimeoutError')))
})

await check('只调了一次而且挂了，报警告不报红 —— 天天喊狼来了的告警等于没有告警', () => {
  assert.equal(checkModel({ keyless: false, calls: 1, fails: 1, why: 'TimeoutError' }).level, 'warn')
})

await check('全部成功 → 绿', () => {
  assert.equal(checkModel({ keyless: false, calls: 4, fails: 0, why: '' }).level, 'ok')
})

await check('没配 key → 警告，并说明这封邮件里她说的都是模板', () => {
  const c = checkModel({ keyless: true, calls: 0, fails: 0, why: '' })
  assert.equal(c.level, 'warn')
  assert.match(c.detail, /DEEPSEEK_API_KEY/)
})

await check('今天没有需要她开口的地方 → 绿，但说清是没调用过', () => {
  const c = checkModel({ keyless: false, calls: 0, fails: 0, why: '' })
  assert.equal(c.level, 'ok')
  assert.match(c.detail, /没有需要她开口/)
})

await check('worstOf：最难看的那一项说了算', () => {
  assert.equal(worstOf([{ level: 'ok' }, { level: 'warn' }, { level: 'bad' }]), 'bad')
  assert.equal(worstOf([{ level: 'ok' }, { level: 'warn' }]), 'warn')
  assert.equal(worstOf([{ level: 'ok' }]), 'ok')
  assert.equal(worstOf([]), 'ok')
})

await check('★ 健康检查自己挂掉时（checks 为空、兜底 warn），追加这一项不能把整体冲淡成 ok', () => {
  const appended = checkModel({ keyless: false, calls: 1, fails: 0, why: '' })
  assert.equal(worstOf([{ level: 'warn' }, appended]), 'warn')
})

globalThis.setTimeout = realTimeout
console.log(`\n${pass} 项通过`)
