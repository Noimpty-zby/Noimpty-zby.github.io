/* 内页页头的小动效：飘落的樱花瓣，鼠标在页头上移动时贴纸和娜娜莉跟着轻轻偏一点。
   只加装饰，页面内容不依赖它；系统开了「减少动态效果」就什么都不做。PJAX 换页时拆掉重装。 */
(() => {
  'use strict'
  if (window.NOIMPTY_INTERIOR_DECO) return
  window.NOIMPTY_INTERIOR_DECO = true
  // Pages with their own header also keep the theme's page title, hidden, ahead of it in the
  // document; only a visible title stands in when there is no header.
  const TITLES = '#page > .page-title, #content-inner > :is(#archive, #category, #tag) > .article-sort-title'
  const PETALS = 12
  let teardown = null

  const mount = () => {
    teardown?.()
    teardown = null
    const head = document.querySelector('.noimpty-hero') || [...document.querySelectorAll(TITLES)].find(title => title.getClientRects().length)
    if (!head || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const layer = document.createElement('div')
    layer.className = 'noimpty-petals'
    layer.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < PETALS; i++) {
      const petal = document.createElement('i')
      const duration = 9 + Math.random() * 8
      petal.style.cssText = [
        `--x:${(i + Math.random()) / PETALS * 100}%`,
        `--s:${8 + Math.random() * 9}px`,
        `--dur:${duration}s`,
        // Negative delays start each petal part-way down, so the page opens with petals already in the air.
        `--delay:${-Math.random() * duration}s`,
        `--drift:${(Math.random() - 0.3) * 120}px`
      ].join(';')
      layer.append(petal)
    }
    head.prepend(layer)
    let frame = 0
    const move = event => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = head.getBoundingClientRect()
        head.style.setProperty('--mx', ((event.clientX - box.left) / box.width - 0.5).toFixed(3))
        head.style.setProperty('--my', ((event.clientY - box.top) / box.height - 0.5).toFixed(3))
      })
    }
    const leave = () => { head.style.setProperty('--mx', '0'); head.style.setProperty('--my', '0') }
    head.addEventListener('pointermove', move)
    head.addEventListener('pointerleave', leave)
    teardown = () => {
      cancelAnimationFrame(frame)
      head.removeEventListener('pointermove', move)
      head.removeEventListener('pointerleave', leave)
      layer.remove()
    }
  }

  document.addEventListener('pjax:send', () => { teardown?.(); teardown = null })
  window.addEventListener('pjax:complete', mount)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
})()
