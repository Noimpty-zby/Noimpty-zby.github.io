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

/* 深度步骤给推理留的余量倍数。
 * 因为推理和正文共用 max_tokens（详见 askDeepSeek 里的注释），
 * 档位 max 时推理动辄上万 token，不留余量就会出现「正文是空的」。
 * 3 倍是经验值：12000 的文档预算 → 实发 36000，推理再长也压不掉正文。 */
const DEEPSEEK_HEADROOM = Number(process.env.DEEPSEEK_HEADROOM || 3)

/* 单次调用的超时（毫秒）。
 *
 * 这两个数第一版是写死的：deep 10 分钟，普通 3 分钟。**deep 那个太短了。**
 *
 * 算一下就知道：探索这一步给的文档预算是 14000 tokens，DeepSeek 思考模式下
 * 推理和正文共用额度，乘上 3 倍余量之后实发 42000。按常见吞吐，
 * 光生成就要十几到三十分钟 —— 10 分钟本来就不够。
 *
 * 实测表现是「每一轮探索都固定超时一次，重试才过」：它卡在边界上。
 * 这不是模型能力问题，换个更强的模型只会更慢（思考更久）。
 *
 * 代价：一次真的卡住的调用会占掉更长时间。所以工作流那边的
 * timeout-minutes 要跟着放大，否则整个 job 会被 GitHub 砍掉。 */
const DEEP_TIMEOUT = Number(process.env.STUDIO_DEEP_TIMEOUT_MS || 1200000)   // 20 分钟
const FAST_TIMEOUT = Number(process.env.STUDIO_TIMEOUT_MS || 240000)         //  4 分钟

export const backend = () => (ANTHROPIC_KEY ? 'claude' : (DEEPSEEK_KEY ? 'deepseek' : 'none'))

export const describeBackend = () => ({
  claude: `Claude（${MODEL} / 深度步骤用 ${DEEP_MODEL}，扩展思考开）`,
  deepseek: `DeepSeek（${DEEPSEEK_MODEL}，思考档位 ${DEEPSEEK_EFFORT}，推理余量 ${DEEPSEEK_HEADROOM}×）—— 降级模式，没配 ANTHROPIC_API_KEY`,
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
  /* ⚠️ 思考模式下推理和正文**共用** max_tokens
   *（官方：reasoning_tokens 计在 completion_tokens 里面）。
   *
   * 所以档位一提到 max，推理链就可能把整个预算吃光，正文一个字都不剩 ——
   * 表现是 finish_reason=length 而 content 是空的。
   * 第一次把档位从 high 提到 max 时就撞上了这个，因为当时只改了档位没加预算。
   *
   * prompts.mjs 里那些 maxTokens 定的是「这份文档该写多长」，
   * 不含推理的份额。推理要多少是这一层的事，所以余量在这里加。 */
  const sendMax = deep
    ? Math.min(120000, Math.round(maxTokens * DEEPSEEK_HEADROOM))
    : maxTokens

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
      max_tokens: sendMax
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
  if (!out) {
    /* 正文空有两种，原因和对策完全不同，所以要分开说 ——
     * 上一版只打一句 finish_reason=xxx，看的人根本不知道该动哪个旋钮。
     *
     *   length：推理把预算吃光了，正文来不及写。→ 加预算 / 降档位。
     *   stop  ：它自己认为写完了，但**东西全留在思考里**，正式回答是空的。
     *           这是推理模型的常见毛病，加预算没用，得在提示词里把
     *           「正文要写在正式回答里」说死，并且重试时补一句提醒。 */
    const spent = data.usage?.completion_tokens_details?.reasoning_tokens
    const thought = String(choice.message?.reasoning_content || '').trim().length
    const err = new Error(choice.finish_reason === 'length'
      ? `正文是空的：推理把 max_tokens（${sendMax}）吃光了${spent ? `，光推理就用了 ${spent}` : ''}。`
        + ` 把 DEEPSEEK_HEADROOM 调大，或者把 DEEPSEEK_EFFORT 降到 high。`
      : `正文是空的：它自己认为写完了（finish_reason=${choice.finish_reason || '未知'}），`
        + `但内容全留在思考里${thought ? `（思考 ${thought} 字）` : ''}，正式回答一个字没有。重试时会提醒它。`)
    err.retryable = true
    err.empty = true   // 重试时给它补一句「别把答案只写在思考里」
    throw err
  }
  return out
}

// ---------------- 对外 ----------------

/* 上一次「正文是空的（finish_reason=stop）」之后，重试时补在用户消息末尾。
 *
 * 推理模型有个常见毛病：把整份答案在思考里写完，然后觉得任务完成了，
 * 正式回答就出来一个空字符串。它不是偷懒，是**分不清思考和回答的边界**。
 * 所以要明说这件事，而不是原样再问一遍。 */
const EMPTY_RETRY_NUDGE = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 上一次你的正式回答是**空的** —— 内容全留在思考过程里了。

思考是给你自己用的，我看不到。**我只能看到正式回答。**

这一次：想清楚之后，把完整的成品**完整地写进正式回答里**。
在思考里写过不算写过，必须重新完整地写一遍。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

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
  const timeout = opts.timeout || (deep ? DEEP_TIMEOUT : FAST_TIMEOUT)
  const tries = Math.max(1, 1 + (opts.retries == null ? 2 : opts.retries))
  const tag = `studio/${which}${deep ? '+deep' : ''}${opts.label ? '/' + opts.label : ''}`

  let lastWhy = '未知原因'
  let emptyLast = false   // 上一次是「东西全写在思考里」那种空
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      /* 盲目重试对「答案留在思考里」这种空是没用的 —— 同样的输入大概率同样的结果。
       * 所以这一次要在用户消息后面补一句，明确告诉它上次哪里错了。 */
      const args = {
        system, user: emptyLast ? user + EMPTY_RETRY_NUDGE : user,
        maxTokens, deep, timeout, thinkingBudget: opts.thinkingBudget
      }
      return which === 'claude' ? await askClaude(args) : await askDeepSeek(args)
    } catch (e) {
      lastWhy = String(e.message || e).slice(0, 240)
      emptyLast = !!e.empty
      const more = e.retryable !== false && attempt < tries
      console.error(`  [${tag}] 第 ${attempt}/${tries} 次失败：${lastWhy}${more ? '，等一下再试' : ''}`)
      if (!more) break
      await new Promise(r => setTimeout(r, 6000 * 2 ** (attempt - 1)))
    }
  }
  ask.lastError = lastWhy
  return null
}
