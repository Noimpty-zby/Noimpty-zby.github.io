/* 复习卡：/review/ 页面上的间隔复习。
 * 卡片数据由 {% review_cards %} 嵌在页面里（scripts/noimpty-review.js），排程用 ts-fsrs
 * （review-fsrs.js，打开这一页才加载）。进度只存在这台浏览器的 localStorage 里，
 * 换电脑或清浏览器数据之前，用「导出进度」存一份。 */
(() => {
  'use strict'
  if (window.NOIMPTY_REVIEW) return

  const STORE = 'noimpty-review-v1'
  const NEW_PER_DAY = 20
  const SOON = 30 * 60 * 1000
  const GRADES = [[1, '重来'], [2, '困难'], [3, '良好'], [4, '简单']]

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
    const empty = () => ({ v: 1, cards: {}, series: [...seriesIds], daily: { date: today(), fresh: 0, extra: 0 } })
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    const count = value => Number.isSafeInteger(value) && value >= 0
    const date = value => (typeof value === 'string' || typeof value === 'number' || value instanceof Date) && Number.isFinite(new Date(value).getTime())
    // Both storage and imports use the original v1 format. Build a fresh object,
    // and validate every queue/FSRS field before replacing any live state.
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
        !count(value.daily.fresh) || !count(value.daily.extra) || !Number.isSafeInteger(NEW_PER_DAY + value.daily.extra)) throw new Error('bad progress')
      const series = [...new Set(value.series)].filter(id => seriesIds.includes(id))
      return {
        v: 1, cards: Object.fromEntries(Object.entries(value.cards).map(([id, card]) => [id, validCard(card)])),
        series: series.length ? series : [...seriesIds],
        daily: { date: value.daily.date, fresh: value.daily.fresh, extra: value.daily.extra }
      }
    }
    const read = () => {
      const value = JSON.parse(window.localStorage.getItem(STORE) || 'null')
      return value == null ? empty() : validate(value)
    }
    const locks = window.navigator?.locks
    let state = empty(), sessionOnly = !locks?.request, pending = false
    let storageProblem = sessionOnly ? '浏览器不支持安全地同步多个复习页面，本次进度只暂存在当前页面。离开前请导出进度。' : ''
    try { state = read() } catch (_) {
      sessionOnly = true
      storageProblem = '已保存的复习进度无法读取，原记录没有被改动。本次进度只暂存在当前页面，离开前请导出进度。'
    }
    const daily = (value = state) => {
      if (value.daily.date !== today()) value.daily = { date: today(), fresh: 0, extra: 0 }
      return value.daily
    }
    const progress = id => Object.hasOwn(state.cards, id) ? F.TypeConvert.card(state.cards[id]) : null
    const version = card => card ? [card.reps, card.last_review || '', card.due].join(':') : ''

    let current = null, revealed = false, timer = null
    const queue = () => {
      const now = Date.now()
      const active = data.cards.filter(card => state.series.includes(card.series))
      const due = active.filter(card => state.cards[card.id] && new Date(state.cards[card.id].due).getTime() <= now)
        .sort((a, b) => new Date(state.cards[a.id].due) - new Date(state.cards[b.id].due))
      // 新卡轮流从各个系列里取：今天学过几张新卡，就从第几个系列接着出，
      // 一次复习里能混着看到几个系列，而不是先把一个系列刷完。
      const groups = seriesIds.filter(id => state.series.includes(id)).map(id => active.filter(card => card.series === id && !state.cards[card.id])).filter(group => group.length)
      const fresh = groups.flat()
      const { fresh: learned, extra } = daily()
      const freshLeft = Math.max(0, NEW_PER_DAY + extra - learned)
      const soon = active.filter(card => state.cards[card.id] && new Date(state.cards[card.id].due).getTime() > now)
        .map(card => new Date(state.cards[card.id].due).getTime()).sort((a, b) => a - b)
      const nextFresh = groups.length ? groups[learned % groups.length][0] : null
      return { due, fresh, nextFresh, freshLeft, next: soon[0] || null, total: active.length }
    }

    // ---- 界面 ----
    root.replaceChildren()
    const stats = node('p', 'review-stats')
    const chips = node('div', 'review-series'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', '复习哪些系列')
    const card = node('section', 'review-card'); card.setAttribute('aria-live', 'polite')
    const meta = node('p', 'review-card__meta')
    const front = node('div', 'review-card__front')
    const hint = node('p', 'review-card__hint')
    const back = node('div', 'review-card__back')
    const answer = node('div', 'review-card__answer')
    const from = node('a', 'review-card__source')
    back.append(answer, from)
    card.append(meta, front, hint, back)
    const actions = node('div', 'review-actions')
    const tools = node('div', 'review-tools')
    const warning = node('p', 'review-warn'); warning.setAttribute('role', 'status')
    const note = node('p', 'review-note', '进度只保存在这台浏览器里。换电脑或清理浏览器数据之前，先导出一份。')
    const file = node('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true
    root.append(stats, chips, card, actions, warning, tools, note, file)

    for (const item of data.series) {
      const chip = button(`${item.name} · ${item.count}`, 'review-chip', () => {
        return update(draft => {
          const on = draft.series.includes(item.id)
          if (!on || draft.series.length > 1) draft.series = on ? draft.series.filter(id => id !== item.id) : [...draft.series, item.id]
          return draft
        })
      })
      chip.dataset.series = item.id
      chips.append(chip)
    }
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
        if (signal.aborted || pending) return
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
      if (pending || signal.aborted) return
      pending = true
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
        const value = validate(change(draft))
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
        pending = false
        for (const el of root.querySelectorAll('button')) el.disabled = false
        if (!signal.aborted) next()
      }
    }
    const show = () => {
      if (!current || revealed || pending) return
      revealed = true; back.hidden = false; render()
      actions.querySelector('.review-grade')?.focus({ preventScroll: true })
    }
    const grade = rating => {
      if (!current || !revealed || pending) return
      const id = current.id, expected = version(state.cards[id])
      return update(draft => {
        // A second tab may already have answered the card still visible here.
        // Do not schedule or count that stale answer a second time.
        if (version(draft.cards[id]) !== expected) return draft
        const day = daily(draft), isNew = !draft.cards[id]
        if (isNew && day.fresh >= NEW_PER_DAY + day.extra) return draft
        const before = isNew ? F.createEmptyCard(new Date()) : F.TypeConvert.card(draft.cards[id])
        draft.cards[id] = validCard(scheduler.next(before, new Date(), rating).card)
        if (isNew) day.fresh++
        return draft
      })
    }
    const next = () => {
      clearTimeout(timer)
      const { due, nextFresh, freshLeft } = queue()
      current = due[0] || (freshLeft > 0 ? nextFresh : null) || null
      revealed = false
      render()
    }
    const render = () => {
      const { due, fresh, freshLeft, next: upcoming, total } = queue()
      warning.textContent = storageProblem; warning.hidden = !storageProblem
      stats.textContent = `今天要复习 ${due.length} 张 · 新卡还能学 ${Math.min(freshLeft, fresh.length)} 张 · 共 ${total} 张`
      for (const chip of chips.children) chip.setAttribute('aria-pressed', String(state.series.includes(chip.dataset.series)))
      actions.replaceChildren()
      if (!current) {
        card.classList.add('is-done'); meta.textContent = ''; hint.textContent = ''; back.hidden = true
        const lines = ['今天的复习做完了。']
        if (upcoming) lines.push(`下一张卡在 ${span(upcoming - Date.now())}后到期。`)
        if (fresh.length && freshLeft === 0) lines.push(`今天的 ${NEW_PER_DAY + daily().extra} 张新卡已经学完，剩下 ${fresh.length} 张新卡明天继续。`)
        front.replaceChildren(...lines.map(line => node('p', '', line)))
        if (fresh.length && freshLeft === 0) actions.append(button('再学 10 张新卡', 'review-more', () => update(draft => { daily(draft).extra += 10; return draft })))
        // 刚答错的卡几分钟后就到期，到时自动翻出来。
        if (upcoming && upcoming - Date.now() < SOON) timer = setTimeout(next, Math.max(1000, upcoming - Date.now() + 500))
        return
      }
      card.classList.remove('is-done')
      const series = data.series.find(item => item.id === current.series)?.name || ''
      const isNew = !state.cards[current.id]
      meta.textContent = [series, current.kind, isNew ? '新卡' : ''].filter(Boolean).join(' · ')
      front.innerHTML = current.front
      hint.textContent = ''
      if (current.hint) hint.innerHTML = current.hint
      hint.hidden = !current.hint
      back.hidden = !revealed
      answer.innerHTML = current.back
      from.textContent = `出自《${current.post.title}》`; from.href = current.post.url
      if (!revealed) {
        const reveal = button('显示答案', 'review-show', show)
        reveal.append(node('kbd', '', '空格'))
        actions.append(reveal)
        return
      }
      const preview = scheduler.repeat(progress(current.id) || F.createEmptyCard(new Date()), new Date())
      for (const [rating, label] of GRADES) {
        const choice = button('', 'review-grade', () => grade(rating))
        choice.dataset.rating = String(rating)
        choice.append(node('span', '', label), node('small', '', span(new Date(preview[rating].card.due) - Date.now())))
        choice.setAttribute('aria-label', `${label}，${span(new Date(preview[rating].card.due) - Date.now())}后再复习`)
        choice.title = `快捷键 ${rating}`
        actions.append(choice)
      }
    }

    window.addEventListener('storage', event => {
      if (event.key !== STORE || sessionOnly || pending || signal.aborted) return
      try { state = read(); next() } catch (_) {
        sessionOnly = true
        storageProblem = '其他页面保存的复习进度无法读取，当前进度保留在本页。离开前请导出进度。'
        render()
      }
    }, { signal })
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (!revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest?.('button, a')) { event.preventDefault(); show() }
      else if (revealed && /^[1-4]$/.test(event.key)) { event.preventDefault(); grade(Number(event.key)) }
    }, { signal })
    signal.addEventListener('abort', () => clearTimeout(timer))
    next()
  }

  document.addEventListener('pjax:complete', () => { void mount() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void mount() }, { once: true })
  else void mount()

  window.NOIMPTY_REVIEW = Object.freeze({ mount })
})()
