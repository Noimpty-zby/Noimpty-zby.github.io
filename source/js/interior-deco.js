/* 内页页头的小动效：飘落的樱花瓣和浮上来的肥皂泡；鼠标在页头上移动时贴纸和角色跟着轻轻偏一点；
   小角色（{% kawaii %}）的眼珠跟着鼠标转，点一下会跳起来、换一句话、迸出几颗心。
   只加装饰，页面内容不依赖它；系统开了「减少动态效果」就只留换台词。PJAX 换页时拆掉重装。 */
(() => {
  'use strict'
  if (window.NOIMPTY_INTERIOR_DECO) return
  window.NOIMPTY_INTERIOR_DECO = true
  // Pages with their own header also keep the theme's page title, hidden, ahead of it in the
  // document; only a visible title stands in when there is no header.
  const TITLES = '#page > .page-title, #content-inner > :is(#archive, #category, #tag) > .article-sort-title'
  const PETALS = 8
  const BUBBLES = 6
  const BURST = ['♥', '✦', '♡', '✧', '♪']
  const COLORS = ['#ff8fab', '#ffd35c', '#8fd3ff', '#b89cff', '#8fe0c0']
  let teardown = null

  const particles = head => {
    const layer = document.createElement('div')
    layer.className = 'noimpty-petals'
    layer.setAttribute('aria-hidden', 'true')
    const add = (tag, count, size, speed) => {
      for (let i = 0; i < count; i++) {
        const el = document.createElement(tag)
        const duration = speed[0] + Math.random() * speed[1]
        el.style.cssText = [
          `--x:${(i + Math.random()) / count * 100}%`,
          `--s:${size[0] + Math.random() * size[1]}px`,
          `--dur:${duration}s`,
          // Negative delays start each one part-way through, so the page opens with them already moving.
          `--delay:${-Math.random() * duration}s`,
          `--drift:${(Math.random() - 0.3) * 120}px`
        ].join(';')
        layer.append(el)
      }
    }
    add('i', PETALS, [8, 9], [9, 8])
    add('b', BUBBLES, [10, 22], [10, 8])
    head.prepend(layer)
    return layer
  }

  // A trailing kaomoji stays on one line and takes the page colour.
  const say = (bubble, line) => {
    const parts = line.match(/^(.*?)\s+(\S*[(（].*)$/)
    bubble.textContent = parts ? `${parts[1]} ` : line
    if (!parts) return
    const face = document.createElement('span')
    face.className = 'noimpty-kaomoji'
    face.textContent = parts[2]
    bubble.append(face)
  }

  // One tap: hop, say the next line, and scatter a few hearts and stars.
  const talk = (scene, still) => {
    const extra = (scene.dataset.lines || '').split('|').map(line => line.trim()).filter(Boolean)
    let bubble = scene.querySelector('.noimpty-scene__bubble')
    if (!scene.noimptyLines) scene.noimptyLines = { list: bubble ? [bubble.textContent, ...extra] : extra, at: bubble ? 0 : -1 }
    const state = scene.noimptyLines
    if (state.list.length) {
      state.at = (state.at + 1) % state.list.length
      if (!bubble) {
        bubble = document.createElement('p')
        bubble.className = 'noimpty-scene__bubble'
        bubble.setAttribute('role', 'status')
        scene.prepend(bubble)
      }
      say(bubble, state.list[state.at])
      if (!still) bubble.animate?.([{ opacity: 0, transform: 'scale(.6) translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.34,1.56,.64,1)' })
      // A course mascot only speaks when tapped, then goes quiet again.
      if (scene.classList.contains('noimpty-scene--one')) {
        clearTimeout(scene.noimptyQuiet)
        scene.noimptyQuiet = setTimeout(() => bubble.remove(), 3200)
      }
    }
    if (still) return
    scene.classList.remove('is-hop')
    void scene.getBoundingClientRect()
    scene.classList.add('is-hop')
    clearTimeout(scene.noimptyHop)
    scene.noimptyHop = setTimeout(() => scene.classList.remove('is-hop'), 900)
    const art = scene.querySelector('.kw') || scene
    const box = art.getBoundingClientRect()
    const host = scene.getBoundingClientRect()
    for (let i = 0; i < 7; i++) {
      const spark = document.createElement('span')
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3
      const reach = 50 + Math.random() * 50
      spark.className = 'kw-burst'
      spark.setAttribute('aria-hidden', 'true')
      spark.textContent = BURST[i % BURST.length]
      spark.style.cssText = [
        `--x:${box.left - host.left + box.width * (0.35 + Math.random() * 0.3)}px`,
        `--y:${box.top - host.top + box.height * 0.55}px`,
        `--tx:${Math.cos(angle) * reach}px`,
        `--ty:${Math.sin(angle) * reach}px`,
        `--r:${(Math.random() - 0.5) * 80}deg`,
        `--s:${12 + Math.random() * 10}px`,
        `--c:${COLORS[i % COLORS.length]}`
      ].join(';')
      scene.append(spark)
      spark.addEventListener('animationend', () => spark.remove(), { once: true })
    }
  }

  const mount = () => {
    teardown?.()
    teardown = null
    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const cleanups = []

    const scenes = [...document.querySelectorAll('.noimpty-scene')]
    for (const scene of scenes) {
      const onTap = () => talk(scene, still)
      scene.addEventListener('click', onTap)
      cleanups.push(() => scene.removeEventListener('click', onTap))
    }

    const head = document.querySelector('.noimpty-hero') || [...document.querySelectorAll(TITLES)].find(title => title.getClientRects().length)
    if (!still) {
      if (head) {
        const layer = particles(head)
        cleanups.push(() => layer.remove())
      }
      // Every mascot on the page looks toward the pointer; the header also leans a little.
      const faces = [...document.querySelectorAll('svg.kw')]
      let frame = 0
      const move = event => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          for (const svg of faces) {
            const box = svg.getBoundingClientRect()
            if (box.bottom < 0 || box.top > innerHeight) continue
            const dx = event.clientX - (box.left + box.width / 2)
            const dy = event.clientY - (box.top + box.height * 0.6)
            const far = Math.min(Math.hypot(dx, dy) / 140, 1) / (Math.hypot(dx, dy) || 1)
            svg.style.setProperty('--ex', (dx * far).toFixed(2))
            svg.style.setProperty('--ey', (dy * far).toFixed(2))
          }
          if (head) {
            const box = head.getBoundingClientRect()
            const inside = event.clientY >= box.top && event.clientY <= box.bottom
            head.style.setProperty('--mx', inside ? ((event.clientX - box.left) / box.width - 0.5).toFixed(3) : '0')
            head.style.setProperty('--my', inside ? ((event.clientY - box.top) / box.height - 0.5).toFixed(3) : '0')
          }
        })
      }
      const rest = () => {
        for (const svg of faces) { svg.style.setProperty('--ex', '0'); svg.style.setProperty('--ey', '0') }
        head?.style.setProperty('--mx', '0')
        head?.style.setProperty('--my', '0')
      }
      window.addEventListener('pointermove', move, { passive: true })
      document.documentElement.addEventListener('pointerleave', rest)
      cleanups.push(() => {
        cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', move)
        document.documentElement.removeEventListener('pointerleave', rest)
      })
    }
    teardown = () => cleanups.forEach(fn => fn())
  }

  document.addEventListener('pjax:send', () => { teardown?.(); teardown = null })
  window.addEventListener('pjax:complete', mount)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
})()
