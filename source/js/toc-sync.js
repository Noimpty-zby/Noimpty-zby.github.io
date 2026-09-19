(() => {
  if (window.__NOIMPTY_TOC_SYNC__) return
  window.__NOIMPTY_TOC_SYNC__ = true

  let disposeCurrent = () => {}
  let initializeTimer = 0
  let navigationRevision = 0
  const motionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

  const decodeHash = href => {
    const hash = String(href || '').replace(/^.*#/, '')
    try { return decodeURIComponent(hash) } catch (_) { return hash }
  }

  const initialize = () => {
    window.clearTimeout(initializeTimer)
    initializeTimer = 0
    disposeCurrent()

    const article = document.getElementById('article-container')
    const toc = document.querySelector('#card-toc .toc-content')
    if (!article || !toc) return

    const headings = Array.from(article.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'))
    const links = Array.from(toc.querySelectorAll('.toc-link'))
    if (headings.length === 0 || links.length === 0) return

    const linksById = new Map(links.map(link => [decodeHash(link.getAttribute('href')), link]))
    const images = Array.from(article.querySelectorAll('img'))
    let frame = 0
    let settleTimer = 0
    let resizeObserver
    let disposed = false
    let scrollRequest = null

    const keepVisible = link => {
      if (scrollRequest && scrollRequest.link !== link) scrollRequest = null
      const tocRect = toc.getBoundingClientRect()
      const linkRect = link.getBoundingClientRect()
      const padding = 18

      // A closed mobile TOC has no visible viewport to scroll into.
      if (toc.clientHeight <= 0 || tocRect.bottom <= tocRect.top) return
      if (linkRect.top >= tocRect.top + padding && linkRect.bottom <= tocRect.bottom - padding) return

      const maximum = Number.isFinite(toc.scrollHeight) ? Math.max(0, toc.scrollHeight - toc.clientHeight) : Infinity
      const top = Math.min(maximum, Math.max(0, toc.scrollTop + linkRect.top - tocRect.top - toc.clientHeight * 0.42))
      // During native smooth scrolling, scrollTop and the link's viewport position
      // change together; the destination stays the same. Do not restart that trip
      // on every article scroll event or fight someone browsing the TOC manually.
      if (scrollRequest && scrollRequest.link === link && Math.abs(scrollRequest.top - top) < 1) return
      scrollRequest = { link, top }
      if (typeof toc.scrollTo === 'function') toc.scrollTo({ top, behavior: motionQuery?.matches ? 'instant' : 'smooth' })
      else toc.scrollTop = top
    }

    const sync = () => {
      frame = 0
      if (disposed) return

      // Live viewport positions keep the TOC correct after late image or font layout changes.
      // Butterfly's TOC click scroll leaves the heading about 70px from the
      // top. Keep a small rounding margin on short/mobile viewports as well.
      const readingLine = 72
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
      else scrollRequest = null
    }

    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(sync)
    }

    const onScroll = () => {
      schedule()
      window.clearTimeout(settleTimer)
      // Butterfly's observer can finish after the final scroll event. Reconcile
      // its active classes once more, without restarting an unchanged scroll.
      settleTimer = window.setTimeout(schedule, 140)
    }

    const onMotionChange = () => {
      scrollRequest = null
      // Snap an in-flight native scroll to its current position when motion is
      // disabled, including when its target has already entered the viewport.
      if (motionQuery.matches && typeof toc.scrollTo === 'function') {
        toc.scrollTo({ top: toc.scrollTop, behavior: 'instant' })
      }
      schedule()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    images.forEach(image => image.addEventListener('load', schedule))
    if (motionQuery?.addEventListener) motionQuery.addEventListener('change', onMotionChange)
    else if (motionQuery?.addListener) motionQuery.addListener(onMotionChange)

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(schedule)
      resizeObserver.observe(article)
    }

    schedule()

    disposeCurrent = () => {
      disposed = true
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', schedule)
      images.forEach(image => image.removeEventListener('load', schedule))
      if (motionQuery?.removeEventListener) motionQuery.removeEventListener('change', onMotionChange)
      else if (motionQuery?.removeListener) motionQuery.removeListener(onMotionChange)
      if (resizeObserver) resizeObserver.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      disposeCurrent = () => {}
    }
  }

  const scheduleInitialize = () => {
    window.clearTimeout(initializeTimer)
    const revision = ++navigationRevision
    initializeTimer = window.setTimeout(() => {
      if (revision === navigationRevision) initialize()
    }, 0)
  }

  window.addEventListener('pjax:send', () => {
    disposeCurrent()
    // An aborted navigation may never emit complete/error. The existing article
    // is still usable while the request runs, so restore it in the next task.
    // A later complete supersedes this refresh and binds the replacement DOM.
    scheduleInitialize()
  })
  window.addEventListener('pjax:complete', scheduleInitialize)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
