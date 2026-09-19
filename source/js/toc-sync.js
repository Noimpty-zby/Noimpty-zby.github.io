(() => {
  let disposeCurrent = () => {}

  const decodeHash = href => {
    const hash = String(href || '').replace(/^.*#/, '')
    try { return decodeURIComponent(hash) } catch (_) { return hash }
  }

  const initialize = () => {
    disposeCurrent()

    const article = document.getElementById('article-container')
    const toc = document.querySelector('#card-toc .toc-content')
    if (!article || !toc) return

    const headings = Array.from(article.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'))
    const links = Array.from(toc.querySelectorAll('.toc-link'))
    if (headings.length === 0 || links.length === 0) return

    const linksById = new Map(links.map(link => [decodeHash(link.getAttribute('href')), link]))
    let frame = 0
    let settleTimer = 0
    let resizeObserver

    const keepVisible = link => {
      const tocRect = toc.getBoundingClientRect()
      const linkRect = link.getBoundingClientRect()
      const padding = 18

      if (linkRect.top >= tocRect.top + padding && linkRect.bottom <= tocRect.bottom - padding) return

      const top = Math.max(0, toc.scrollTop + linkRect.top - tocRect.top - toc.clientHeight * 0.42)
      if (typeof toc.scrollTo === 'function') toc.scrollTo({ top, behavior: 'smooth' })
      else toc.scrollTop = top
    }

    const sync = () => {
      frame = 0

      // Live viewport positions keep the TOC correct after late image or font layout changes.
      const readingLine = Math.max(48, Math.min(72, window.innerHeight * 0.08))
      let activeHeading = null

      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= readingLine) activeHeading = heading
        else break
      }

      const activeLink = activeHeading ? linksById.get(activeHeading.id) : null
      const activeLinks = toc.querySelectorAll('.toc-link.active')
      const isAlreadyCorrect = activeLink
        ? activeLinks.length === 1 && activeLinks[0] === activeLink
        : activeLinks.length === 0

      if (!isAlreadyCorrect) {
        toc.querySelectorAll('.active').forEach(item => item.classList.remove('active'))

        if (activeLink) {
          activeLink.classList.add('active')
          let parent = activeLink.parentElement
          while (parent && parent !== toc) {
            if (parent.matches('li')) parent.classList.add('active')
            parent = parent.parentElement
          }
        }
      }

      if (activeLink) keepVisible(activeLink)
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(sync)
    }

    const onScroll = () => {
      schedule()
      window.clearTimeout(settleTimer)
      // Butterfly's throttled handler can finish after the final scroll event.
      settleTimer = window.setTimeout(schedule, 140)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    article.querySelectorAll('img').forEach(image => image.addEventListener('load', schedule))

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(schedule)
      resizeObserver.observe(article)
    }

    schedule()

    disposeCurrent = () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', schedule)
      article.querySelectorAll('img').forEach(image => image.removeEventListener('load', schedule))
      if (resizeObserver) resizeObserver.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      disposeCurrent = () => {}
    }
  }

  const initializeAfterNavigation = () => window.setTimeout(initialize, 0)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }

  window.addEventListener('pjax:complete', initializeAfterNavigation)
})()
