'use strict'

/**
 * 学习时间线（/timeline/ 页面里的 {% study_timeline %}，见 scripts/noimpty-timeline.js）。
 *
 * 只收带 `series` 的学习文章，按发布日期从新到旧排：每个月一段，同一天的文章合成一项。
 * 生成的结构和 Butterfly 自带的 {% timeline %} 标签一样（.timeline / .timeline-item），
 * 直接用主题的时间线样式；系列标签的颜色在 source/css/study-timeline.css。
 *
 * 输入是普通对象，方便单独测试：
 *   [{ title, date: 'YYYY-MM-DD', series, url }]
 */

const escape = text => String(text == null ? '' : text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const day = date => {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d }
}

const render = posts => {
  const list = posts.filter(post => post.series && /^\d{4}-\d{2}-\d{2}$/.test(post.date))
    .slice().sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
  if (!list.length) return '<p class="study-timeline__empty">还没有学习笔记。</p>'

  // 系列按第一篇出现的先后编号，颜色跟着编号走，新系列不会把老系列的颜色挤掉。
  const firstSeen = new Map()
  for (const post of list.slice().reverse()) if (!firstSeen.has(post.series)) firstSeen.set(post.series, firstSeen.size)
  const counts = new Map()
  for (const post of list) counts.set(post.series, (counts.get(post.series) || 0) + 1)

  const first = day(list.at(-1).date)
  const summary = `<p class="study-timeline__summary">从 ${first.y} 年 ${first.m} 月 ${first.d} 日写下第一篇学习笔记到现在，一共 ${list.length} 篇，分成 ${firstSeen.size} 个系列：` +
    [...firstSeen.keys()].map(series => `${escape(series)} ${counts.get(series)} 篇`).join('、') + '。</p>'

  const months = new Map()
  for (const post of list) {
    const key = post.date.slice(0, 7)
    if (!months.has(key)) months.set(key, new Map())
    const days = months.get(key)
    if (!days.has(post.date)) days.set(post.date, [])
    days.get(post.date).push(post)
  }

  const blocks = [...months].map(([key, days]) => {
    const { y, m } = day(key + '-01')
    const total = [...days.values()].reduce((sum, items) => sum + items.length, 0)
    const headline = `<div class="timeline-item headline"><div class="timeline-item-title"><div class="item-circle"><p>${y} 年 ${m} 月 · ${total} 篇</p></div></div></div>`
    const items = [...days].map(([date, items]) => {
      const { m: month, d } = day(date)
      const rows = items.map(post =>
        `<li><span class="study-timeline__series" data-tone="${firstSeen.get(post.series) % 6}">${escape(post.series)}</span><a href="${escape(post.url)}">${escape(post.title)}</a></li>`).join('')
      return `<div class="timeline-item"><div class="timeline-item-title"><div class="item-circle"><p><time datetime="${date}">${month} 月 ${d} 日</time></p></div></div>` +
        `<div class="timeline-item-content"><ul class="study-timeline__posts">${rows}</ul></div></div>`
    }).join('')
    return `<div class="timeline study-timeline">${headline}${items}</div>`
  })

  return `<div class="study-timeline-page">${summary}${blocks.join('')}</div>`
}

module.exports = { render }
