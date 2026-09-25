/* 首页 hero 上的时间牌：当下的年月日时分秒，以及这个小站活了多久。
 *
 * 两处容易翻车，都在这里挡掉了：
 *
 * 1. **月份借位**。「已经三个月零几天」不能拿毫秒除以 30 天 —— 月份长短不一，
 *    除出来的数字会慢慢和日历对不上。也不能简单地逐位相减再借位：
 *    1 月 31 日到 3 月 1 日，借一个二月（28 天）之后天数仍然是负的。
 *    这里改成先数「整月能推几次而不超过现在」，余下的部分才按真实毫秒差拆，
 *    推月份时把日号夹到当月最后一天（1 月 31 日 + 1 月 = 2 月 28 日）。
 *
 * 2. **秒针跳动时数字左右抖**。等宽数字（tabular-nums）在 CSS 里开，
 *    这里只负责不要每次都重写整块 DOM —— 只改变化的那几个文本节点。
 *
 * 时间一律按访客本机时区显示。主人自己就在东八区，看到的就是北京时间；
 * 别的时区打开，读到的是「在他那儿过去了多久」，同样是诚实的说法。 */
(() => {
  'use strict'
  if (window.NOIMPTY_CLOCK) return

  /* 小站的生日：第一篇文章《我的第一篇博客》的发表时刻（北京时间）。
   * 要改就改这一行，写成带时区的字面量，别写成本地时间字符串 ——
   * 那样在别的时区构建/打开会整体偏移。 */
  const BIRTH = new Date('2026-05-30T16:43:03+08:00')

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const pad = n => String(n).padStart(2, '0')

  /* 往后推 n 个整月，日号超出当月长度时夹到最后一天。
   * 不夹的话 1 月 31 日 + 1 个月会被 Date 顺延成 3 月 3 日。 */
  const addMonths = (date, n) => {
    const out = new Date(date.getTime())
    const day = out.getDate()
    out.setDate(1)
    out.setMonth(out.getMonth() + n)
    const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()
    out.setDate(Math.min(day, last))
    return out
  }

  const elapsed = (from, to) => {
    if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(+from) || Number.isNaN(+to) || to < from)
      return { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 }
    let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
    if (months < 0) months = 0
    // 推过头就退一个月。夹日号之后「推 n 个月」不一定单调，所以真的比一次。
    while (months > 0 && addMonths(from, months) > to) months--
    let rest = to - addMonths(from, months)
    const d = Math.floor(rest / 86400000); rest -= d * 86400000
    const h = Math.floor(rest / 3600000); rest -= h * 3600000
    const mi = Math.floor(rest / 60000); rest -= mi * 60000
    return { y: Math.floor(months / 12), mo: months % 12, d, h, mi, s: Math.floor(rest / 1000) }
  }

  /* 从第一个非零的单位开始念，秒永远保留。
   * 「0 年 0 月 21 天」这种读起来像报错，开头的零位一律不说。 */
  const formatAge = age => {
    const units = [[age.y, '年'], [age.mo, '个月'], [age.d, '天'], [age.h, '小时'], [age.mi, '分'], [age.s, '秒']]
    const start = units.findIndex(([n]) => n > 0)
    return units.slice(start < 0 ? units.length - 1 : start).map(([n, u]) => n + ' ' + u).join(' ')
  }

  /* 时分秒分开给：三块牌各自渲染，秒变的时候只动秒那一块，
   * 时和分不会跟着重排，也就不会整行闪。 */
  const formatNow = now => ({
    date: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`,
    week: WEEK[now.getDay()],
    hh: pad(now.getHours()), mm: pad(now.getMinutes()), ss: pad(now.getSeconds())
  })

  // 当前这一块的拆除函数。pjax 换页后要靠它收掉上一块留下的秒表和监听。
  let teardown = null

  const mount = () => {
    /* 插在大标题和副标题之间，成为 hero 那一列的第三段。
     *
     * 这一列（问候语／标题／副标题／按钮）本来就是左对齐、靠左侧摆放的，
     * 整块靠 translateY(-47%) 垂直居中 —— 所以在中间插一段，上面的标题会往上走、
     * 下面的副标题和按钮会往下走，正好是要的效果，不用各自去调 margin。
     *
     * 认 #site-info 是为了只在首页出现：文章页也有 #page-header，但那是窄横幅。 */
    const info = document.querySelector('#site-info')
    const title = info && info.querySelector('#site-title')
    if (info && title && document.getElementById('noimpty-clock')) return
    /* 走到这儿说明上一块要么没有、要么已经被 pjax 连同整个 hero 换掉了。
     * 旧的秒表和监听不会自己消失 —— 不先拆掉，每回一次首页就多积一份，
     * 它们还会对着已经脱离文档的节点每秒写一次。 */
    if (teardown) { teardown(); teardown = null }
    if (!info || !title) return

    const el = (tag, cls, text) => {
      const node = document.createElement(tag)
      if (cls) node.className = cls
      if (text) node.textContent = text
      return node
    }
    const slotted = (tag, cls, key) => {
      const node = el(tag, cls)
      node.setAttribute('data-clock', key)
      return node
    }

    const box = el('div', 'noimpty-clock')
    box.id = 'noimpty-clock'
    // 一秒一跳的东西交给读屏软件会一直打断朗读，这里只让它读一次静态说明。
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', '站点时间与运行时长')

    const day = el('div', 'noimpty-clock__day')
    day.setAttribute('aria-hidden', 'true')
    day.append(slotted('span', 'noimpty-clock__date', 'date'), slotted('span', 'noimpty-clock__week', 'week'))

    /* 两只猫耳从表盘后面探出来。形状直接取自娜娜莉那张猫脸（noimpty-ai.js 的
     * catFace），配色也共用 --cat-fur / --cat-line / --cat-ear —— 站里本来就有
     * 这套插画语言，另造一套只会显得是贴上去的。 */
    const NS = 'http://www.w3.org/2000/svg'
    const ears = document.createElementNS(NS, 'svg')
    ears.setAttribute('class', 'noimpty-clock__ears')
    ears.setAttribute('viewBox', '7 5 50 26')
    ears.setAttribute('aria-hidden', 'true')
    for (const [cls, d] of [
      ['noimpty-clock__ear', 'M11 30 9 8Q9 4 13 7L28 20Z'],
      ['noimpty-clock__ear', 'M36 20 51 7Q55 4 55 8L53 30Z'],
      ['noimpty-clock__ear-in', 'm14 23-1-11 10 9Z'],
      ['noimpty-clock__ear-in', 'm41 21 10-9-1 11Z']
    ]) {
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('class', cls)
      path.setAttribute('d', d)
      ears.append(path)
    }

    const dial = el('time', 'noimpty-clock__dial')
    dial.setAttribute('aria-hidden', 'true')
    const tile = key => {
      const wrap = el('span', 'noimpty-clock__tile')
      wrap.append(slotted('b', '', key))
      return wrap
    }
    dial.append(tile('hh'), el('i', 'noimpty-clock__sep', ':'), tile('mm'),
      el('i', 'noimpty-clock__sep', ':'), tile('ss'))

    const ageRow = el('div', 'noimpty-clock__age')
    ageRow.setAttribute('aria-hidden', 'true')
    const petal = el('span', 'noimpty-clock__petal', '\u{1F338}')
    ageRow.append(petal, el('span', 'noimpty-clock__label', '小站已经陪你走过'),
      slotted('span', 'noimpty-clock__span', 'age'))

    // 耳朵和表盘要叠在一起，包一层好定位
    const head = el('div', 'noimpty-clock__head')
    head.append(ears, dial)
    box.append(head, day, ageRow)
    /* 认准标题往后插，不跟 section-hub 抢顺序。
     * 它也在 DOMContentLoaded 里搭这块 hero：它先跑，副标题已经在了，插在标题后面
     * 仍然落在副标题之前；我先跑，它随后 append 副标题和按钮，顺序照样对。 */
    if (typeof title.after === 'function') title.after(box)
    else info.append(box)

    const slot = {}
    box.querySelectorAll('[data-clock]').forEach(node => { slot[node.getAttribute('data-clock')] = node })

    let timer = null
    const paint = () => {
      const now = new Date()
      const parts = formatNow(now)
      // 只写变了的那块。秒每秒都变，时和分一小时/一分钟才动一次。
      for (const key of ['date', 'week', 'hh', 'mm', 'ss'])
        if (slot[key].textContent !== parts[key]) slot[key].textContent = parts[key]
      slot.age.textContent = formatAge(elapsed(BIRTH, now))
      dial.setAttribute('datetime', now.toISOString())
    }
    /* 对齐到整秒再跳，不然秒数会在两秒之间来回抖。
     * 页面藏起来时停表：后台标签页没人看，没必要每秒唤醒一次。 */
    const tick = () => {
      paint()
      timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    }
    const stop = () => { if (timer) { clearTimeout(timer); timer = null } }
    const start = () => { if (!timer && !document.hidden) tick() }

    const onVisible = () => { document.hidden ? stop() : start() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', stop)
    window.addEventListener('pageshow', start)
    teardown = () => {
      stop()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', stop)
      window.removeEventListener('pageshow', start)
    }
    start()
    box.dataset.ready = '1'
  }

  window.NOIMPTY_CLOCK = Object.freeze({ BIRTH, addMonths, elapsed, formatAge, formatNow, mount })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
  // 主题用 pjax 切页时 hero 会重建，重新挂一次。
  document.addEventListener('pjax:complete', mount)
})()
