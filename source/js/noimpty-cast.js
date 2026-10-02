/* 终端录屏的播放。页面上有 {% cast %} 生成的 figure 时，才去加载 asciinema-player（约 185 KB），
 * 普通文章不会多下载任何东西。播放器的配色和代码小屋的终端一致，深色模式跟着站点切换
 * （见 noimpty-cast.css），切换时重建播放器。PJAX 换页前把旧页面上的播放器释放掉。 */
(() => {
  'use strict'
  if (window.NOIMPTY_CAST) return

  const LIB = '/lib/asciinema-player/'
  const VERSION = '3.17.0'
  const players = new Set()
  let loading = null

  const load = () => loading ||= new Promise((resolve, reject) => {
    if (window.AsciinemaPlayer) return resolve(window.AsciinemaPlayer)
    const css = document.createElement('link')
    css.rel = 'stylesheet'; css.href = `${LIB}asciinema-player.css?v=${VERSION}`
    document.head.append(css)
    const js = document.createElement('script')
    js.src = `${LIB}asciinema-player.min.js?v=${VERSION}`
    js.onload = () => window.AsciinemaPlayer ? resolve(window.AsciinemaPlayer) : reject(new Error('missing AsciinemaPlayer'))
    js.onerror = () => { loading = null; js.remove(); reject(new Error('load failed')) }
    document.head.append(js)
  })

  const mount = async () => {
    const figures = [...document.querySelectorAll('figure.noimpty-cast:not([data-mounted])')]
    if (!figures.length) return
    let Player
    try { Player = await load() } catch (_) {
      for (const figure of figures) figure.querySelector('.noimpty-cast__fallback')?.replaceChildren('录屏播放器没有加载成功，刷新页面再试一次。')
      return
    }
    for (const figure of figures) {
      if (!figure.isConnected || figure.dataset.mounted) continue
      figure.dataset.mounted = 'yes'
      const host = figure.querySelector('.noimpty-cast__player')
      host.replaceChildren()
      players.add(Player.create(figure.dataset.src, host, {
        cols: Number(figure.dataset.cols) || 80,
        rows: Number(figure.dataset.rows) || 20,
        fit: 'width',
        theme: 'noimpty',
        idleTimeLimit: 2,
        poster: `npt:${Number(figure.dataset.poster) || 0}`,
        terminalFontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', 'Microsoft YaHei', monospace"
      }))
    }
  }
  const dispose = () => {
    for (const player of players) { try { player.dispose() } catch (_) {} }
    players.clear()
  }
  // 播放器创建时把当时的主题颜色直接写进每个字符，之后切换深浅色不会跟着变，
  // 所以站点换主题时把播放器重新建一次（回到封面那一帧）。
  const rebuild = () => {
    if (!players.size) return
    dispose()
    for (const figure of document.querySelectorAll('figure.noimpty-cast[data-mounted]')) delete figure.dataset.mounted
    void mount()
  }
  if (typeof MutationObserver === 'function') new MutationObserver(rebuild).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  document.addEventListener('pjax:send', dispose)
  document.addEventListener('pjax:complete', () => { void mount() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void mount() }, { once: true })
  else void mount()

  window.NOIMPTY_CAST = Object.freeze({ mount })
})()
