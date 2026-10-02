/* A homepage room made of real, keyboard-accessible destinations. Personal
 * records are requested only after the existing page gate has been unlocked. */
(() => {
  'use strict'
  if (window.NOIMPTY_ROOM) return
  const home = () => /^\/(?:index\.html)?$/.test(window.location.pathname)
  const unlocked = () => window.NOIMPTY_GATE?.unlocked?.() === true
  const KEY = 'noimpty-room-preferences-v1'
  const read = () => { try { const value = JSON.parse(localStorage.getItem(KEY) || '{}'); return { simple: value.simple === true, focus: value.focus === true } } catch (_) { return { simple: false, focus: false } } }
  let preferences = read(), active = null, revision = 0
  const items = [
    { id: 'books', label: '书架', detail: '找一本想读的笔记', href: '#private-sections', x: 13, y: 32, icon: 'book-open' },
    { id: 'review', label: '复习本', detail: '回头看看，哪些已经记住了', href: '/review/', x: 57, y: 52, icon: 'layer-group' },
    { id: 'desk', label: '练习台', detail: '把一个想法，亲手运行起来', href: '/learn/', x: 71, y: 46, icon: 'terminal' },
    { id: 'calendar', label: '日程', detail: '把今天留给值得做的事', href: '/schedule/', x: 87, y: 24, icon: 'calendar-days' },
    { id: 'memories', label: '成长回放', detail: '看看以前的自己，和现在有什么不同', href: '/growth/', x: 29, y: 25, icon: 'images' },
    { id: 'music', label: '放张唱片', detail: '为这一刻选一点声音', action: 'music', x: 29, y: 50, icon: 'record-vinyl' },
    { id: 'company', label: '聊一会儿', detail: '一个问题，一段想法，都可以说', action: 'chat', x: 89, y: 74, icon: 'comment-dots' }
  ]
  const icon = name => `<i class="fas fa-${name}" aria-hidden="true"></i>`
  const control = (item, compact = false) => {
    const tag = item.href ? 'a' : 'button'
    return `<${tag} ${item.href ? `href="${item.href}"` : 'type="button"'} class="room-${compact ? 'shortcut' : 'spot'}" data-room-id="${item.id}" ${item.action ? `data-room-action="${item.action}"` : ''} ${compact ? '' : `style="--spot-x:${item.x}%;--spot-y:${item.y}%"`} aria-label="${item.label}：${item.detail}">${icon(item.icon)}<span>${item.label}</span>${compact ? `<small>${item.detail}</small>` : '<b aria-hidden="true">↗</b>'}</${tag}>`
  }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(preferences)) } catch (_) {} }
  const applyFocus = () => {
    document.documentElement.classList.toggle('noimpty-focus', preferences.focus)
    let exit = document.getElementById('room-focus-exit')
    if (!exit && preferences.focus && document.body) {
      exit = document.createElement('button'); exit.id = 'room-focus-exit'; exit.type = 'button'
      exit.textContent = '退出专注'
      exit.addEventListener('click', () => {
        preferences.focus = false; store(); applyFocus()
        active?.root.querySelector('[data-room-action="focus"]')?.setAttribute('aria-pressed', 'false')
      })
      document.body.append(exit)
    }
    if (exit) exit.hidden = !preferences.focus
    window.dispatchEvent(new CustomEvent('noimpty:focus-mode', { detail: { active: preferences.focus } }))
  }
  const mount = () => {
    document.documentElement.classList.toggle('noimpty-room-home', home())
    applyFocus()
    const header = document.getElementById('page-header')
    if (!home() || !header) { active?.controller.abort(); active = null; revision++; return }
    if (active?.root.isConnected) return
    active?.controller.abort()
    const controller = new AbortController(), { signal } = controller
    const root = document.createElement('section')
    root.className = 'study-room'; root.setAttribute('aria-label', 'Noimpty 的房间')
    root.innerHTML = `<header class="room-heading"><div><p class="room-eyebrow"><span aria-hidden="true"></span> NOIMPTY / AT HOME</p><h1>留一点时间，<em>给自己。</em></h1><p class="room-intro">书翻到哪一页，故事就从哪里继续。</p></div><div class="room-switches"><button type="button" data-room-action="simple" aria-pressed="false">${icon('list-ul')}<span>简洁视图</span></button><button type="button" data-room-action="focus" aria-pressed="false">${icon('moon')}<span>专注</span></button></div></header>
      <div class="room-scene"><img class="room-art" src="/img/study-room.webp" width="1536" height="1024" alt="春日窗边的木质书桌，书架、笔记本、唱片机和一把留给你的椅子" fetchpriority="high" decoding="async"><div class="room-light" aria-hidden="true"></div><div class="room-spots" aria-label="房间里的入口">${items.map(item => control(item)).join('')}</div><span class="room-scene-tag" aria-hidden="true">a little room, a world of your own.</span></div>
      <nav class="room-shortcuts" aria-label="房间入口列表" hidden>${items.map(item => control(item, true)).join('')}<a class="room-shortcut" href="/experiments/">${icon('flask')}<span>动手小实验</span><small>拖一拖、改一改，看看会发生什么</small></a><a class="room-shortcut" href="/teach/">${icon('chalkboard-user')}<span>讲给我听</span><small>用自己的话，把一个问题讲明白</small></a></nav>
      <footer class="room-bottom"><p class="room-caption">${icon('arrow-pointer')} <span>点一点房间里的物件，开始今天的小日常。</span></p><nav aria-label="更多学习入口"><a href="/experiments/">动手小实验 <span aria-hidden="true">↗</span></a><a href="/teach/">讲给我听 <span aria-hidden="true">↗</span></a></nav></footer>
      <p class="room-feedback" role="status" aria-live="polite"></p><div class="room-progress" hidden></div><details class="room-clock-wrap"><summary>此刻 · 小站的时间</summary><div class="room-clock-slot"></div></details>`
    header.append(root)
    active = { root, controller }; revision++
    const caption = root.querySelector('.room-caption span'), feedback = root.querySelector('.room-feedback')
    const announce = message => { if (!signal.aborted) feedback.textContent = message }
    const refreshPreferences = () => {
      root.dataset.simple = String(preferences.simple)
      root.querySelector('.room-scene').hidden = preferences.simple
      root.querySelector('.room-shortcuts').hidden = !preferences.simple
      root.querySelector('[data-room-action="simple"]').setAttribute('aria-pressed', String(preferences.simple))
      root.querySelector('[data-room-action="focus"]').setAttribute('aria-pressed', String(preferences.focus))
    }
    active.refreshPreferences = refreshPreferences
    const musicState = () => {
      const audio = window.NOIMPTY_MUSIC_PLAYER?.audio
      for (const button of root.querySelectorAll('[data-room-action="music"]')) {
        const playing = !!audio && !audio.paused && !audio.ended
        button.setAttribute('aria-pressed', String(playing))
        button.querySelector('span').textContent = playing ? '暂停唱片' : '放张唱片'
      }
    }
    root.addEventListener('click', async event => {
      const button = event.target.closest('[data-room-action]')
      if (!button) return
      const action = button.dataset.roomAction
      if (action === 'simple') { preferences.simple = !preferences.simple; store(); refreshPreferences() }
      if (action === 'focus') { preferences.focus = !preferences.focus; store(); applyFocus(); refreshPreferences(); announce(preferences.focus ? '专注时间。装饰和主动互动会安静下来，音乐由你决定。' : '欢迎回来，房间恢复日常状态。') }
      if (action === 'chat') {
        if (!unlocked()) { window.location.assign('/teach/'); return }
        if (window.NANALY?.open) window.NANALY.open()
        else announce('聊天还在准备中，请稍后再点一次。')
      }
      if (action === 'music') {
        const music = window.NOIMPTY_MUSIC_PLAYER
        if (!music?.audio) { announce('播放器还在准备中，请稍后再试。'); return }
        try { if (!music.audio.paused) music.pause(); else await music.play(); musicState() }
        catch (_) { announce('这次没能播放，请用左下角播放器重试。') }
      }
    }, { signal })
    const describe = event => {
      const target = event.target.closest('[data-room-id]')
      const item = items.find(item => item.id === target?.dataset.roomId)
      if (item) caption.textContent = item.detail
    }
    root.addEventListener('focusin', describe, { signal })
    root.addEventListener('pointerover', describe, { signal })
    const audio = window.NOIMPTY_MUSIC_PLAYER?.audio
    for (const type of ['play', 'pause', 'ended', 'error']) audio?.addEventListener(type, musicState, { signal })
    musicState(); refreshPreferences()
    let summaryRequest = 0
    const refreshSummary = async () => {
      const current = revision, request = ++summaryRequest, host = root.querySelector('.room-progress')
      host.hidden = true; host.replaceChildren()
      if (!unlocked() || !window.NOIMPTY_LEARNING_HISTORY?.summary) return
      try {
        const value = await window.NOIMPTY_LEARNING_HISTORY.summary()
        if (signal.aborted || current !== revision || request !== summaryRequest || !unlocked() || !value) return
        const total = Number(value.cases ?? value.total ?? 0) + Number(value.explanations ?? 0)
        const due = Number(value.due ?? 0) + Number(value.dueExplanations ?? 0)
        if (!Number.isFinite(total) || !Number.isFinite(due) || total < 1) return
        const link = document.createElement('a'); link.href = '/growth/'
        link.textContent = `${total} 个留下来的问题${due > 0 ? ` · ${due} 个可以再试一次` : ' · 慢慢看见自己的进步'} →`
        host.append(link); host.hidden = false
      } catch (_) { /* No fabricated progress when private storage is unavailable. */ }
    }
    window.addEventListener('focus', refreshSummary, { signal })
    window.addEventListener('noimpty:learning-history', refreshSummary, { signal })
    window.addEventListener('noimpty:search-reset', refreshSummary, { signal })
    void refreshSummary()
    window.setTimeout(() => {
      if (signal.aborted) return
      const clock = document.getElementById('noimpty-clock')
      if (clock) root.querySelector('.room-clock-slot').append(clock)
    }, 0)
  }
  applyFocus()
  document.documentElement.classList.toggle('noimpty-room-home', home())
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
  window.addEventListener('pjax:complete', () => window.setTimeout(mount, 0))
  window.addEventListener('pageshow', mount)
  window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) { preferences = read(); applyFocus(); active?.refreshPreferences() } })
  window.NOIMPTY_ROOM = Object.freeze({ mount, focused: () => preferences.focus })
})()
