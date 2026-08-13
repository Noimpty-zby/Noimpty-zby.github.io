/* GoatCounter 埋点 + 「这是主人的浏览器」识别
 *
 * 为什么不用主题自带的统计开关：
 * 我们要区分两种访问 —— 别人来看文章（算进浏览量），和 Noimpty 自己来逛（不算进浏览量，
 * 但要留一个心跳，好让每晚的日报知道他多久没来了）。主题的开关做不到这个区分。
 *
 * 怎么认出主人的浏览器（满足任一条即可）：
 *   1. 这台浏览器里有娜娜莉的密钥保险箱 —— 除了主人不会有别人配
 *   2. 手动开过 你的网址/#im-noimpty
 * 认定为主人后，这次访问只发一条 owner-heartbeat 事件，不发正常的页面浏览。
 *
 * 站点代号在 _config.butterfly.yml 的 inject.head 里配置，留空则整个脚本不工作。
 */
(() => {
  'use strict'

  const CODE = String(window.NOIMPTY_GC_CODE || '').trim()
  if (!CODE) return

  const OWNER_KEY = 'noimpty-owner'
  const VAULT_KEY = 'nanaly-vault-v1'
  const HEARTBEAT = '/owner-heartbeat'

  const ls = {
    get (k) { try { return localStorage.getItem(k) } catch (_) { return null } },
    set (k, v) { try { localStorage.setItem(k, v) } catch (_) {} },
    del (k) { try { localStorage.removeItem(k) } catch (_) {} }
  }

  // 手动开关：访问 /#im-noimpty 切换（手机上也能用，不需要控制台）
  if (location.hash === '#im-noimpty') {
    const on = ls.get(OWNER_KEY) === '1'
    if (on) { ls.del(OWNER_KEY); alert('已取消「这是我的浏览器」。\n从现在起这台设备的访问会计入统计。') }
    else { ls.set(OWNER_KEY, '1'); alert('已标记为「这是我的浏览器」。\n从现在起你的阅读不再计入文章浏览量，\n只会留一条心跳给娜娜莉，让她知道你来过。') }
    history.replaceState(null, '', location.pathname + location.search)
  }

  const isOwner = () => ls.get(OWNER_KEY) === '1' || !!ls.get(VAULT_KEY)

  // 不让它自动上报，我们自己决定每次上报什么
  window.goatcounter = window.goatcounter || {}
  window.goatcounter.no_onload = true
  window.goatcounter.no_events = true

  let lastBeat = 0
  const report = () => {
    const gc = window.goatcounter
    if (!gc || typeof gc.count !== 'function') return
    if (isOwner()) {
      // 一小时内只留一条心跳，别把自己刷成一堆事件
      const now = Date.now()
      if (now - lastBeat < 3600 * 1000) return
      lastBeat = now
      gc.count({ path: HEARTBEAT, title: '主人来过', event: true })
      return
    }
    gc.count({ path: location.pathname + location.search, title: document.title })
  }

  const el = document.createElement('script')
  el.async = true
  el.src = 'https://gc.zgo.at/count.js'
  el.setAttribute('data-goatcounter', `https://${CODE}.goatcounter.com/count`)
  el.addEventListener('load', report)
  document.head.appendChild(el)

  // pjax 切页面不会重新执行本脚本，得自己补一次
  window.addEventListener('pjax:complete', () => setTimeout(report, 120))

  // 供控制台查看/切换
  window.NOIMPTY_ANALYTICS = Object.freeze({
    isOwner,
    markOwner: () => { ls.set(OWNER_KEY, '1'); return '这台浏览器的访问不再计入统计' },
    unmarkOwner: () => { ls.del(OWNER_KEY); return '这台浏览器的访问会计入统计' }
  })
})()
