/* Light, optional motion. The underlying page is always visible and usable. */
(() => {
  'use strict'

  const key = '__noimptySakuraMotion'
  if (window[key]) {
    window[key].refresh()
    return
  }

  const lightSelector = '.noimpty-section-card, .noimpty-track-card'
  const cardSelector = lightSelector + ', .noimpty-post-card'
  const media = query => {
    try { return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null } catch (_) { return null }
  }
  const fine = media('(hover: hover) and (pointer: fine)')
  const reduced = media('(prefers-reduced-motion: reduce)')
  const connection = window.navigator && (window.navigator.connection || window.navigator.mozConnection || window.navigator.webkitConnection)
  const seenCards = new WeakSet()
  const seenPages = new WeakSet()
  const animations = new Set()
  let activeCard = null
  let pendingPoint = null
  let frame = null
  let cardsObserver = null
  let sceneObserver = null
  let blurred = false

  const motionAllowed = () => !(reduced && reduced.matches)
    && !(connection && connection.saveData) && !document.hidden && !blurred
  const lightAllowed = () => motionAllowed() && Boolean(fine && fine.matches)
  const cardOf = target => target && typeof target.closest === 'function'
    ? target.closest(lightSelector) : null

  const releaseCard = card => {
    if (!card) return
    card.removeAttribute('data-sakura-light')
    card.style.removeProperty('--sakura-light-x')
    card.style.removeProperty('--sakura-light-y')
  }

  const clearLight = () => {
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
    pendingPoint = null
    releaseCard(activeCard)
    activeCard = null
  }

  const stopObservers = () => {
    if (cardsObserver) cardsObserver.disconnect()
    if (sceneObserver) sceneObserver.disconnect()
    cardsObserver = null
    sceneObserver = null
    document.documentElement.removeAttribute('data-sakura-ambient')
  }

  const cancelAnimations = (detachedOnly = false) => {
    animations.forEach(record => {
      if (detachedOnly && record.element.isConnected !== false) return
      animations.delete(record)
      // Web Animations do not modify inline styles. Cancelling restores the
      // underlying CSS immediately, including when a navigation fails.
      try { record.animation.cancel() } catch (_) { /* Optional enhancement. */ }
    })
  }

  const arrive = (element, distance, duration) => {
    if (!motionAllowed() || !element || element.isConnected === false || typeof element.animate !== 'function') return
    try {
      const animation = element.animate([
        { opacity: 0.82, translate: '0 ' + distance + 'px' },
        { opacity: 1, translate: '0 0' }
      ], { duration, easing: 'cubic-bezier(.22,.68,.28,1)', fill: 'none' })
      const record = { element, animation }
      animations.add(record)
      animation.onfinish = animation.oncancel = () => animations.delete(record)
    } catch (_) { /* Older browsers keep the fully rendered static content. */ }
  }

  const paintLight = () => {
    frame = null
    const point = pendingPoint
    pendingPoint = null
    if (!lightAllowed() || !point || point.card.isConnected === false) {
      clearLight()
      return
    }
    const rect = point.card.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) {
      clearLight()
      return
    }
    if (activeCard !== point.card) releaseCard(activeCard)
    activeCard = point.card
    const percent = value => Math.max(0, Math.min(100, value)).toFixed(2) + '%'
    activeCard.style.setProperty('--sakura-light-x', percent((point.x - rect.left) / rect.width * 100))
    activeCard.style.setProperty('--sakura-light-y', percent((point.y - rect.top) / rect.height * 100))
    activeCard.setAttribute('data-sakura-light', '')
  }

  const pointerMove = event => {
    const card = cardOf(event.target)
    if (!lightAllowed() || !card || (event.pointerType && event.pointerType !== 'mouse')
        || event.buttons || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)
        || typeof window.requestAnimationFrame !== 'function') {
      clearLight()
      return
    }
    pendingPoint = { card, x: event.clientX, y: event.clientY }
    // One frame per pointer burst; there is no continuing JavaScript loop.
    if (frame === null) frame = window.requestAnimationFrame(paintLight)
  }

  const pointerOut = event => {
    const card = cardOf(event.target)
    if (card && cardOf(event.relatedTarget) === card) return
    if (!event.relatedTarget || card === activeCard || (pendingPoint && card === pendingPoint.card)) clearLight()
  }

  const watchCards = () => {
    if (typeof window.IntersectionObserver !== 'function') return
    const watch = new window.IntersectionObserver(entries => {
      // A queued callback from a disconnected observer can outlive its page.
      if (cardsObserver !== watch || !motionAllowed()) return
      entries.forEach(entry => {
        const card = entry.target
        if (!entry.isIntersecting || !(entry.intersectionRatio > 0) || card.isConnected === false || seenCards.has(card)) return
        seenCards.add(card)
        watch.unobserve(card)
        arrive(card, 9, 360)
      })
    }, { threshold: 0.08 })
    cardsObserver = watch
    document.querySelectorAll(cardSelector).forEach(card => {
      if (!seenCards.has(card)) watch.observe(card)
    })
  }

  const watchScene = () => {
    const scene = document.querySelector('.sakura-scene')
    if (!scene || typeof window.IntersectionObserver !== 'function') return
    const watch = new window.IntersectionObserver(entries => {
      if (sceneObserver !== watch) return
      const entry = entries.find(value => value.target === scene)
      const playing = motionAllowed() && scene.isConnected !== false && entry
        && entry.isIntersecting && entry.intersectionRatio > 0
      if (playing) document.documentElement.setAttribute('data-sakura-ambient', '')
      else document.documentElement.removeAttribute('data-sakura-ambient')
    }, { threshold: 0 })
    sceneObserver = watch
    watch.observe(scene)
  }

  const refresh = (enter = true) => {
    clearLight()
    stopObservers()
    cancelAnimations(true)
    // The theme replaces #body-wrap. Only its reading container is animated;
    // fixed chat/audio controls and the navigation never acquire a transform.
    const page = document.querySelector('#content-inner')
    if (enter && page && !seenPages.has(page)) {
      seenPages.add(page)
      arrive(page, 7, 300)
    }
    if (!motionAllowed()) {
      cancelAnimations()
      return
    }
    watchCards()
    watchScene()
  }

  const navigationStart = () => {
    clearLight()
    stopObservers()
    cancelAnimations()
    // There is deliberately no pending-navigation lock or outgoing fade.
    // Re-arm the existing page too: Pjax aborts may emit no terminal event.
    refresh(false)
  }

  window[key] = { refresh: () => refresh() }
  document.addEventListener('pointermove', pointerMove, { passive: true })
  document.addEventListener('pointerout', pointerOut, { passive: true })
  document.addEventListener('pointercancel', clearLight, { passive: true })
  window.addEventListener('blur', () => { blurred = true; refresh(false) })
  window.addEventListener('focus', () => { blurred = false; refresh() })
  document.addEventListener('visibilitychange', () => refresh())
  window.addEventListener('pageshow', () => refresh())
  window.addEventListener('noimpty:hub-ready', () => refresh())
  document.addEventListener('pjax:send', navigationStart)
  ;['pjax:complete', 'pjax:error', 'pjax:abort', 'pjax:cancel'].forEach(type => {
    document.addEventListener(type, () => refresh())
  })
  ;[fine, reduced, connection].forEach(preference => {
    if (!preference) return
    if (typeof preference.addEventListener === 'function') preference.addEventListener('change', () => refresh())
    else if (typeof preference.addListener === 'function') preference.addListener(() => refresh())
  })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => refresh(), { once: true })
  else refresh()
})()
