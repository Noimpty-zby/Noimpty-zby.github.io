/* 首页的三个板块入口。
 *
 * 首页是全站唯一不上锁的页面，所以它的 HTML 里不能有任何文章信息 ——
 * 文章列表已经在构建侧被清空了（scripts/noimpty-lockdown.js），
 * 这里往腾出来的位置填三张板块卡片。
 *
 * 三块的分法对应主人现在真实的时间分配：
 *   课内 —— 学校的专业课，自己按进度学一遍
 *   课外 —— 为了做游戏自己挑的课
 *   Life —— 剩下的部分
 */
(() => {
  const normalizePath = value => {
    let path = value || '/'
    try { path = decodeURI(path) } catch (_) {}
    path = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '/')
    if (!path.startsWith('/')) path = `/${path}`
    if (!path.endsWith('/')) path += '/'
    return path.replace(/\/{2,}/g, '/')
  }

  // Set the scene before the body paints; PJAX updates it again below.
  document.documentElement.classList.toggle('noimpty-home-hub', normalizePath(window.location.pathname) === '/')

  /* 卡片上**只有一个英文单词**，没有任何介绍文字。
   *
   * 这是有意的：首页是全站唯一不上锁的页面，它的每一个字都是对外公开的。
   * 原来那三段介绍（「数据结构与算法、CSAPP、操作系统…」之类）等于把
   * 里面有什么直接写在了门口 —— 锁上门却在门牌上写清楚屋里放着什么，
   * 那道锁就只剩下形式。介绍留在板块页里面，进去了才看得到。
   *
   * 标题用 core / extra / life 也是同一个考虑：三个词都足够含糊，
   * 外人看不出指向什么，而你自己一眼就知道。顺带三个词长度接近，
   * 横排出来视觉上是齐的（这是上一版「两个中文 + 一个英文」最难看的地方）。
   *
   * aria-label 里也不写具体内容，理由同上。 */
  const CARDS = [
    { slug: 'core', href: '/in-class/', image: '/img/sections/in-class.webp', title: 'core' },
    { slug: 'extra', href: '/extra/', image: '/img/sections/extra.webp', title: 'extra' },
    { slug: 'life', href: '/life/', image: '/img/sections/life.webp', title: 'life' }
  ]

  const card = c => `
    <a class="noimpty-section-card noimpty-section-card--${c.slug}" href="${c.href}" aria-label="进入 ${c.title}，需要暗号">
      <span class="noimpty-section-card__image" style="--section-image:url('${c.image}')" aria-hidden="true"></span>
      <span class="noimpty-section-card__content">
        <span class="noimpty-section-card__meta"><span class="noimpty-section-card__lock">Private</span></span>
        <span class="noimpty-section-card__title">${c.title}</span>
        <span class="noimpty-section-card__action">输入暗号后进入</span>
      </span>
    </a>`

  // Decorative elements never include private titles or change the gateways.
  const renderHero = () => {
    const header = document.getElementById('page-header')
    const info = document.getElementById('site-info')
    if (!header || !info || info.querySelector('.sakura-greeting')) return
    const title = document.getElementById('site-title')
    if (title && title.textContent.trim() === 'Noimpty 的个人空间') {
      title.innerHTML = '<span class="sakura-title-name">Noimpty<span aria-hidden="true"> ♡</span></span><span class="sakura-title-cn">的个人空间</span>'
    }
    const greeting = document.createElement('p')
    greeting.className = 'sakura-greeting'
    greeting.innerHTML = '<span aria-hidden="true">✿</span> 很高兴在这里遇见你'
    info.prepend(greeting)
    if (!document.getElementById('site-subtitle')) {
      const subtitle = document.createElement('p')
      subtitle.id = 'site-subtitle'
      subtitle.textContent = '把问题写清楚，也把生活慢慢记下'
      info.appendChild(subtitle)
    }
    const actions = document.createElement('div')
    actions.className = 'sakura-hero-actions'
    actions.innerHTML = '<a class="sakura-enter" href="#private-sections">翻开我的小世界 <span aria-hidden="true">↓</span></a>'
    const social = document.getElementById('site_social_icons')
    if (social) actions.appendChild(social)
    info.appendChild(actions)
    const scene = document.createElement('div')
    scene.className = 'sakura-scene'
    scene.setAttribute('aria-hidden', 'true')
    scene.innerHTML = '<div class="sakura-scene__art"></div>' + Array.from({ length: 10 }, (_, i) =>
      `<span class="sakura-petal" style="--petal-x:${6 + i * 10}%;--petal-delay:-${i * 2.7}s;--petal-duration:${15 + i % 4 * 3}s;--petal-size:${8 + i % 3 * 3}px"></span>`
    ).join('')
    header.appendChild(scene)
  }

  const renderHub = () => {
    const isHome = normalizePath(window.location.pathname) === '/'
    document.documentElement.classList.toggle('noimpty-home-hub', isHome)
    if (!isHome) return
    renderHero()

    const host = document.getElementById('recent-posts') || document.querySelector('#content-inner')
    if (!host || host.querySelector('.noimpty-home-sections')) return

    const hub = document.createElement('section')
    hub.className = 'noimpty-home-sections'
    hub.id = 'private-sections'
    hub.setAttribute('aria-label', '博客内容分区')
    hub.innerHTML = `
      <header class="noimpty-home-sections__intro">
        <p class="noimpty-home-sections__eyebrow">藏在这里的小日常</p>
        <h2>这里是私人记录</h2>
        <p>三块内容都在锁后面。不是给人看的，只是需要一个放东西的地方。</p>
      </header>
      ${CARDS.map(card).join('')}`

    host.prepend(hub)
    window.dispatchEvent(new Event('noimpty:hub-ready'))
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderHub, { once: true })
  } else {
    renderHub()
  }

  window.addEventListener('pjax:complete', () => window.setTimeout(renderHub, 0))
})()
