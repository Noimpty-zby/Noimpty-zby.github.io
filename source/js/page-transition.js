/* 切页转场「贴纸泡泡」。
 *
 * 点哪里就从哪里鼓起一个泡泡盖住整页。泡泡本身是一张贴纸：深梅色描边、白边、里面是带圆点的底色，
 * 和页头那些小角色一个画法。盖满之后正中「啪」地贴上要去那一页的小角色和一张标签；
 * 新页面换好，泡泡朝小角色收拢，从四周露出新页面，最后收在角色身上。
 *
 * 角色就是那一页页头里画的小物件（tools/kawaii-art.cjs，构建时输出成 /img/kawaii/<名字>.svg）：
 * 点课程卡片出卡片上那个角色，点顶栏出那个板块的角色，点文章出铅笔。
 *
 * Pjax 照常在后台请求，但换内容这一步等泡泡盖满再做（先压住它的响应）——否则页面来得快时，
 * 新页面会从还没盖住的地方先露一下，盖上，再露一次。转场被撤掉或出错都会立刻放行。
 * 减少动态效果、高对比度、省流量时整个不出现；遮罩从不拦点击；卡住 10 秒自己撤。
 * 泡泡用 clip-path 裁视口大小的层，不放大巨型图层，高分屏上边缘也不会糊成马赛克。
 */
