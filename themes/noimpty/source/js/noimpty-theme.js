/* Noimpty 主题的页面脚本。
 *
 *   - 无刷新换页（pjax）：只换 #body-wrap，音乐、Mao、娜娜莉这些挂在 body 末尾的东西不会断。
 *     换页时照旧发 pjax:send / pjax:complete，私人功能都靠这两个事件重新挂载。
 *   - 转场：六条轨道落下盖满，黑色斜带带着目的地的角色卡切进来。
 *     新页面的响应要压到盖满以后才换上去，否则网快的时候新页面会先从没盖住的地方露一下。
 *   - 每一页的小东西：目录高亮、阅读进度、读完结算、复制代码、长代码折叠、首页选曲、切入动画、打击圈。
 *   - 搜索框：索引是加密的，解锁后由 noimpty-search.js 解开（NOIMPTY_SEARCH.loadCorpus）。
 */
;(() => {
  'use strict'
  if (window.NOIMPTY_THEME) return

  const root = document.documentElement
  const $ = (selector, scope = document) => scope.querySelector(selector)
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)]
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null
  const motionOK = () => !(reduced && reduced.matches) && !document.hidden
  const COVER_MS = 640
  const REVEAL_MS = 720

  /* ---------------- 提示 ---------------- */
  let toastTimer
  const toast = text => {
    const el = $('.toast')
    if (!el) return
    el.textContent = text
    el.classList.add('is-on')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 1800)
  }

  /* ---------------- 解锁状态 ---------------- */
  const owner = () => !!(window.NOIMPTY_GATE && typeof NOIMPTY_GATE.unlocked === 'function' && NOIMPTY_GATE.unlocked())
  const syncOwner = () => root.classList.toggle('nm-owner', owner())

  /* ---------------- 转场 ---------------- */
  const tx = $('.tx')
  const txTitle = tx && $('.tx__title', tx)
  const txCode = tx && $('.tx__cut-code', tx)
  let phase = 'idle'
  let filled = null
  let navigation = 0
  let lastAnchor = null
  let stuck = 0

  // 目的地的角色：链接上写了 data-* 就用它；否则看地址是不是某个系列、板块；都不是就用当前页的颜色
  const describe = (anchor, href) => {
    const d = anchor ? anchor.dataset : {}
    let path = '/'
    try { path = new URL(href || location.href, location.href).pathname } catch (_) {}
    const here = $('#body-wrap')
    const fallback = here ? getComputedStyle(here).getPropertyValue('--sc').trim() : ''
    const title = d.title || (anchor && anchor.textContent.trim().replace(/\s+/g, ' ')) || document.title
    if (d.avatar !== undefined || path === '/' || path === '/about/') {
      return { title: d.title || (path === '/' ? 'Noimpty' : title), color: d.sc || '#f0508a', avatar: true }
    }
    return { title, color: d.sc || fallback || '#22c3e6', code: d.code || 'N' }
  }

  const reset = () => {
    phase = 'idle'
    clearTimeout(stuck)
    if (tx) tx.className = 'tx'
  }

  const cover = target => {
    if (!tx) return
    tx.style.setProperty('--sc', target.color)
    if (txTitle) txTitle.textContent = target.title.length > 60 ? target.title.slice(0, 59) + '…' : target.title
    if (txCode) {
      txCode.textContent = target.code || ''
      txCode.dataset.len = String(Math.min(5, (target.code || '').length))
    }
    tx.className = 'tx'
    void tx.offsetWidth
    tx.classList.add('is-in')
    tx.classList.toggle('is-avatar', !!target.avatar)
    filled = wait(COVER_MS)
    phase = 'cover'
  }

  const reveal = () => {
    phase = 'reveal'
    tx.classList.remove('is-in', 'is-on')
    void tx.offsetWidth
    tx.classList.add('is-out')
    const mine = navigation
    setTimeout(() => { if (mine === navigation && phase === 'reveal') reset() }, REVEAL_MS)
  }

  // 压住 pjax 的响应，等遮罩盖满再换内容。pjax 先发 pjax:send 再发请求，在 send 里装上来得及
  const hold = () => {
    const pjax = window.pjax
    if (!pjax || typeof pjax.handleResponse !== 'function' || pjax.handleResponse.__nm) return
    const original = pjax.handleResponse
    const held = function (...args) {
      const request = navigation
      if (phase !== 'cover' || !filled) return original.apply(this, args)
      const release = () => { if (request === navigation) original.apply(this, args) }
      filled.then(release, release)
    }
    held.__nm = true
    pjax.handleResponse = held
  }

  document.addEventListener('click', event => {
    const anchor = event.target && event.target.closest && event.target.closest('a[href]')
    if (anchor) lastAnchor = { anchor, at: Date.now() }
  }, true)

  document.addEventListener('pjax:send', event => {
    navigation++
    closeMenus()
    closeSearch()
    const trigger = event && event.triggerElement
    const anchor = trigger || (lastAnchor && Date.now() - lastAnchor.at < 1500 ? lastAnchor.anchor : null)
    lastAnchor = null
    if (phase === 'cover') return
    if (!motionOK() || !tx) { reset(); return }
    cover(describe(anchor, anchor ? anchor.href : location.href))
    hold()
    const mine = navigation
    clearTimeout(stuck)
    stuck = setTimeout(() => { if (mine === navigation && phase !== 'idle') reset() }, 9000)
  })

  document.addEventListener('pjax:complete', () => {
    mount(true)
    if (phase !== 'cover') return
    const mine = navigation
    // 两帧以后再揭开：pjax:error 会紧跟着同一个 complete 触发
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (mine === navigation && phase === 'cover') filled.then(() => { if (mine === navigation) reveal() })
    }))
  })

  document.addEventListener('pjax:error', event => {
    const request = event && event.request
    const url = (request && request.responseURL) || (event && event.triggerElement && event.triggerElement.href)
    reset()
    if (url) location.href = url
  })

  window.addEventListener('pageshow', reset)
  document.addEventListener('visibilitychange', () => { if (document.hidden && phase !== 'idle') reset() })

  /* ---------------- 顶栏 ---------------- */
  const closeMenus = () => {
    root.classList.remove('nav-open')
    $$('.nav-more.is-open').forEach(el => el.classList.remove('is-open'))
    $$('.nav-toggle, .nav-more__btn').forEach(el => el.setAttribute('aria-expanded', 'false'))
  }
  document.addEventListener('click', event => {
    const toggle = event.target.closest('.nav-toggle')
    if (toggle) {
      const open = !root.classList.contains('nav-open')
      closeMenus()
      root.classList.toggle('nav-open', open)
      toggle.setAttribute('aria-expanded', String(open))
      return
    }
    const more = event.target.closest('.nav-more__btn')
    if (more) {
      const box = more.parentElement
      const open = !box.classList.contains('is-open')
      closeMenus()
      box.classList.toggle('is-open', open)
      more.setAttribute('aria-expanded', String(open))
      return
    }
    if (!event.target.closest('.nav-more__panel, .nav')) closeMenus()
  })

  /* ---------------- 搜索 ---------------- */
  const dialog = $('#local-search')
  const input = dialog && $('#local-search-input input', dialog)
  const results = dialog && $('#local-search-results', dialog)
  const status = dialog && $('#loading-database', dialog)
  let corpus = null
  let pick = -1

  const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const mark = (text, words) => {
    let html = escapeHtml(text)
    for (const w of words) html = html.replace(new RegExp(escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`)
    return html
  }

  const render = () => {
    if (!results || !corpus) return
    const q = input.value.trim()
    pick = -1
    if (!q) { results.innerHTML = ''; status.textContent = `共 ${corpus.length} 篇，输入关键词开始搜索`; return }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = corpus.map(post => {
      const title = post.title.toLowerCase()
      const text = post.text.toLowerCase()
      if (!words.every(w => title.includes(w) || text.includes(w))) return null
      const score = words.reduce((n, w) => n + (title.includes(w) ? 10 : 0) + Math.min(5, text.split(w).length - 1), 0)
      const at = Math.max(0, text.indexOf(words[0]) - 24)
      const snippet = (at > 0 ? '…' : '') + post.text.slice(at, at + 90)
      return { post, score, snippet }
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 30)
    results.innerHTML = hits.map(h => `<a href="${escapeHtml(h.post.url)}" role="listitem"><b>${mark(h.post.title, words)}</b><span>${mark(h.snippet, words)}</span></a>`).join('')
    status.textContent = hits.length ? `找到 ${hits.length} 篇` : '没有找到相关的文章'
  }

  const openSearch = () => {
    if (!dialog) return
    dialog.hidden = false
    root.classList.add('search-open')
    setTimeout(() => input.focus(), 30)
    if (corpus) { render(); return }
    if (!window.NOIMPTY_SEARCH) { status.textContent = '搜索暂时用不了。'; return }
    status.textContent = '正在载入索引…'
    NOIMPTY_SEARCH.loadCorpus().then(list => { corpus = list; render() }, error => {
      status.textContent = NOIMPTY_SEARCH.explain(String(error && error.message || error))
    })
  }
  const closeSearch = () => {
    if (!dialog || dialog.hidden) return
    dialog.hidden = true
    root.classList.remove('search-open')
  }
  if (dialog) {
    input.addEventListener('input', render)
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('.search-dialog__close')) closeSearch()
      if (event.target.closest('#local-search-results a')) closeSearch()
    })
    input.addEventListener('keydown', event => {
      const links = $$('a', results)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!links.length) return
        pick = (pick + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length
        links.forEach((a, i) => a.classList.toggle('is-active', i === pick))
        links[pick].scrollIntoView({ block: 'nearest' })
      } else if (event.key === 'Enter' && links.length) {
        event.preventDefault()
        ;(links[pick] || links[0]).click()
      }
    })
  }
  document.addEventListener('click', event => {
    if (!event.target.closest('#search-button a')) return
    event.preventDefault()
    openSearch()
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSearch(); closeMenus() }
    const typing = event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"]')
    if (typing) return
    if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || event.key === '/') { event.preventDefault(); openSearch() }
  })

  /* ---------------- 打击圈 ---------------- */
  document.addEventListener('pointerdown', event => {
    if (!motionOK() || !event.target.closest('a, button, [role="option"]')) return
    if (event.target.closest('.noimpty-gate, .search-dialog, #nanaly-root, .nanaly-shell')) return
    const ring = document.createElement('span')
    ring.className = 'tap'
    ring.style.left = event.clientX + 'px'
    ring.style.top = event.clientY + 'px'
    document.body.appendChild(ring)
    setTimeout(() => ring.remove(), 420)
  })

  /* ---------------- 代码块：复制、折叠 ---------------- */
  document.addEventListener('click', event => {
    const copy = event.target.closest('.highlight-tools .copy-button')
    if (copy) {
      const figure = copy.closest('figure')
      const pre = figure && ($('td.code pre', figure) || $('pre', figure))
      const lines = pre ? $$(':scope > .line', pre) : []
      const text = lines.length ? lines.map(line => line.textContent).join('\n') : (pre ? pre.textContent : '')
      const done = ok => { copy.textContent = ok ? '已复制' : '复制失败'; setTimeout(() => { copy.textContent = '复制' }, 1400) }
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done(true), () => done(false))
      else done(false)
      return
    }
    const expand = event.target.closest('.code-expand')
    if (expand) {
      expand.previousElementSibling && expand.closest('figure').classList.remove('is-folded')
      expand.remove()
    }
  })
  const foldCode = scope => {
    const limit = Number(root.dataset.codeLimit || 460)
    $$('figure.highlight', scope).forEach(figure => {
      if (figure.dataset.nmFold) return
      figure.dataset.nmFold = '1'
      const table = $('table', figure)
      if (!table || table.offsetHeight <= limit + 120) return
      figure.classList.add('is-folded')
      figure.style.setProperty('--fold', limit + 'px')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'code-expand'
      button.textContent = `展开全部 ${$$('td.code .line', figure).length || ''} 行`
      figure.appendChild(button)
    })
  }

  /* ---------------- 正文图片：点开看大图 ---------------- */
  let fancyLoading = null
  const loadFancybox = () => fancyLoading || (fancyLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'; css.href = '/pluginsSrc/@fancyapps/ui/dist/fancybox/fancybox.css'
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = '/pluginsSrc/@fancyapps/ui/dist/fancybox/fancybox.umd.js'
    js.onload = () => resolve(window.Fancybox)
    js.onerror = reject
    document.head.appendChild(js)
  }))
  document.addEventListener('click', event => {
    const img = event.target.closest('.prose img')
    if (!img || img.closest('a')) return
    loadFancybox().then(Fancybox => Fancybox && Fancybox.show([{ src: img.currentSrc || img.src, caption: img.alt || '' }]), () => {})
  })

  /* ---------------- 首页选曲 ---------------- */
  const replay = el => { el.classList.remove('is-enter'); void el.offsetWidth; el.classList.add('is-enter') }
  let selectKeys = null
  const mountSelect = () => {
    const box = $('[data-select]')
    if (selectKeys) document.removeEventListener('keydown', selectKeys)
    selectKeys = null
    if (!box) return
    const items = $$('.select__item', box)
    const panels = $$('.select__panel', box)
    let cur = Math.max(0, items.findIndex(el => el.getAttribute('aria-selected') === 'true'))
    const pickItem = (i, focus) => {
      i = (i + items.length) % items.length
      if (i === cur) return
      cur = i
      items.forEach((el, k) => el.setAttribute('aria-selected', String(k === i)))
      panels.forEach((p, k) => { p.hidden = k !== i })
      panels[i].style.setProperty('--delay', '0s')
      replay(panels[i])
      if (focus) items[i].focus()
    }
    const enter = () => { const go = $('.select__go', panels[cur]); if (go) go.click() }
    items.forEach((el, i) => {
      el.addEventListener('mouseenter', () => { if (matchMedia('(hover: hover)').matches) pickItem(i) })
      el.addEventListener('click', () => (i === cur ? enter() : pickItem(i)))
    })
    selectKeys = event => {
      if (event.target.closest && event.target.closest('input, textarea, select')) return
      if (!document.body.contains(box)) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const r = box.getBoundingClientRect()
        if (r.bottom < 0 || r.top > innerHeight) return
        event.preventDefault()
        pickItem(cur + (event.key === 'ArrowDown' ? 1 : -1), true)
      } else if (event.key === 'Enter' && event.target.closest && event.target.closest('.select__item')) {
        event.preventDefault()
        enter()
      }
    }
    document.addEventListener('keydown', selectKeys)
  }

  /* ---------------- 文章页：目录、进度、读完 ---------------- */
  let readCleanup = null
  const mountReading = () => {
    if (readCleanup) readCleanup()
    readCleanup = null
    const prose = $('#post #article-container')
    if (!prose) return
    const t0 = Date.now()
    const links = $$('.post-toc .toc-link')
    const heads = links.map(a => {
      let id = ''
      try { id = decodeURIComponent((a.getAttribute('href') || '').slice(1)) } catch (_) { id = (a.getAttribute('href') || '').slice(1) }
      return document.getElementById(id)
    })
    const result = $('.result')
    const box = $('.post-toc')
    let current = -1
    let shown = false
    const onScroll = () => {
      const rect = prose.getBoundingClientRect()
      const p = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - innerHeight * 0.6)))
      root.style.setProperty('--p', p.toFixed(4))
      let i = -1
      const line = (parseInt(getComputedStyle(root).getPropertyValue('--head-h'), 10) || 64) + 60
      for (let k = 0; k < heads.length; k++) if (heads[k] && heads[k].getBoundingClientRect().top < line) i = k
      if (i !== current) {
        current = i
        links.forEach((a, k) => { a.classList.toggle('is-active', k === i); a.classList.toggle('is-passed', k < i) })
        if (i >= 0 && box) {
          const a = links[i]
          const y = a.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
          if (y < box.scrollTop || y > box.scrollTop + box.clientHeight - 40) box.scrollTo({ top: y - 80, behavior: 'smooth' })
          if (motionOK()) {
            const ring = document.createElement('span')
            ring.className = 'hit'
            a.parentElement.appendChild(ring)
            setTimeout(() => ring.remove(), 500)
          }
        }
      }
      if (result && !shown && rect.bottom < innerHeight * 0.9) {
        shown = true
        const s = Math.round((Date.now() - t0) / 1000)
        const time = $('.result__time', result)
        if (time) time.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
        result.hidden = false
        result.classList.add('is-in')
      }
    }
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onScroll)
    onScroll()
    readCleanup = () => {
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onScroll)
      root.style.removeProperty('--p')
    }
  }

  /* ---------------- 每一页挂载一次 ---------------- */
  const mount = fromNavigation => {
    syncOwner()
    closeMenus()
    $$('[data-intro]').forEach(el => {
      el.style.setProperty('--delay', fromNavigation && phase === 'cover' ? '.3s' : '.05s')
      if (motionOK()) replay(el)
    })
    mountSelect()
    mountReading()
    foldCode(document)
  }

  /* ---------------- 启动 ---------------- */
  const start = () => {
    if (typeof window.Pjax === 'function' && !window.pjax) {
      window.pjax = new window.Pjax({
        elements: 'a:not([target="_blank"]):not([data-fancybox]):not([data-no-pjax]):not([href^="/backup/"]):not([download])',
        selectors: ['head > title', 'meta[name="description"]', '#body-wrap'],
        cacheBust: false,
        scrollRestoration: false
      })
    }
    mount(false)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
  // 解锁以后私人菜单要立刻出来；privacy-gate 解锁时会发 pjax:complete 风格的刷新，这里再兜一道
  window.addEventListener('storage', syncOwner)
  document.addEventListener('noimpty:unlocked', syncOwner)

  window.NOIMPTY_THEME = { toast, openSearch, closeSearch, reset }
})()
