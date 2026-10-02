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
  const read = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORE) || 'null')
      return value && value.v === 1 && value.cards && typeof value.cards === 'object' ? value : null
    } catch (_) { return null }
  }
  const write = state => { try { window.localStorage.setItem(STORE, JSON.stringify(state)); return true } catch (_) { return false } }

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

  let lifetime = null
  const mount = async () => {
    const root = document.getElementById('review-app')
    const source = document.getElementById('review-cards')
    if (!root || !source || root.dataset.mounted) return
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
    const state = read() || { v: 1, cards: {}, series: seriesIds, daily: { date: today(), fresh: 0, extra: 0 } }
    if (!Array.isArray(state.series)) state.series = seriesIds
    const daily = () => {
      if (state.daily?.date !== today()) state.daily = { date: today(), fresh: 0, extra: 0 }
      return state.daily
    }
    const progress = id => state.cards[id] ? F.TypeConvert.card(state.cards[id]) : null

    let current = null, revealed = false, timer = null, storageProblem = false
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
    const note = node('p', 'review-note', '进度只保存在这台浏览器里。换电脑或清理浏览器数据之前，先导出一份。')
    const file = node('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true
    root.append(stats, chips, card, actions, tools, note, file)

    for (const item of data.series) {
      const chip = button(`${item.name} · ${item.count}`, 'review-chip', () => {
        const on = state.series.includes(item.id)
        if (on && state.series.length === 1) return
        state.series = on ? state.series.filter(id => id !== item.id) : [...state.series, item.id]
        save(); next()
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
        const value = JSON.parse(await chosen.text())
        if (!value || value.v !== 1 || typeof value.cards !== 'object') throw new Error('bad file')
        if (!window.confirm(`导入后会用这份文件替换当前的复习进度（${Object.keys(value.cards).length} 张卡有记录），确定吗？`)) return
        for (const key of Object.keys(state)) delete state[key]
        Object.assign(state, value); save(); next()
      } catch (_) { window.alert('这个文件不是导出的复习进度。') }
    })

    const save = () => { storageProblem = !write(state) }
    const show = () => {
      if (!current || revealed) return
      revealed = true; back.hidden = false; render()
      actions.querySelector('.review-grade')?.focus({ preventScroll: true })
    }
    const grade = rating => {
      if (!current || !revealed) return
      const before = progress(current.id) || F.createEmptyCard(new Date())
      const isNew = !state.cards[current.id]
      state.cards[current.id] = scheduler.next(before, new Date(), rating).card
      if (isNew) daily().fresh++
      save(); next()
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
      stats.textContent = `今天要复习 ${due.length} 张 · 新卡还能学 ${Math.min(freshLeft, fresh.length)} 张 · 共 ${total} 张`
      for (const chip of chips.children) chip.setAttribute('aria-pressed', String(state.series.includes(chip.dataset.series)))
      actions.replaceChildren()
      if (!current) {
        card.classList.add('is-done'); meta.textContent = ''; hint.textContent = ''; back.hidden = true
        const lines = ['今天的复习做完了。']
        if (upcoming) lines.push(`下一张卡在 ${span(upcoming - Date.now())}后到期。`)
        if (fresh.length && freshLeft === 0) lines.push(`今天的 ${NEW_PER_DAY + daily().extra} 张新卡已经学完，剩下 ${fresh.length} 张新卡明天继续。`)
        front.replaceChildren(...lines.map(line => node('p', '', line)))
        if (fresh.length && freshLeft === 0) actions.append(button('再学 10 张新卡', 'review-more', () => { daily().extra += 10; save(); next() }))
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
      if (storageProblem) actions.append(node('p', 'review-warn', '浏览器没有让这一页保存进度，关掉页面后这次的复习记录会丢失。'))
    }

    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (!revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest?.('button, a')) { event.preventDefault(); show() }
      else if (revealed && /^[1-4]$/.test(event.key)) { event.preventDefault(); grade(Number(event.key)) }
    }, { signal })
    signal.addEventListener('abort', () => clearTimeout(timer))
    next()
  }

  document.addEventListener('pjax:send', () => { lifetime?.abort(); lifetime = null })
  document.addEventListener('pjax:complete', () => { void mount() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void mount() }, { once: true })
  else void mount()

  window.NOIMPTY_REVIEW = Object.freeze({ mount })
})()
