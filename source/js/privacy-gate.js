/* 暗号门。
 *
 * 两点和上一版不同：
 *
 * 1. **默认拒绝**。以前是「清单里有的才锁」，漏一条就是一个洞 ——
 *    新加一个板块、忘了加进清单，它就是公开的，而且没人会发现。
 *    现在反过来：白名单（首页、关于）之外一律锁。清单只用来决定
 *    解锁框上显示哪个板块名。
 *
 * 2. **记住暗号本身**，不只是「解锁过」这个标记。
 *    search.xml 现在是加密的，站内搜索要用暗号派生的密钥去解
 *    （见 noimpty-search.js）。存在 sessionStorage 里，关掉标签页就没了。
 *
 * 再说一次这道锁的边界：它挡的是眼睛。正文仍在 HTML 里，
 * 会看「查看源代码」的人拿得到。详见 scripts/noimpty-lockdown.js 顶部。
 */
(() => {
  const privacy = window.NOIMPTY_PRIVACY || { entries: [], publicPaths: ['/'], lockAllExceptPublic: true }

  /* 校验哈希由构建侧发出（scripts/noimpty-lockdown.js），不写死在这里。
   *
   * 因为暗号有两个用途：开门，和解密 search.xml。两处各存一份的话，
   * 改了其中一个就会出现「门能开、但搜索永远解不开」这种指不到原因的故障。
   * 下面那个常量只是兜底 —— 构建时没设 NOIMPTY_PASSPHRASE 时用它。 */
  const expectedHash = privacy.passHash
    || '5a1eee3bcf723aea5c87c85ee62696443505c86e9f0add455c85252d3412d591'
  const SESSION_FLAG = 'noimpty-private-unlocked'
  const SESSION_PASS = 'noimpty-private-pass'

  const normalizePath = value => {
    let path = value || '/'
    try { path = decodeURI(path) } catch (_) {}
    path = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '/')
    if (!path.startsWith('/')) path = `/${path}`
    if (!path.endsWith('/')) path += '/'
    return path.replace(/\/{2,}/g, '/')
  }

  const entries = Array.isArray(privacy.entries) ? privacy.entries : []
  const sectionMap = new Map(entries.map(e => [normalizePath(e.path), e.section || '内部']))
  const publicPaths = new Set((privacy.publicPaths || ['/']).map(normalizePath))

  // 404 页不锁 —— 锁一个「页面不存在」没有意义，而且会把打错字的自己也挡在外面
  const isPublic = path => publicPaths.has(path) || path === '/404/'
  const isLocked = path => !isPublic(path)

  const sectionOf = path => sectionMap.get(path) || (
    path.includes('/in-class/') ? '课内'
      : path.includes('/extra/') ? '课外'
      : path.includes('/life/') ? 'Life'
      : path.includes('/news/') ? '资讯'
      : path.includes('/schedule/') ? '日程'
      : '内部'
  )

  const unlocked = () => {
    try { return window.sessionStorage.getItem(SESSION_FLAG) === 'true' } catch (_) { return false }
  }

  const remember = pass => {
    try {
      window.sessionStorage.setItem(SESSION_FLAG, 'true')
      window.sessionStorage.setItem(SESSION_PASS, pass)
    } catch (_) {}
  }

  /* 万一有哪个模板还是把文章卡片渲染出来了（主题升级、改配置都可能），
   * 这里在未解锁时把它们从 DOM 里摘掉。
   * 注意：这只是补丁，真正的防线在构建侧 —— 侧边栏那几张卡片已经从源头关掉了。 */
  const scrubLeaks = () => {
    if (unlocked()) return
    document.querySelectorAll('a[href]').forEach(anchor => {
      let targetPath
      try { targetPath = normalizePath(new URL(anchor.href, window.location.origin).pathname) } catch (_) { return }
      if (!isLocked(targetPath)) return
      const item = anchor.closest(
        '.recent-post-item, .article-sort-item, .aside-list-item, .card-archive-list-item, ' +
        '.card-category-list-item, .noimpty-post-card, .relatedPosts-list > div'
      )
      if (item) item.remove()
    })
  }

  const digest = async value => {
    const bytes = new TextEncoder().encode(value)
    const result = await window.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('')
  }

  const mountGate = () => {
    document.querySelector('.noimpty-gate')?.remove()
    scrubLeaks()

    const currentPath = normalizePath(window.location.pathname)

    if (!isLocked(currentPath) || unlocked()) {
      document.documentElement.classList.remove('noimpty-private-locked')
      return
    }

    const currentSection = sectionOf(currentPath)
    document.documentElement.classList.add('noimpty-private-locked')

    const gate = document.createElement('div')
    gate.className = 'noimpty-gate'
    gate.dataset.section = String(currentSection).toLowerCase()
    gate.innerHTML = `
      <div class="noimpty-gate__panel" role="dialog" aria-modal="true" aria-labelledby="noimpty-gate-title">
        <p class="noimpty-gate__eyebrow">Private · ${currentSection}</p>
        <h1 id="noimpty-gate-title">请输入暗号(*^▽^*)</h1>
        <p class="noimpty-gate__hint">这里是私人记录。输入正确后，本次浏览期间整站都可以访问。</p>
        <form class="noimpty-gate__form" novalidate>
          <input class="noimpty-gate__input" type="password" name="passphrase" autocomplete="current-password" aria-label="暗号" placeholder="在这里输入暗号" required>
          <button class="noimpty-gate__button" type="submit">确认暗号</button>
          <p class="noimpty-gate__error" role="status" aria-live="polite"></p>
        </form>
        <a class="noimpty-gate__back" href="/">← 返回首页</a>
      </div>`

    document.body.appendChild(gate)
    const panel = gate.querySelector('.noimpty-gate__panel')
    const form = gate.querySelector('.noimpty-gate__form')
    const input = gate.querySelector('.noimpty-gate__input')
    const button = gate.querySelector('.noimpty-gate__button')
    const error = gate.querySelector('.noimpty-gate__error')
    input.focus()

    form.addEventListener('submit', async event => {
      event.preventDefault()
      button.disabled = true
      error.textContent = ''

      try {
        const pass = input.value.trim()
        if (await digest(pass) === expectedHash) {
          remember(pass)
          gate.classList.add('is-leaving')
          document.documentElement.classList.remove('noimpty-private-locked')
          window.setTimeout(() => gate.remove(), 300)
          // 解锁之后把刚才为了保险摘掉的东西补回来。重载最省事，也最不容易出错。
          window.setTimeout(() => window.location.reload(), 320)
          return
        }

        error.textContent = '输入错误┭┮﹏┭┮'
        panel.classList.remove('is-error')
        void panel.offsetWidth
        panel.classList.add('is-error')
        input.select()
      } catch (_) {
        error.textContent = '暂时无法校验，请刷新页面后重试。'
      } finally {
        button.disabled = false
      }
    })
  }

  // 点击站内链接时先把遮罩打上，避免 pjax 换页那一瞬间闪出内容
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href]')
    if (!anchor || unlocked()) return
    let targetPath
    try { targetPath = normalizePath(new URL(anchor.href, window.location.origin).pathname) } catch (_) { return }
    if (isLocked(targetPath)) document.documentElement.classList.add('noimpty-private-locked')
  })

  // 这一句必须在最早执行：DOM 还没构建完就先把遮罩类打上，
  // 否则慢网络下会先闪一眼正文再被盖住。
  if (isLocked(normalizePath(window.location.pathname)) && !unlocked()) {
    document.documentElement.classList.add('noimpty-private-locked')
  }

  // 给别的脚本用（noimpty-search.js 要拿暗号去解密 search.xml）
  window.NOIMPTY_GATE = Object.freeze({
    unlocked,
    passphrase: () => {
      try { return window.sessionStorage.getItem(SESSION_PASS) || '' } catch (_) { return '' }
    }
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountGate, { once: true })
  } else {
    mountGate()
  }

  window.addEventListener('pjax:complete', () => window.setTimeout(mountGate, 0))
})()