(() => {
  'use strict'

  const key = '__noimptyPageTransition'
  if (window[key]) return

  // 整页路径 → [角色, 标签]。标签对齐各页的 title
  const PLACES = {
    '/': ['balloon', '首页'],
    '/in-class/': ['books', '自学课内'],
    '/extra/': ['server', '自学课外'],
    '/life/': ['mug', 'Life'],
    '/news/': ['newspaper', '资讯'],
    '/schedule/': ['calendar', '日程'],
    '/about/': ['cloud', '关于'],
    '/archives/': ['books', '归档'],
    '/categories/': ['pencil', '分类'],
    '/tags/': ['star', '标签']
  }
  const POST = /^\/\d{4}\/\d{2}\/\d{2}\//
  // 三层贴纸：描边比底色大 11px、白边大 8px，同一条曲线一起动，边的宽度始终不变
  const EDGES = [11, 8, 0]
  const COVER = { duration: 320, easing: 'cubic-bezier(.3,.7,.25,1)' }
  const POP = { duration: 320, delay: 130, easing: 'ease-out' }
  const REVEAL = { duration: 420, easing: 'cubic-bezier(.6,0,.3,1)' }
  const LIFT = 24 // 小角色的中心在视口正中往上这么多（和 page-transition.css 对齐）
  const STUCK = 10000 // 迟迟没有新页面：撤掉遮罩，旧页面还能用
  const FAILED = 4000 // Pjax 报错后主题会整页跳转；过了这么久还没跳走就撤掉

  const media = query => {
    try { return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null } catch (_) { return null }
  }
  const reduced = media('(prefers-reduced-motion: reduce)')
  const contrast = media('(forced-colors: active)')
  const connection = window.navigator && (window.navigator.connection || window.navigator.mozConnection || window.navigator.webkitConnection)
  const allowed = () => !document.hidden && !(reduced && reduced.matches)
    && !(contrast && contrast.matches) && !(connection && connection.saveData)

  let root = null
  let waves = []
  let card = null
  let halo = null
  let mascot = null
  let label = null
  let phase = 'idle' // idle → cover → reveal → idle
  let run = 0 // 每次遮罩重来 +1，过期的回调认得出自己
  let navigation = 0 // 每次 pjax:send +1；404 会在同一层遮罩下接着再请求一次
  let arrived = false
  let failed = false
  let filled = null // 底色盖满整屏
  let covered = null // 盖满，而且小角色也贴好了
  let stuck = null
  let failing = null
  let lastClick = null
  let lastHref = window.location.href
  const animations = new Set()

  const clean = text => String(text || '').replace(/\s+/g, ' ').trim()
  const clip = (text, size) => text.length > size ? text.slice(0, size - 1) + '…' : text
  const pathOf = href => {
    try { return new URL(href, window.location.href).pathname.replace(/\/index\.html$/, '/') } catch (_) { return '' }
  }
  const characterOf = icon => {
    const own = icon && String(icon.getAttribute('class') || '').split(/\s+/)
      .find(name => name.startsWith('kw--') && name !== 'kw--one')
    return own ? own.slice(4) : ''
  }

  // 目的地的角色和标签：卡片上画了角色就用它，否则按路径查表；标签优先用链接自己的标题
  const describe = (anchor, href) => {
    const path = pathOf(href)
    const place = PLACES[path]
    let character = place ? place[0] : POST.test(path) ? 'pencil' : ''
    let text = ''
    if (anchor && typeof anchor.querySelector === 'function') {
      character = characterOf(anchor.querySelector('svg.kw--one')) || character
      const heading = anchor.querySelector('h1, h2, h3, h4')
      const named = anchor.getAttribute && (anchor.getAttribute('title') || anchor.getAttribute('aria-label'))
      text = clean(named).replace(/^阅读：/, '') || clean(heading ? heading.textContent : anchor.textContent)
    }
    if (!character) {
      // 板块下面的页（/in-class/dsa/ 之类）没从卡片进来时，用板块的角色
      const section = Object.keys(PLACES).find(prefix => prefix !== '/' && path.startsWith(prefix))
      character = section ? PLACES[section][0] : 'star'
    }
    return { character, label: clip((place && place[1]) || text || '下一页', 18) }
  }

  const make = (tag, className, parent) => {
    const element = document.createElement(tag)
    element.className = className
    if (parent) parent.appendChild(element)
    return element
  }

  const sparkle = (className, parent) => {
    const holder = make('span', 'noimpty-pt__sparkle ' + className, parent)
    holder.innerHTML = '<svg viewBox="-10 -10 20 20" aria-hidden="true" focusable="false"><path d="M0-9C.8-3 3-.8 9 0 3 .8.8 3 0 9-.8 3-3 .8-9 0-3-.8-.8-3 0-9z"/></svg>'
  }

  const build = () => {
    if (root && root.isConnected !== false) return true
    if (!document.body) return false
    root = make('div', 'noimpty-pt')
    root.hidden = true
    root.setAttribute('aria-hidden', 'true')
    waves = ['line', 'rim', 'fill'].map(name => make('div', 'noimpty-pt__wave noimpty-pt__wave--' + name, root))
    card = make('div', 'noimpty-pt__card', root)
    halo = make('span', 'noimpty-pt__halo', card)
    mascot = make('img', 'noimpty-pt__mascot', card)
    mascot.alt = ''
    mascot.decoding = 'async'
    sparkle('noimpty-pt__sparkle--a', card)
    sparkle('noimpty-pt__sparkle--b', card)
    sparkle('noimpty-pt__sparkle--c', card)
    label = make('span', 'noimpty-pt__label', card)
    const dots = make('span', 'noimpty-pt__dots', card)
    make('i', '', dots); make('i', '', dots); make('i', '', dots)
    // 放在 #body-wrap 外面：Pjax 换页时它不会被一起换掉
    document.body.appendChild(root)
    return true
  }

  const cancelAll = () => {
    animations.forEach(animation => {
      try { animation.cancel() } catch (_) { /* 装饰出错不影响导航 */ }
    })
    animations.clear()
  }

  const done = () => {
    run++
    phase = 'idle'
    arrived = false
    failed = false
    filled = null
    covered = null
    if (stuck !== null) window.clearTimeout(stuck)
    if (failing !== null) window.clearTimeout(failing)
    stuck = null
    failing = null
    // 取消会让压着的响应立刻放行（它等的是 filled，取消后变成 rejected）
    cancelAll()
    if (root) {
      root.hidden = true
      root.removeAttribute('data-state')
    }
  }

  const animate = (element, frames, options) => {
    const animation = element.animate(frames, { fill: 'both', ...options })
    animations.add(animation)
    // 被取消时 finished 会 reject；先接住，控制台不冒 AbortError
    if (animation.finished && typeof animation.finished.catch === 'function') animation.finished.catch(() => {})
    return animation
  }

  const circle = (radius, x, y) => {
    const value = 'circle(' + Math.max(0, radius).toFixed(1) + 'px at ' + x.toFixed(1) + 'px ' + y.toFixed(1) + 'px)'
    return { clipPath: value, webkitClipPath: value }
  }
  const reach = (x, y, width, height) => Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) + 4

  const cover = (point, target) => {
    const width = window.innerWidth || 1
    const height = window.innerHeight || 1
    const x = point ? point.x : width / 2
    const y = point ? point.y : height / 2
    const radius = reach(x, y, width, height)
    mascot.src = '/img/kawaii/' + target.character + '.svg'
    label.textContent = target.label
    root.hidden = false
    root.setAttribute('data-state', 'cover')
    const spread = waves.map((wave, index) => animate(wave,
      [circle(EDGES[index], x, y), circle(radius + EDGES[index], x, y)], COVER))
    // 小角色压扁一下再弹开，像贴纸被「啪」地拍上去
    const pop = animate(card, [
      { opacity: 0, transform: 'translateY(16px) scale(.45, .45) rotate(-10deg)' },
      { opacity: 1, transform: 'translateY(-6px) scale(1.12, .9) rotate(3deg)', offset: 0.55 },
      { opacity: 1, transform: 'translateY(0) scale(.96, 1.05) rotate(-1deg)', offset: 0.8 },
      { opacity: 1, transform: 'translateY(0) scale(1, 1) rotate(0deg)' }
    ], POP)
    filled = spread[spread.length - 1].finished
    covered = Promise.all([...spread, pop].map(animation => animation.finished))
    covered.catch(() => {})
  }

  const reveal = () => {
    phase = 'reveal'
    root.setAttribute('data-state', 'reveal')
    const width = window.innerWidth || 1
    const height = window.innerHeight || 1
    const x = width / 2
    const y = height / 2 - LIFT
    const radius = reach(x, y, width, height)
    const previous = [...animations]
    const closing = waves.map((wave, index) => animate(wave,
      [circle(radius + EDGES[index], x, y), circle(0, x, y)], REVEAL))
    // 标签先收起来，只剩小角色被泡泡框住；泡泡快合上时它轻轻一跳，跟着缩没
    closing.push(animate(label, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in' }))
    // 光晕跟着泡泡一起收掉，不留一团光浮在新页面上
    closing.push(animate(halo, [{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0, offset: 0.8 }, { opacity: 0 }], REVEAL))
    // 透明度要写上：弹出那段动画马上被撤掉，不写就退回样式表里的 0，角色当场消失
    closing.push(animate(card, [
      { opacity: 1, transform: 'translateY(0) scale(1) rotate(0deg)' },
      { opacity: 1, transform: 'translateY(-8px) scale(1.06) rotate(-3deg)', offset: 0.55 },
      { opacity: 1, transform: 'translateY(2px) scale(0) rotate(12deg)' }
    ], { ...REVEAL, easing: 'cubic-bezier(.5,0,.75,.2)' }))
    // 新的几段起点就是整屏盖满，先接上再撤掉旧的，中间不会露缝
    previous.forEach(animation => {
      animations.delete(animation)
      try { animation.cancel() } catch (_) { /* 忽略 */ }
    })
    const mine = run
    Promise.all(closing.map(animation => animation.finished)).then(() => { if (run === mine) done() }, () => {})
  }

  // 盖满、小角色贴好、新页面也到了，三件事都齐才打开
  const settle = () => {
    if (phase !== 'cover' || !arrived || !covered) return
    if (document.hidden || !allowed()) { done(); return }
    const mine = run
    covered.then(() => {
      if (run !== mine || phase !== 'cover') return
      try { reveal() } catch (_) { done() }
    }, () => { if (run === mine) done() })
  }

  // 压住 Pjax 的响应直到底色盖满。loadUrl 先发 pjax:send 再发请求，所以在 send 里装上赶得及
  const hold = () => {
    const pjax = window.pjax
    if (!pjax || typeof pjax.handleResponse !== 'function' || pjax.handleResponse[key]) return
    const original = pjax.handleResponse
    const held = function (...args) {
      const request = navigation
      if (phase !== 'cover' || !filled) return original.apply(this, args)
      const release = () => { if (request === navigation) original.apply(this, args) }
      // 期间开始了新的切页，这份旧响应就不要了 —— Pjax 自己也会中止旧请求
      filled.then(release, release)
    }
    held[key] = true
    pjax.handleResponse = held
  }

  const send = event => {
    const trigger = event && event.triggerElement
    const click = lastClick && trigger && lastClick.anchor === trigger && Date.now() - lastClick.at < 1500 ? lastClick : null
    lastClick = null
    // 前进后退时地址已经先变成目的地；主题或助手用代码跳页时两边都没有，就是个通用的「下一页」
    const popped = !trigger && window.location.href !== lastHref
    const target = trigger ? describe(trigger, trigger.href) : popped ? describe(null, window.location.href) : { character: 'star', label: '下一页' }
    navigation++
    arrived = false
    failed = false
    if (phase === 'cover') return // 已经盖着（例如 404 转去 404 页），接着等
    if (!allowed() || !build() || typeof root.animate !== 'function') { done(); return }
    done()
    phase = 'cover'
    try {
      cover(click && !click.keyboard ? click : null, target)
      hold()
    } catch (_) { done(); return }
    const mine = run
    stuck = window.setTimeout(() => { if (run === mine) done() }, STUCK)
    preload(target.character)
  }

  const complete = () => {
    lastHref = window.location.href
    if (phase !== 'cover') return
    const mine = run
    const request = navigation
    // pjax:error 紧跟在同一个 complete 后面同步触发（404 时主题还会马上再请求 404 页），
    // 等两帧再看：出错了、或者已经换成了下一次请求，这一次的 complete 都不算数
    const next = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame : callback => window.setTimeout(callback, 16)
    next(() => next(() => {
      if (run !== mine || phase !== 'cover' || request !== navigation) return
      if (failed) {
        failing = window.setTimeout(() => { if (run === mine && phase === 'cover' && request === navigation) done() }, FAILED)
        return
      }
      arrived = true
      settle()
    }))
  }

  const seen = new Set()
  const preload = character => {
    if (!character || seen.has(character) || typeof window.Image !== 'function') return
    seen.add(character)
    const image = new window.Image()
    image.decoding = 'async'
    image.src = '/img/kawaii/' + character + '.svg'
  }
  // 空闲时把板块和页面上卡片的角色都预先拿一份（每张 2–4 KB），泡泡里第一次出现也不是空的
  const warm = () => {
    if (!allowed()) return
    const idle = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback : callback => window.setTimeout(callback, 1200)
    idle(() => {
      Object.values(PLACES).forEach(([character]) => preload(character))
      preload('pencil'); preload('star')
      document.querySelectorAll('a svg.kw--one').forEach(icon => preload(characterOf(icon)))
    })
  }

  window[key] = { reset: done, describe }
  document.addEventListener('click', event => {
    const anchor = event.target && typeof event.target.closest === 'function' ? event.target.closest('a[href]') : null
    if (!anchor) return
    // 键盘回车触发的 click 没有坐标，泡泡从正中鼓起来
    lastClick = { anchor, x: event.clientX, y: event.clientY, keyboard: event.detail === 0, at: Date.now() }
  }, true)
  document.addEventListener('pjax:send', send)
  document.addEventListener('pjax:complete', complete)
  document.addEventListener('pjax:complete', warm)
  document.addEventListener('pjax:error', () => { failed = true })
  document.addEventListener('visibilitychange', () => { if (document.hidden && phase !== 'idle') done() })
  window.addEventListener('pageshow', done)
  ;[reduced, contrast, connection].forEach(preference => {
    if (!preference) return
    const change = () => { if (!allowed()) done() }
    if (typeof preference.addEventListener === 'function') preference.addEventListener('change', change)
    else if (typeof preference.addListener === 'function') preference.addListener(change)
  })
  if (document.readyState === 'complete') warm()
  else window.addEventListener('load', warm)
})()
