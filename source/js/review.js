/* 复习卡：/review/ 页面上的间隔复习。
 *
 * 每天从课内和课外 AI Infra 的知识点里挑 5 个：最多 2 个新的，其余是 FSRS 估计最可能已经忘了的；
 * 如果到期的不够，就多给几个新的补满。DSA、Linux、Git 每天尽量各出至少一个。
 * 挑好的几个记在进度里（daily.picks），所以同一天刷新页面、开第二个标签页，看到的都是同一组。
 *
 * 题目由娜娜莉按卡片现场换个问法（window.NANALY.complete，用保险箱里的模型密钥）。
 * 选择题和判断题由页面判对错，问答题看过参考答案后自己打分。如果没解锁、断网或者出题失败，
 * 就直接用卡片原来的问题，翻面以后自己打分。出好的题当天缓存在 localStorage，不进导出文件。
 *
 * 卡片数据由 {% review_cards %} 嵌在页面里（scripts/noimpty-review.js），排程用 ts-fsrs
 * （review-fsrs.js，打开这一页才加载）。进度只存在这台浏览器的 localStorage 里，
 * 换电脑或清浏览器数据之前，用「导出进度」存一份。 */
(() => {
  'use strict'
  if (window.NOIMPTY_REVIEW) return

  const STORE = 'noimpty-review-v1'
  const QUESTIONS = 'noimpty-review-questions-v1'
  const PER_DAY = 5
  const NEW_PER_DAY = 2
  const GRADES = [[1, '重来'], [2, '困难'], [3, '良好'], [4, '简单']]
  const KINDS = { choice: '选择题', judge: '判断题', short: '问答题' }

  let fsrsLoading = null
  const loadFsrs = () => fsrsLoading ||= new Promise((resolve, reject) => {
    if (window.NOIMPTY_FSRS) return resolve(window.NOIMPTY_FSRS)
    const script = document.createElement('script')
    script.src = document.getElementById('review-fsrs-src')?.getAttribute('src') || '/js/review-fsrs.js'
    script.onload = () => window.NOIMPTY_FSRS ? resolve(window.NOIMPTY_FSRS) : reject(new Error('missing scheduler'))
    script.onerror = () => { fsrsLoading = null; script.remove(); reject(new Error('load failed')) }
    document.head.append(script)
  })

  const today = () => new Date().toLocaleDateString('sv-SE')
  const endOfToday = () => { const at = new Date(); at.setHours(23, 59, 59, 999); return at }

  // 下次复习还有多久：一律写成「N 分钟 / N 小时 / N 天 / N 个月 / N 年」。
  const span = ms => {
    const minutes = Math.max(1, Math.round(ms / 60000))
    if (minutes < 60) return `${minutes} 分钟`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} 小时`
    const days = Math.round(hours / 24)
    if (days < 31) return `${days} 天`
    if (days < 365) return `${Math.round(days / 30)} 个月`
    return `${(days / 365).toFixed(1).replace(/\.0$/, '')} 年`
  }

  // 每个知识点一天只问一次，所以 FSRS 排在今天之内的（答错后的 1 分钟、10 分钟）也要等到明天。
  const when = due => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const days = Math.max(1, Math.round((new Date(due).setHours(0, 0, 0, 0) - start) / 86400000))
    return days === 1 ? '明天' : days < 31 ? `${days} 天后` : `${span(new Date(due) - Date.now())}后`
  }

  // 题型、判断题的对错、选项的顺序都由「知识点 + 第几次复习」决定。同一次复习刷新页面不会变，
  // 复习过一次以后就换一种。
  const hash = text => { let h = 2166136261; for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return h >>> 0 }
  const plan = (id, reps) => {
    const seed = hash(id + ':' + reps)
    return { seed, type: ['choice', 'choice', 'judge', 'judge', 'short'][seed % 5], truth: (seed >>> 8) % 2 === 0 }
  }
  const shuffled = (list, seed) => {
    let s = seed
    const rand = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
    const out = [...list]
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
    return out
  }

  // 卡片在页面里是转义好的 HTML（只有 code、strong、br 三种标签），交给模型之前换回原来的写法。
  const plain = html => String(html).replace(/<br>/g, '\n').replace(/<\/?code>/g, '`').replace(/<\/?strong>/g, '**')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  // 模型写回来的文字照构建脚本的规矩转成 HTML：先整体转义，再认 `代码`、**加粗** 和换行。
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const inline = text => escape(String(text).trim())
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')

  const PROMPT = [
    '你在给一个正在自学计算机的人出复习题。用户消息是一张复习卡的 JSON：series 是科目，article 是出处文章，front 是卡片原来的问题，back 是标准答案，type 是这次要出的题型。',
    '请围绕这张卡考的同一个知识点重新出一道题，要求如下。',
    '1. 只能考 back 里写到的事实，不要引入卡片以外的结论。拿不准的说法一律不写。',
    '2. 换一种问法，不要照抄 front。可以换成一个具体场景，可以给一小段代码或命令让人判断结果，也可以反过来问。',
    '3. 题目必须只有一个确定的答案。如果答案取决于某个前提（比如光标在哪、当前在哪个分支、变量的值是多少），就在题干里把前提写清楚。',
    '4. 用简体中文。代码、命令、文件名和路径用反引号包起来，不要用别的 Markdown。',
    '5. 不要出需要自己推算精确数值的题，比如循环恰好执行几次、递归恰好有几层。只有 back 里原样写着的数才能拿来考；back 里说「约」「大约」或者只给了复杂度的，题目也只能问大约或者问复杂度。',
    '6. 只返回一个 JSON 对象，不要代码围栏，也不要 JSON 以外的文字。',
    'type 是 choice 时出单选题，返回 {"question": "题干", "options": ["正确选项", "干扰项", "干扰项", "干扰项"], "explain": "解析"}。options 的第一项必须是唯一正确的那个，页面会自己打乱顺序。干扰项要像是真会犯的错，不能一眼就排除，也不要写「以上都对」「以上都不对」。',
    'type 是 judge 时出判断题，返回 {"statement": "一句陈述", "answer": true 或 false, "explain": "解析"}。用户消息里的 want 写着这次要哪一种：「对的说法」就照卡片写一句完全正确的话；「错的说法」就把卡片里的事实改错一处，而且只改一处。写完以后按这句话实际的对错填 answer，页面以 answer 为准。',
    'type 是 short 时出简答题，返回 {"question": "问题", "answer": "参考答案，一到三句话", "explain": "补充说明，可以为空字符串"}。',
    'explain 用一两句话讲清楚为什么。判断题的陈述是错的时候，explain 要说明错在哪里，正确的说法是什么。',
    '选项的顺序会被打乱，所以 explain 里不要用 A、B、C、D 或「第几个选项」指代选项，要直接说选项的内容。'
  ].join('\n')

  // 模型的回答只认这三种结构，字段缺了、太长了、选项重复了都算没出成。
  const parseQuestion = (text, { type, seed }) => {
    let value
    try {
      const raw = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
      value = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    } catch (_) { throw new Error('模型给的题格式不对') }
    const bad = () => { throw new Error('模型给的题不完整') }
    const field = (key, max, optional = false) => {
      const text = value?.[key]
      if (optional && (text == null || text === '')) return ''
      if (typeof text !== 'string' || !text.trim() || text.length > max) bad()
      return text.trim()
    }
    const explain = field('explain', 800, true)
    if (type === 'choice') {
      const options = value.options
      if (!Array.isArray(options) || options.length !== 4 || options.some(option => typeof option !== 'string' || !option.trim() || option.length > 300) ||
        new Set(options.map(option => option.trim())).size !== 4) bad()
      const order = shuffled([0, 1, 2, 3], seed)
      return { type, question: field('question', 800), options: order.map(i => options[i].trim()), answer: order.indexOf(0), explain }
    }
    // 判断题的对错以模型自己填的 answer 为准：实测让它出「对的说法」时，它有时会写成错的，但 answer 和解析是跟着陈述走的。
    if (type === 'judge') {
      if (typeof value.answer !== 'boolean') bad()
      return { type, statement: field('statement', 800), answer: value.answer, explain }
    }
    return { type, question: field('question', 800), answer: field('answer', 1200), explain }
  }

  // 今天出好的题：键是「知识点:第几次复习」，值是模型的原始回答，换回原题的记成 'card'。
  const readQuestions = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(QUESTIONS) || 'null')
      if (value && value.date === today() && value.items && typeof value.items === 'object' && !Array.isArray(value.items)) return value
    } catch (_) {}
    return { date: today(), items: {} }
  }
  const keepQuestion = (key, text) => {
    const value = readQuestions()
    value.items[key] = text
    try { window.localStorage.setItem(QUESTIONS, JSON.stringify(value)) } catch (_) {}
  }

  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = String(text); return el }
  const button = (text, className, click) => { const el = node('button', className, text); el.type = 'button'; el.addEventListener('click', click); return el }

  let lifetime = null, mountedRoot = null
  const mount = async () => {
    const root = document.getElementById('review-app')
    const source = document.getElementById('review-cards')
    // A failed/cancelled PJAX request leaves this DOM alive. Dispose only after
    // a completed navigation actually replaces it, so that page stays usable.
    if (mountedRoot && mountedRoot !== root) {
      lifetime?.abort(); lifetime = null; mountedRoot = null
    }
    if (!root || !source || root.dataset.mounted) return
    mountedRoot = root
    root.dataset.mounted = 'yes'
    lifetime?.abort(); lifetime = new AbortController()
    const { signal } = lifetime

    let data
    try { data = JSON.parse(source.textContent) } catch (_) { root.textContent = '复习卡的数据读不出来，请重新构建网站。'; return }
    let F
    try { F = await loadFsrs() } catch (_) { root.textContent = '复习算法没有加载成功，刷新页面再试一次。'; return }
    if (signal.aborted) return

    const scheduler = F.fsrs(F.generatorParameters({ enable_fuzz: true }))
    const seriesIds = data.series.map(item => item.id)
    const byId = new Map(data.cards.map(card => [card.id, card]))
    const freshDay = () => ({ date: today(), fresh: 0, extra: 0, picks: [], done: {} })
    const empty = () => ({ v: 1, cards: {}, series: [...seriesIds], daily: freshDay() })
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    const count = value => Number.isSafeInteger(value) && value >= 0
    const date = value => (typeof value === 'string' || typeof value === 'number' || value instanceof Date) && Number.isFinite(new Date(value).getTime())
    // Both storage and imports use the v1 format. Build a fresh object, and
    // validate every queue/FSRS field before replacing any live state.
    // daily.picks / daily.done came later; files exported before them still import.
    const validCard = value => {
      if (!record(value) || !date(value.due) || ![0, 1, 2, 3].includes(value.state) ||
        !['elapsed_days', 'scheduled_days', 'reps', 'lapses', 'learning_steps'].every(key => count(value[key])) ||
        !Number.isFinite(value.stability) || value.stability < 0 || !Number.isFinite(value.difficulty) || value.difficulty < 0 || value.difficulty > 10 ||
        value.lapses > value.reps || (value.last_review != null && !date(value.last_review)) ||
        (value.state !== 0 && (!value.reps || !value.stability || value.difficulty < 1 || value.last_review == null))) throw new Error('bad card')
      const card = {
        due: new Date(value.due).toISOString(), stability: value.stability, difficulty: value.difficulty,
        elapsed_days: value.elapsed_days, scheduled_days: value.scheduled_days, reps: value.reps,
        lapses: value.lapses, learning_steps: value.learning_steps, state: value.state
      }
      if (value.last_review != null) card.last_review = new Date(value.last_review).toISOString()
      return card
    }
    const validate = value => {
      if (!record(value) || value.v !== 1 || !record(value.cards) || !Array.isArray(value.series) || !value.series.length ||
        !value.series.every(id => typeof id === 'string' && id.length) || !record(value.daily) ||
        typeof value.daily.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.daily.date) || !date(value.daily.date) ||
        new Date(value.daily.date).toISOString().slice(0, 10) !== value.daily.date ||
        !count(value.daily.fresh) || !count(value.daily.extra)) throw new Error('bad progress')
      const picks = value.daily.picks ?? [], done = value.daily.done ?? {}
      if (!Array.isArray(picks) || picks.length > 1000 || !picks.every(id => typeof id === 'string') ||
        !record(done) || !Object.values(done).every(rating => [1, 2, 3, 4].includes(rating))) throw new Error('bad progress')
      const series = [...new Set(value.series)].filter(id => seriesIds.includes(id))
      return {
        v: 1, cards: Object.fromEntries(Object.entries(value.cards).map(([id, card]) => [id, validCard(card)])),
        series: series.length ? series : [...seriesIds],
        daily: {
          date: value.daily.date, fresh: value.daily.fresh, extra: value.daily.extra,
          picks: [...new Set(picks)].filter(id => byId.has(id)),
          done: Object.fromEntries(Object.entries(done).filter(([id]) => byId.has(id)))
        }
      }
    }
    const read = () => {
      const value = JSON.parse(window.localStorage.getItem(STORE) || 'null')
      return value == null ? empty() : validate(value)
    }
    const locks = window.navigator?.locks
    let state = empty(), sessionOnly = !locks?.request, busy = false
    let storageProblem = sessionOnly ? '浏览器不支持安全地同步多个复习页面，本次进度只暂存在当前页面。离开前请导出进度。' : ''
    try { state = read() } catch (_) {
      sessionOnly = true
      storageProblem = '已保存的复习进度无法读取，原记录没有被改动。本次进度只暂存在当前页面，离开前请导出进度。'
    }
    const daily = (value = state) => {
      if (value.daily.date !== today()) value.daily = freshDay()
      return value.daily
    }
    const progress = id => Object.hasOwn(state.cards, id) ? F.TypeConvert.card(state.cards[id]) : null
    const version = card => card ? [card.reps, card.last_review || '', card.due].join(':') : ''

    // ---- 挑今天的知识点 ----
    const choose = (draft, size) => {
      const day = daily(draft), at = endOfToday(), taken = new Set(day.picks)
      const learned = card => Object.hasOwn(draft.cards, card.id)
      const open = data.cards.filter(card => !taken.has(card.id))
      const dueAt = card => new Date(draft.cards[card.id].due).getTime()
      // 按「到今天结束时还记得的概率」从低到高排，最可能忘的排在前面。
      const rank = list => list.map(card => ({ card, recall: scheduler.get_retrievability(F.TypeConvert.card(draft.cards[card.id]), at, false), due: dueAt(card) }))
        .sort((a, b) => a.recall - b.recall || a.due - b.due).map(item => item.card)
      const due = rank(open.filter(card => learned(card) && dueAt(card) <= at.getTime()))
      const later = rank(open.filter(card => learned(card) && dueAt(card) > at.getTime()))
      const fresh = open.filter(card => !learned(card))
      const picks = [], covered = new Set()
      const take = card => { picks.push(card); covered.add(card.series) }
      // 先给每个还没出现的系列拿一个，再按顺序补到 limit 个。
      const fill = (list, limit) => {
        for (const card of list) if (picks.length < limit && !covered.has(card.series) && !picks.includes(card)) take(card)
        for (const card of list) if (picks.length < limit && !picks.includes(card)) take(card)
      }
      fill(due, size - Math.min(NEW_PER_DAY, fresh.length))
      // 新知识点：这一组里还没出现的系列优先，其次是学过的比例最小的系列；同一个系列按文章顺序。
      const total = id => data.cards.filter(card => card.series === id).length
      const known = id => data.cards.filter(card => card.series === id && (learned(card) || taken.has(card.id) || picks.includes(card))).length
      while (picks.length < size) {
        const left = fresh.filter(card => !picks.includes(card))
        if (!left.length) break
        const order = seriesIds.filter(id => left.some(card => card.series === id))
          .sort((a, b) => covered.has(a) - covered.has(b) || known(a) / total(a) - known(b) / total(b))
        take(left.find(card => card.series === order[0]))
      }
      // 新的都学过了、到期的又不够，就提前复习还没到期的里面最可能忘的。
      fill(later, size)
      return picks.map(card => card.id)
    }
    const ensure = draft => {
      const day = daily(draft)
      if (!day.picks.length) day.picks = choose(draft, PER_DAY)
      return draft
    }
    const todayCards = () => daily().picks.map(id => byId.get(id)).filter(Boolean)
    const waiting = () => todayCards().filter(card => !Object.hasOwn(daily().done, card.id))

    // ---- 娜娜莉出题 ----
    const aiReady = () => { try { return typeof window.NANALY?.complete === 'function' && window.NANALY.canComplete?.() === true } catch (_) { return false } }
    const canUnlock = () => typeof window.NANALY?.requestUnlock === 'function'
    const asking = new Map(), failed = new Map()
    const keyOf = card => card.id + ':' + (state.cards[card.id]?.reps || 0)
    const ask = card => {
      const reps = state.cards[card.id]?.reps || 0, key = keyOf(card)
      if (asking.has(key) || failed.has(key) || readQuestions().items[key] != null) return
      const shape = plan(card.id, reps), { type, truth } = shape
      const series = data.series.find(item => item.id === card.series)?.name || ''
      const user = JSON.stringify({ series, article: card.post.title, front: plain(card.front), back: plain(card.back), type, ...(type === 'judge' ? { want: truth ? '对的说法' : '错的说法' } : {}) })
      const job = Promise.resolve().then(() => window.NANALY.complete({ system: PROMPT, user, json: true, signal }))
        .then(text => { parseQuestion(text, shape); keepQuestion(key, text) })
        .catch(error => {
          if (signal.aborted) return
          const reason = error?.name === 'TimeoutError' ? '等了一分钟没有回应' : String(error?.message || '模型没有回应').slice(0, 80)
          failed.set(key, `这次没出成新题（${reason}），先用卡片原来的问题。`)
        })
        .finally(() => {
          asking.delete(key)
          if (signal.aborted || current !== card || view?.key !== key || view.phase !== 'loading') return
          view = start(card); render()
        })
      asking.set(key, job)
    }
    const prefetch = () => { if (aiReady()) for (const card of waiting()) ask(card) }
    // 这一题怎么出：缓存里有就直接用；没有的话，能叫娜娜莉就叫她出，叫不了就用原题。
    const start = card => {
      const key = keyOf(card), shape = plan(card.id, state.cards[card.id]?.reps || 0)
      const cached = readQuestions().items[key]
      if (cached === 'card') return { key, source: 'card', phase: 'ask', note: '' }
      if (typeof cached === 'string') {
        try { return { key, source: 'ai', phase: 'ask', question: parseQuestion(cached, shape), note: '' } } catch (_) {}
      }
      if (failed.has(key)) return { key, source: 'card', phase: 'ask', note: failed.get(key) }
      if (aiReady()) { ask(card); return { key, source: 'ai', phase: 'loading', note: '' } }
      return { key, source: 'card', phase: 'ask', note: canUnlock() ? 'locked' : '' }
    }

    // ---- 界面 ----
    root.replaceChildren()
    const stats = node('p', 'review-stats')
    const card = node('section', 'review-card'); card.setAttribute('aria-live', 'polite')
    const meta = node('p', 'review-card__meta')
    const front = node('div', 'review-card__front')
    const hint = node('p', 'review-card__hint')
    const options = node('div', 'review-options'); options.setAttribute('role', 'group'); options.setAttribute('aria-label', '选项')
    const back = node('div', 'review-card__back')
    const verdict = node('p', 'review-card__verdict')
    const answer = node('div', 'review-card__answer')
    const explain = node('div', 'review-card__explain')
    const origin = node('div', 'review-card__origin')
    const from = node('a', 'review-card__source')
    back.append(verdict, answer, explain, origin, from)
    card.append(meta, front, hint, options, back)
    const actions = node('div', 'review-actions')
    const helper = node('div', 'review-ai')
    const tools = node('div', 'review-tools')
    const warning = node('p', 'review-warn'); warning.setAttribute('role', 'status')
    const note = node('p', 'review-note', '进度只保存在这台浏览器里。换电脑或清理浏览器数据之前，先导出一份。')
    const file = node('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true
    root.append(stats, card, actions, helper, warning, tools, note, file)

    tools.append(
      button('导出进度', 'review-tool', () => {
        const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })
        const link = node('a'); link.href = URL.createObjectURL(blob); link.download = `noimpty-review-${today()}.json`
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000)
      }),
      button('导入进度', 'review-tool', () => file.click())
    )
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0]; file.value = ''
      if (!chosen) return
      try {
        const value = validate(JSON.parse(await chosen.text()))
        if (signal.aborted || busy) return
        // Reject unusable FSRS parameters before either storage or the UI changes.
        for (const card of Object.values(value.cards)) {
          const preview = scheduler.repeat(F.TypeConvert.card(card), new Date())
          for (const [rating] of GRADES) validCard(preview[rating].card)
        }
        if (!window.confirm(`导入后会用这份文件替换当前的复习进度（${Object.keys(value.cards).length} 张卡有记录），确定吗？`)) return
        await update(() => value, true)
      } catch (_) { if (!signal.aborted) window.alert('这个文件不是导出的复习进度。') }
    })

    // A storage event alone cannot protect read/modify/write or the daily count.
    // Writers take the same origin-wide lock and reread inside it. Older browsers
    // keep an exportable session copy instead of risking lost updates.
    const update = async (change, replace = false) => {
      if (busy || signal.aborted) return
      busy = true
      for (const el of root.querySelectorAll('button')) el.disabled = true
      let attempted = false
      const commit = canWrite => {
        attempted = true
        if (signal.aborted) return
        let draft = validate(state)
        if (!sessionOnly && !replace) {
          try { draft = read() } catch (_) {
            sessionOnly = true
            storageProblem = '已保存的复习进度无法读取，原记录没有被改动。本次进度只暂存在当前页面，离开前请导出进度。'
          }
        }
        const value = validate(ensure(change(draft)))
        if (canWrite && (!sessionOnly || replace)) {
          try {
            window.localStorage.setItem(STORE, JSON.stringify(value))
            sessionOnly = false; storageProblem = ''
          } catch (_) {
            sessionOnly = true
            storageProblem = '浏览器没有让这一页保存进度。本次进度只暂存在当前页面，离开前请导出进度。'
          }
        }
        state = value
      }
      try {
        if (locks?.request) await locks.request(STORE, { mode: 'exclusive', signal }, () => commit(true))
        else commit(false)
      } catch (_) {
        if (!signal.aborted) {
          if (!attempted) {
            sessionOnly = true
            storageProblem = '无法安全地保存复习进度。本次进度只暂存在当前页面，离开前请导出进度。'
            commit(false)
          } else {
            storageProblem = '这次操作没有完成，原进度没有被改动。请导出备份后刷新页面重试。'
          }
        }
      } finally {
        busy = false
        for (const el of root.querySelectorAll('button')) el.disabled = false
        if (!signal.aborted) next()
      }
    }

    let current = null, view = null, preparedFor = ''
    const question = () => view?.source === 'ai' ? view.question : null
    // 原题和问答题：先翻面，再自己打分。
    const show = () => {
      if (!current || view?.phase !== 'ask' || busy || (question() && question().type !== 'short')) return
      view = { ...view, phase: 'answered' }; render()
      actions.querySelector('.review-grade')?.focus({ preventScroll: true })
    }
    // 选择题和判断题：点了就判，结果要等点「下一题」才记进进度，中间还能说「这题有问题」。
    const pick = choice => {
      const q = question()
      if (!current || view?.phase !== 'ask' || busy || !q || q.type === 'short') return
      view = { ...view, phase: 'answered', chosen: choice, correct: choice === q.answer }; render()
      actions.querySelector('.review-next')?.focus({ preventScroll: true })
    }
    const flag = () => {
      if (!current || view?.source !== 'ai' || busy) return
      keepQuestion(view.key, 'card')
      view = { key: view.key, source: 'card', phase: 'ask', note: '已经换回卡片原来的问题，这一题按原题来。' }; render()
    }
    const grade = rating => {
      if (!current || view?.phase !== 'answered' || busy) return
      const id = current.id, expected = version(state.cards[id])
      return update(draft => {
        const day = daily(draft)
        // A second tab may already have answered the card still visible here.
        // Do not schedule or count that stale answer a second time.
        if (!day.picks.includes(id) || Object.hasOwn(day.done, id) || version(draft.cards[id]) !== expected) return draft
        const isNew = !Object.hasOwn(draft.cards, id)
        const before = isNew ? F.createEmptyCard(new Date()) : F.TypeConvert.card(draft.cards[id])
        draft.cards[id] = validCard(scheduler.next(before, new Date(), rating).card)
        if (isNew) day.fresh++
        day.done[id] = rating
        return draft
      })
    }
    const next = () => {
      const day = daily()
      if (!day.picks.length && preparedFor !== day.date && !busy) {
        preparedFor = day.date
        current = null; view = null; render()
        void update(draft => draft)
        return
      }
      current = waiting()[0] || null
      view = current ? start(current) : null
      render()
      prefetch()
    }
    const later = rating => when(scheduler.repeat(progress(current.id) || F.createEmptyCard(new Date()), new Date())[rating].card.due)
    const render = () => {
      warning.textContent = storageProblem; warning.hidden = !storageProblem
      const day = daily(), cards = todayCards()
      const seen = data.cards.filter(item => Object.hasOwn(state.cards, item.id)).length
      const doneCount = cards.filter(item => Object.hasOwn(day.done, item.id)).length
      stats.textContent = (current ? `今天第 ${doneCount + 1} 个，共 ${cards.length} 个 · ` : '') + `见过 ${seen} / ${data.cards.length} 个知识点`
      actions.replaceChildren(); helper.replaceChildren(); helper.hidden = true
      options.replaceChildren(); options.hidden = true
      hint.textContent = ''; hint.hidden = true
      back.hidden = true
      if (!current) {
        card.classList.add('is-done'); meta.textContent = ''
        if (!cards.length) { front.replaceChildren(node('p', '', data.cards.length ? '正在挑今天的知识点…' : '还没有可以复习的卡片。')); return }
        const forgot = cards.filter(item => day.done[item.id] === 1).length
        front.replaceChildren(...[
          `今天挑的 ${cards.length} 个知识点都复习完了。`,
          forgot ? `其中 ${forgot} 个没记住，接下来几天会优先再问。` : '这几个都记得。',
          '明天会再挑 5 个。'
        ].map(line => node('p', '', line)))
        if (data.cards.length > day.picks.length) {
          actions.append(button('再来一组', 'review-more', () => update(draft => {
            const value = daily(draft)
            value.extra++
            value.picks.push(...choose(draft, PER_DAY))
            return draft
          })))
        }
        return
      }
      card.classList.remove('is-done')
      const q = question(), series = data.series.find(item => item.id === current.series)?.name || ''
      const isNew = !Object.hasOwn(state.cards, current.id)
      meta.textContent = [series, view.phase === 'loading' ? '出题中' : q ? KINDS[q.type] : '原题', isNew ? '第一次见' : ''].filter(Boolean).join(' · ')
      from.textContent = `出自《${current.post.title}》`; from.href = current.post.url

      if (view.phase === 'loading') {
        front.replaceChildren(node('p', 'review-card__wait', '娜娜莉正在出题…'))
        actions.append(button('不等了，用原题', 'review-skip', () => {
          if (view?.phase === 'loading') { view = { ...view, source: 'card', phase: 'ask' }; render() }
        }))
        return
      }

      if (!q) {
        front.innerHTML = current.front
        if (current.hint) { hint.innerHTML = current.hint; hint.hidden = false }
      } else {
        front.innerHTML = inline(q.type === 'judge' ? q.statement : q.question)
        if (q.type !== 'short') {
          const choices = q.type === 'choice' ? q.options.map((text, i) => [i, 'ABCD'[i], text]) : [[true, '✓', '对'], [false, '✗', '错']]
          options.dataset.kind = q.type
          if (q.type === 'judge') { hint.textContent = '这句话对吗？'; hint.hidden = false }
          for (const [value, label, text] of choices) {
            const choice = button('', 'review-option', () => pick(value))
            const mark = node('span', 'review-option__key', label)
            const body = node('span', 'review-option__text'); body.innerHTML = inline(text)
            choice.append(mark, body)
            choice.setAttribute('aria-label', q.type === 'choice' ? `${label}. ${body.textContent}` : text)
            if (view.phase === 'answered') {
              choice.disabled = true
              if (value === q.answer) choice.dataset.state = 'right'
              else if (value === view.chosen) choice.dataset.state = 'wrong'
            }
            options.append(choice)
          }
          options.hidden = false
        }
      }

      if (view.note === 'locked') {
        helper.append(node('span', '', '解锁娜娜莉以后，每天的题会换个问法。'), button('解锁', 'review-unlock', () => window.NANALY?.requestUnlock?.()))
        helper.hidden = false
      } else if (view.note) {
        helper.append(node('span', '', view.note)); helper.hidden = false
      }

      if (view.phase === 'ask') {
        if (!q || q.type === 'short') {
          const reveal = button('显示答案', 'review-show', show)
          reveal.append(node('kbd', '', '空格'))
          actions.append(reveal)
        }
        return
      }

      back.hidden = false
      verdict.textContent = ''; verdict.hidden = true
      explain.textContent = ''; explain.hidden = true
      origin.replaceChildren(); origin.hidden = true
      if (!q) {
        answer.innerHTML = current.back
      } else {
        if (q.type === 'short') answer.innerHTML = inline(q.answer)
        else {
          answer.textContent = ''
          verdict.textContent = view.correct ? '答对了。'
            : q.type === 'choice' ? `答错了，正确答案是 ${'ABCD'[q.answer]}。` : `答错了，这句话是${q.answer ? '对' : '错'}的。`
          verdict.dataset.state = view.correct ? 'right' : 'wrong'
          verdict.hidden = false
        }
        if (q.explain) { explain.innerHTML = inline(q.explain); explain.hidden = false }
        const cardFront = node('p'), cardBack = node('p')
        cardFront.innerHTML = current.front; cardBack.innerHTML = current.back
        origin.append(node('p', 'review-card__label', '卡片原文'), cardFront, cardBack)
        origin.hidden = false
        helper.replaceChildren(button('这题有问题，换回原题', 'review-flag', flag)); helper.hidden = false
      }

      if (!q || q.type === 'short') {
        for (const [rating, label] of GRADES) {
          const choice = button('', 'review-grade', () => grade(rating))
          choice.dataset.rating = String(rating)
          choice.append(node('span', '', label), node('small', '', later(rating)))
          choice.setAttribute('aria-label', `${label}，${later(rating)}再复习`)
          choice.title = `快捷键 ${rating}`
          actions.append(choice)
        }
        return
      }
      const rating = view.correct ? 3 : 1
      const go = button('', 'review-next', () => grade(rating))
      go.dataset.rating = String(rating)
      go.append(node('span', '', '下一题'), node('small', '', `${later(rating)}再问`))
      actions.append(go)
      if (view.correct) {
        const guess = button('', 'review-grade', () => grade(2))
        guess.dataset.rating = '2'
        guess.append(node('span', '', '蒙对的'), node('small', '', `${later(2)}再问`))
        actions.append(guess)
      }
    }

    window.addEventListener('storage', event => {
      if (event.key !== STORE || sessionOnly || busy || signal.aborted) return
      try { state = read(); next() } catch (_) {
        sessionOnly = true
        storageProblem = '其他页面保存的复习进度无法读取，当前进度保留在本页。离开前请导出进度。'
        render()
      }
    }, { signal })
    // 在这一页解锁了娜娜莉：还停在「原题 + 解锁提示」的那一题直接换成新题，后面几题也开始出。
    window.addEventListener('nanaly:unlocked', () => {
      if (signal.aborted || !current) return
      if (view?.note === 'locked' && view.phase === 'ask') view = start(current)
      render(); prefetch()
    }, { signal })
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (!current || !view || busy) return
      const q = question(), enter = event.key === ' ' || event.key === 'Enter', onButton = event.target.closest?.('button, a')
      if (view.phase === 'ask') {
        if ((!q || q.type === 'short') && enter && !onButton) { event.preventDefault(); show() }
        else if (q?.type === 'choice' && /^[1-4]$/.test(event.key)) { event.preventDefault(); pick(Number(event.key) - 1) }
        else if (q?.type === 'judge' && /^[12]$/.test(event.key)) { event.preventDefault(); pick(event.key === '1') }
      } else if (view.phase === 'answered') {
        if (!q || q.type === 'short') { if (/^[1-4]$/.test(event.key)) { event.preventDefault(); grade(Number(event.key)) } }
        else if (enter && !onButton) { event.preventDefault(); grade(view.correct ? 3 : 1) }
      }
    }, { signal })
    next()
  }

  document.addEventListener('pjax:complete', () => { void mount() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void mount() }, { once: true })
  else void mount()

  window.NOIMPTY_REVIEW = Object.freeze({ mount })
})()
