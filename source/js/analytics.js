/* GoatCounter 埋点 + 「这是主人的浏览器」识别
 *
 * 为什么不用主题自带的统计开关：
 * 我们要区分两种访问 —— 别人来看文章（算进浏览量），和 Noimpty 自己来逛（不算进浏览量，
 * 但要留一个心跳，好让每晚的日报知道他多久没来了）。主题的开关做不到这个区分。
 *
 * 怎么认出主人的浏览器：只看 `noimpty-owner` 这个标记。
 *   - 手动开：访问 你的网址/#im-noimpty
 *   - 自动开：在这台浏览器上成功解锁了保险箱、并且里面存着 GitHub token
 *     （能写这个仓库的 token 只有主人有，读者不可能有）
 *
 * 曾经还认「有没有保险箱」，那是错的：面板本来就邀请每一位访客用自己的
 * API Key 配一个。读者配了之后，他的阅读就再也不计入统计（真实浏览量被少算），
 * 反而开始往「主人心跳」里灌数据，让日报告诉主人他今天来过 —— 而他没来。
 *
 * 认定为主人后，这次访问只发一条 owner-heartbeat 事件，不发正常的页面浏览。
 *
 * 站点代号在 _config.butterfly.yml 的 inject.head 里配置，留空则整个脚本不工作。
 */
(() => {
  'use strict'

  const CODE = String(window.NOIMPTY_GC_CODE || '').trim()
  if (!CODE) return

  const OWNER_KEY = 'noimpty-owner'
  const BEAT_AT = 'noimpty-last-beat'
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

  const isOwner = () => ls.get(OWNER_KEY) === '1'

  // 不让它自动上报，我们自己决定每次上报什么
  window.goatcounter = window.goatcounter || {}
  window.goatcounter.no_onload = true
  window.goatcounter.no_events = true

  // 节流时间戳必须落盘。放在内存里的话，「一小时一条」只在单个标签页里成立 ——
  // 从书签开五个标签就是五条心跳，正是这里想避免的事。
  const report = () => {
    const gc = window.goatcounter
    if (!gc || typeof gc.count !== 'function') return
    if (isOwner()) {
      const now = Date.now()
      const last = Number(ls.get(BEAT_AT) || 0)
      if (now - last < 3600 * 1000) return
      ls.set(BEAT_AT, String(now))
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
    unmarkOwner: () => { ls.del(OWNER_KEY); ls.del(BEAT_AT); return '这台浏览器的访问会计入统计' }
  })
})()
