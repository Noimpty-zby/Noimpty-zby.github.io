/* 策划室的模型调用。
 *
 * 为什么和娜娜莉日常那套（tools/daily-report/narrate.mjs）分开：
 *
 * 日常那些活儿 —— 写日报、回评论、给文章加批注 —— 是「说几句话」，
 * 便宜模型完全够用，错了也只是一句话不好听。
 *
 * 策划书不是。它要读进上一版的全文、对照总纲里的硬约束、
 * 找出自己上次写错的地方、然后改写。这是**长上下文 + 自我批判**，
 * 是模型能力差距最大的地方，也是省不得的地方 ——
 * 一份写得含糊的策划书比没有更糟：它会让人照着一个错的方向做三个月。
 *
 * 所以这里默认走 Claude。没配 ANTHROPIC_API_KEY 时降级到 DeepSeek，
 * 并在日志里明说降级了（别让人以为拿到的是同一档质量）。
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''
const ANTHROPIC_BASE = (process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '')

/* 模型名会变。写死一个名字，等它下线的那天整条流水线就静默停了。
 * 所以留成环境变量，默认值只是「当下的合理选择」。
 * 想换：在工作流里设 STUDIO_MODEL。 */
const MODEL = process.env.STUDIO_MODEL || 'claude-sonnet-4-5'
const DEEP_MODEL = process.env.STUDIO_DEEP_MODEL || 'claude-opus-4-5'

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '')
const DEEPSEEK_MODEL = process.env.DEEPSEEK_PRO_MODEL || 'deepseek-v4-pro'

/* DeepSeek 的思考档位：low / high / max。
 *
 * 注意 high 就是**默认值** —— 写 high 等于什么都没写。
 * 而且官方的映射是 low→low、medium/high→high、只有 max 才真的拉满。
 *
 * 策划这活儿的价值几乎全在「想」那一步：对照否决清单、估工作量、
 * 判断自己上一版哪里写错了。这些都是推理，不是写作。
 * 一周只跑三次，多想那点钱不值一提，所以默认 max。 */
const DEEPSEEK_EFFORT = process.env.DEEPSEEK_EFFORT || 'max'

export const backend = () => (ANTHROPIC_KEY ? 'claude' : (DEEPSEEK_KEY ? 'deepseek' : 'none'))

export const describeBackend = () => ({
  claude: `Claude（${MODEL} / 深度步骤用 ${DEEP_MODEL}，扩展思考开）`,
  deepseek: `DeepSeek（${DEEPSEEK_MODEL}，思考档位 ${DEEPSEEK_EFFORT}）—— 降级模式，没配 ANTHROPIC_API_KEY`,
  none: '没有可用的模型 —— ANTHROPIC_API_KEY 和 DEEPSEEK_API_KEY 都没配'
}[backend()])

// ---------------- Claude ----------------

const askClaude = async ({ system, user, maxTokens, deep, timeout, thinkingBudget }) => {
  const model = deep ? DEEP_MODEL : MODEL
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }]
  }
  /* 扩展思考。策划这活儿的价值几乎全在「想」那一步 ——
   * 对照否决清单、估工作量、判断自己上一版哪里错了，都是推理不是写作。
   * budget_tokens 必须小于 max_tokens，官方要求。 */
  if (deep) {
    const budget = Math.min(thinkingBudget || 12000, Math.max(1024, maxTokens - 4000))
    body.thinking = { type: 'enabled', budget_tokens: budget }
  }

  const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  })

  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    const err = new Error(`${res.status} ${text}`)
    err.retryable = res.status === 429 || res.status >= 500
    throw err
  }

  const data = await res.json()
  // thinking 开着时 content 里会有 thinking 块，只取 text
  const out = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  if (!out) {
    throw new Error(data.stop_reason === 'max_tokens'
      ? `正文是空的（stop_reason=max_tokens，max_tokens=${maxTokens} 被推理吃光了，调大）`
      : `正文是空的（stop_reason=${data.stop_reason || '未知'}）`)
  }
  return out
}

// ---------------- DeepSeek 兜底 ----------------

const askDeepSeek = async ({ system, user, maxTokens, deep, timeout }) => {
  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      thinking: { type: deep ? 'enabled' : 'disabled' },
      /* 思考模式下 temperature / top_p / penalty 全部无效（官方明说不报错但也不生效），
       * 所以这两条是互斥的，别同时发。 */
      ...(deep ? { reasoning_effort: DEEPSEEK_EFFORT } : { temperature: 0.6 }),
      max_tokens: maxTokens
    }),
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    const err = new Error(`${res.status} ${text}`)
    err.retryable = res.status === 429 || res.status >= 500
    throw err
  }
  const data = await res.json()
  const choice = data.choices?.[0] || {}
  const out = String(choice.message?.content || '').trim()
  if (!out) throw new Error(`正文是空的（finish_reason=${choice.finish_reason || '未知'}）`)
  return out
}

// ---------------- 对外 ----------------

/**
 * @param {string} system
 * @param {string} user
 * @param {object} opts
 *   maxTokens  默认 8000。策划文档动辄几千字，别抠这个。
 *   deep       走更强的模型 + 扩展思考。立项评审、修订、停更判断都该开。
 *   retries    失败重试次数，默认 2。这套流水线一周只跑三次，
 *              一个 502 等于这一次白跑，所以重试不能省。
 *   timeout    毫秒。deep 默认 10 分钟。
 *   label      写进日志，方便对照是哪一步失败的。
 */
export const ask = async (system, user, opts = {}) => {
  const which = backend()
  if (which === 'none') { ask.lastError = '没有配置任何模型 API Key'; return null }

  const maxTokens = opts.maxTokens || 8000
  const deep = !!opts.deep
  const timeout = opts.timeout || (deep ? 600000 : 180000)
  const tries = Math.max(1, 1 + (opts.retries == null ? 2 : opts.retries))
  const tag = `studio/${which}${deep ? '+deep' : ''}${opts.label ? '/' + opts.label : ''}`

  let lastWhy = '未知原因'
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const args = { system, user, maxTokens, deep, timeout, thinkingBudget: opts.thinkingBudget }
      return which === 'claude' ? await askClaude(args) : await askDeepSeek(args)
    } catch (e) {
      lastWhy = String(e.message || e).slice(0, 240)
      const more = e.retryable !== false && attempt < tries
      console.error(`  [${tag}] 第 ${attempt}/${tries} 次失败：${lastWhy}${more ? '，等一下再试' : ''}`)
      if (!more) break
      await new Promise(r => setTimeout(r, 6000 * 2 ** (attempt - 1)))
    }
  }
  ask.lastError = lastWhy
  return null
}
