/* 首页「我的小房间」，以及跨页的专注模式。
 *
 * 房间的结构和小物件的 SVG 在构建时写进了首页的 <template id="noimpty-room-template">
 * （scripts/noimpty-room.js）。这里把它摆到「这里是私人记录」上面，再接上三个按钮：
 * 放唱片、找娜娜莉聊天、专注模式。其余物件都是普通链接，换页走 PJAX。
 *
 * 学习记录的统计只在解锁后才读；上锁、换页、迟到的旧请求都不能把数字写回页面。
 * 专注模式存在 localStorage 里，换页、换标签页都跟着走，任何页面都能点「退出专注」。 */
(() => {
  'use strict'
  if (window.NOIMPTY_ROOM) return
  const home = () => /^\/(?:index\.html)?$/.test(window.location.pathname)
  const unlocked = () => window.NOIMPTY_GATE?.unlocked?.() === true
  const KEY = 'noimpty-room-preferences-v1'
  const read = () => { try { const value = JSON.parse(localStorage.getItem(KEY) || '{}'); return { focus: value?.focus === true } } catch (_) { return { focus: false } } }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(preferences)) } catch (_) {} }
  let preferences = read(), active = null, revision = 0

  const applyFocus = () => {
    document.documentElement.classList.toggle('noimpty-focus', preferences.focus)
    let exit = document.getElementById('room-focus-exit')
    if (!exit && preferences.focus && document.body) {
      exit = document.createElement('button'); exit.id = 'room-focus-exit'; exit.type = 'button'
      exit.textContent = '退出专注'
      exit.addEventListener('click', () => { preferences.focus = false; store(); applyFocus(); active?.refresh() })
      document.body.append(exit)
    }
    if (exit) exit.hidden = !preferences.focus
    window.dispatchEvent(new CustomEvent('noimpty:focus-mode', { detail: { active: preferences.focus } }))
  }

  const mount = () => {
    applyFocus()
    const hub = document.getElementById('private-sections')
    const template = document.getElementById('noimpty-room-template')
    if (!home() || !hub || !template) { active?.controller.abort(); active = null; revision++; return }
    if (active?.root.isConnected) return
    active?.controller.abort()
    const controller = new AbortController(), { signal } = controller
    const holder = document.createElement('div')
    holder.innerHTML = template.innerHTML
    const root = holder.querySelector('.noimpty-room')
    if (!root) return
    hub.before(root)
    // 首屏的「翻开我的小世界 ↓」先落到小房间，再往下才是三张卡片
    document.querySelector('.sakura-enter[href="#private-sections"]')?.setAttribute('href', '#noimpty-room')
    active = { root, controller, refresh: () => {} }; revision++

    const caption = root.querySelector('.noimpty-room__caption')
    const resting = caption.textContent
    const focusButton = root.querySelector('[data-room-action="focus"]')
    const refresh = () => {
      focusButton.setAttribute('aria-pressed', String(preferences.focus))
      focusButton.querySelector('.noimpty-room__focus-label').textContent = preferences.focus ? '退出专注' : '专注一会儿'
    }
    active.refresh = refresh
    const say = message => { if (!signal.aborted) caption.textContent = message }

    const musicState = () => {
      const audio = window.NOIMPTY_MUSIC_PLAYER?.audio
      const playing = !!audio && !audio.paused && !audio.ended
      for (const button of root.querySelectorAll('[data-room-action="music"]')) {
        button.setAttribute('aria-pressed', String(playing))
        button.querySelector('.noimpty-room__tag').textContent = playing ? '停一下唱片' : '放张唱片'
      }
    }

    root.addEventListener('click', async event => {
      const button = event.target.closest('[data-room-action]')
      if (!button) return
      const action = button.dataset.roomAction
      if (action === 'focus') {
        preferences.focus = !preferences.focus; store(); applyFocus(); refresh()
        say(preferences.focus ? '专注时间到。小角色们会安静下来，音乐还是由你决定。' : '专注结束，大家又可以出来玩了。')
      }
      if (action === 'chat') {
        if (window.NANALY?.open) window.NANALY.open()
        else say('聊天还在准备中，过一会儿再点一次吧。')
      }
      if (action === 'music') {
        const music = window.NOIMPTY_MUSIC_PLAYER
        if (!music?.audio) { say('唱片机还在准备中，过一会儿再试试。'); return }
        try { if (!music.audio.paused) music.pause(); else await music.play(); musicState() }
        catch (_) { say('这次没能放出来，可以用左下角的播放器再试一次。') }
      }
    }, { signal })

    // 指到哪个物件，标题下面那行字就说它是做什么的；移开以后换回原来那句
    const describe = event => {
      const target = event.target.closest?.('[data-hint]')
      if (target) say(target.dataset.hint)
    }
    root.addEventListener('focusin', describe, { signal })
    root.addEventListener('pointerover', describe, { signal })
    root.querySelector('.noimpty-room__items')?.addEventListener('pointerleave', () => say(resting), { signal })

    const audio = window.NOIMPTY_MUSIC_PLAYER?.audio
    for (const type of ['play', 'pause', 'ended', 'error']) audio?.addEventListener(type, musicState, { signal })
    musicState(); refresh()

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
      } catch (_) { /* 读不到私人记录时什么都不显示，不编数字 */ }
    }
    window.addEventListener('focus', refreshSummary, { signal })
    window.addEventListener('noimpty:learning-history', refreshSummary, { signal })
    window.addEventListener('noimpty:search-reset', refreshSummary, { signal })
    void refreshSummary()
  }

  applyFocus()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
  // 板块卡片由 section-hub.js 搭出来，它好了以后房间才知道摆在哪
  window.addEventListener('noimpty:hub-ready', () => window.setTimeout(mount, 0))
  window.addEventListener('pjax:complete', () => window.setTimeout(mount, 0))
  window.addEventListener('pageshow', mount)
  window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) { preferences = read(); applyFocus(); active?.refresh() } })
  window.NOIMPTY_ROOM = Object.freeze({ mount, focused: () => preferences.focus })
})()
