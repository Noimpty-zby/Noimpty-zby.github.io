/* A short anime scene wipe. Decorative only: navigation never waits for it. */
(() => {
  'use strict'

  const key = '__noimptySakuraTransition'
  if (window[key]) return

  const media = query => {
    try { return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null } catch (_) { return null }
  }
  const reduced = media('(prefers-reduced-motion: reduce)')
  const contrast = media('(forced-colors: active)')
  const compact = media('(max-width: 600px)')
  const connection = window.navigator && (window.navigator.connection || window.navigator.mozConnection || window.navigator.webkitConnection)
  const animations = new Set()
  let layer = null
  let bands = []
  let petals = []
  let sigil = null
  let expiry = null
  let frame = null
  let headingAnimation = null
  let revision = 0
  let outgoingPage = null

  const allowed = () => !document.hidden && !(reduced && reduced.matches)
    && !(contrast && contrast.matches) && !(connection && connection.saveData)

  const clearSweep = () => {
    if (expiry !== null) window.clearTimeout(expiry)
    expiry = null
    animations.forEach(animation => {
      try { animation.cancel() } catch (_) { /* Decoration must never break navigation. */ }
    })
    animations.clear()
    if (layer) layer.hidden = true
  }

  const stop = () => {
    revision++
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
    clearSweep()
    if (headingAnimation) {
      try { headingAnimation.cancel() } catch (_) { /* Optional enhancement. */ }
      headingAnimation = null
    }
  }

  const reset = () => { stop(); outgoingPage = null }

  const make = (tag, className, parent, text) => {
    const element = document.createElement(tag)
    element.className = className
    if (text) element.textContent = text
    parent.appendChild(element)
    return element
  }

  const prepare = () => {
    if (!document.body || typeof document.body.animate !== 'function') return false
    if (layer && layer.isConnected) return true
    layer = document.createElement('div')
    layer.className = 'sakura-transition'
    layer.hidden = true
    layer.setAttribute('aria-hidden', 'true')
    bands = [1, 2, 3].map(index => make('i', 'sakura-transition__band sakura-transition__band--' + index, layer))
    sigil = make('div', 'sakura-transition__sigil', layer)
    make('i', 'sakura-transition__ring', sigil)
    make('span', 'sakura-transition__star', sigil, '✦')
    make('span', 'sakura-transition__caption', sigil, '下一页，也有好风景')
    petals = [[18, 25], [32, 68], [43, 16], [68, 79], [78, 31], [87, 62]].map(([x, y]) => {
      const petal = make('i', 'sakura-transition__petal', layer)
      petal.style.setProperty('--petal-x', x + '%')
      petal.style.setProperty('--petal-y', y + '%')
      return petal
    })
    // Butterfly replaces #body-wrap. This sibling survives that replacement and
    // never transforms the fixed music player, chat panel or navigation.
    document.body.appendChild(layer)
    return true
  }

  const animate = (element, frames, options) => {
    const animation = element.animate(frames, { fill: 'none', ...options })
    animations.add(animation)
    animation.onfinish = animation.oncancel = () => animations.delete(animation)
  }

  const sweep = (arriving = false) => {
    if (!allowed() || !prepare()) return
    stop()
    layer.hidden = false
    const token = revision
    const small = compact && compact.matches
    const duration = arriving ? 420 : small ? 580 : 680
    const ease = 'cubic-bezier(.65,0,.2,1)'
    const transform = x => 'translate3d(' + x + '%,0,0) skewX(-12deg)'
    try {
      bands.forEach((band, index) => {
        const frames = arriving
          ? [{ transform: transform(0), opacity: .7 }, { transform: transform(125), opacity: 0 }]
          : [{ transform: transform(-125), opacity: .88, offset: 0 },
            { transform: transform(0), opacity: .94, offset: .44 },
            { transform: transform(0), opacity: .88, offset: .54 },
            { transform: transform(125), opacity: 0, offset: 1 }]
        animate(band, frames, { duration, delay: index * 24, easing: ease })
      })
      animate(sigil, arriving
        ? [{ opacity: .75, transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
          { opacity: 0, transform: 'translate3d(50px,-8px,0) rotate(8deg) scale(1.04)' }]
        : [{ opacity: 0, transform: 'translate3d(-55px,8px,0) rotate(-12deg) scale(.86)', offset: 0 },
          { opacity: .95, transform: 'translate3d(0,0,0) rotate(0deg) scale(1)', offset: .42 },
          { opacity: .95, transform: 'translate3d(0,0,0) rotate(0deg) scale(1)', offset: .6 },
          { opacity: 0, transform: 'translate3d(75px,-8px,0) rotate(10deg) scale(1.04)', offset: 1 }],
      { duration, easing: 'ease-in-out' })
      petals.slice(0, small ? 3 : 6).forEach((petal, index) => {
        animate(petal, [
          { opacity: 0, transform: 'translate3d(-70px,28px,0) rotate(-35deg) scale(.65)' },
          { opacity: .8, offset: .4 },
          { opacity: 0, transform: 'translate3d(120px,-45px,0) rotate(135deg) scale(1)' }
        ], { duration, delay: index * 12, easing: 'ease-out' })
      })
      // Pjax can silently abort a request. No completion event is required to
      // remove the effect, and no animation ever blocks clicks or scroll.
      expiry = window.setTimeout(() => { if (revision === token) clearSweep() }, duration + 100)
    } catch (_) { stop() }
  }

  const send = () => {
    stop()
    outgoingPage = document.querySelector('#body-wrap')
    sweep()
  }

  const success = () => {
    const page = document.querySelector('#body-wrap')
    const changed = outgoingPage && page && outgoingPage !== page
    outgoingPage = null
    if (!changed || !allowed() || typeof window.requestAnimationFrame !== 'function') return
    const token = revision
    // success precedes Pjax's scroll restoration. Let it finish before revealing
    // the new heading. sakura-motion owns the separate reading-container entry.
    frame = window.requestAnimationFrame(() => {
      frame = null
      if (revision !== token || !allowed() || page.isConnected === false) return
      if (!layer || layer.hidden) sweep(true)
      const heading = page.querySelector('#page-site-info') || page.querySelector('#site-info')
      if (!heading || typeof heading.animate !== 'function') return
      try {
        const animation = heading.animate(
          [{ opacity: .7, translate: '0 10px' }, { opacity: 1, translate: '0 0' }],
          { duration: 420, easing: 'cubic-bezier(.22,.68,.28,1)', fill: 'none' })
        headingAnimation = animation
        animation.onfinish = animation.oncancel = () => {
          if (headingAnimation === animation) headingAnimation = null
        }
      } catch (_) { /* The fully visible heading is the fallback. */ }
    })
  }

  window[key] = { reset }
  document.addEventListener('pjax:send', send)
  document.addEventListener('pjax:success', success)
  ;['pjax:error', 'pjax:abort', 'pjax:cancel'].forEach(type => document.addEventListener(type, reset))
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset() })
  window.addEventListener('pagehide', reset)
  window.addEventListener('pageshow', reset)
  ;[reduced, contrast, connection].forEach(preference => {
    if (!preference) return
    const change = () => { if (!allowed()) reset() }
    if (typeof preference.addEventListener === 'function') preference.addEventListener('change', change)
    else if (typeof preference.addListener === 'function') preference.addListener(change)
  })
})()
