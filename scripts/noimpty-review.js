'use strict'

/**
 * 复习卡的数据（/review/ 页面里的 {% review_cards %}）。
 *
 * 卡片有两个来源：
 *   1. UE5 系列文章里现成的「术语表」和「易错点速查表」，构建时直接从表格里抽出来；
 *   2. source/_data/review-cards.yml，DSA、Linux、Git 这些没有术语表的系列按文章内容写的问答。
 *
 * 数据直接嵌在复习页的 HTML 里，不单独生成 JSON 文件。复习页和文章一样受软锁保护，
 * 不会多出一个「一个 GET 就能拿到全部内容」的口子（见 noimpty-lockdown.js 开头的说明）。
 *
 * 每张卡的 id 由「文章 + 正面文字」算出来，正面改了字就算一张新卡，复习进度从头来。
 * 复习进度只存在浏览器本地，见 source/js/review.js。
 */

const crypto = require('crypto')

const SERIES = [
  { id: 'dsa', name: 'DSA', match: /^DSA-/ },
  { id: 'linux', name: 'Linux', match: /^Linux-/ },
  { id: 'git', name: 'Git', match: /^Git-/ },
  { id: 'ue5', name: 'UE5', match: /^UE5-/ }
]

// 卡片文字只认三种写法：`代码`、**加粗**、换行。先整体转义，再把这三种换回标签。
// 不用 hexo-util 的 escapeHTML：它连反引号也转义，后面就认不出 `代码` 了。
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const inline = text => escape(String(text == null ? '' : text).trim())
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\n/g, '<br>')

// 表格单元格按没转义的 | 切开；`\|` 是单元格里的竖线。
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
const unwrapBold = text => text.replace(/^\*\*(.+)\*\*$/, '$1')

// 找到某个标题下面的第一张表，返回表头和数据行。
const tableAfter = (raw, heading) => {
  const lines = raw.split('\n')
  const start = lines.findIndex(line => /^#{1,4}\s/.test(line) && heading.test(line))
  if (start < 0) return null
  const rows = []
  let header = null
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4}\s/.test(line)) break
    if (!line.trim().startsWith('|')) { if (header) break; continue }
    const row = cells(line)
    if (!header) { header = row; continue }
    if (row.every(cell => /^:?-{3,}:?$/.test(cell))) continue
    rows.push(row)
  }
  return header ? { header, rows } : null
}

const cardId = (slug, front) => crypto.createHash('sha1').update(slug + '\n' + front).digest('hex').slice(0, 12)

const fromTables = post => {
  const cards = []
  const glossary = tableAfter(post.raw, /术语表/)
  if (glossary) for (const [term, meaning] of glossary.rows) {
    if (!term || !meaning) continue
    cards.push({ kind: '术语', front: unwrapBold(term), back: meaning })
  }
  const pitfalls = tableAfter(post.raw, /易错点速查表/)
  if (pitfalls && /症状/.test(pitfalls.header[0])) for (const [symptom, cause, where] of pitfalls.rows) {
    if (!symptom || !cause) continue
    cards.push({ kind: '排错', front: symptom, hint: '最可能是什么原因？', back: cause + (where ? `\n检查位置：${where}` : '') })
  }
  return cards
}

hexo.extend.tag.register('review_cards', () => {
  const posts = hexo.locals.get('posts').toArray()
  const bySlug = new Map(posts.map(post => [post.slug, post]))
  const written = hexo.locals.get('data')['review-cards'] || {}
  const out = []
  const add = (series, post, card) => {
    const front = String(card.front || card.q || '').trim()
    const back = String(card.back || card.a || '').trim()
    if (!front || !back) throw new Error(`review_cards: ${post.slug} 有一张卡缺正面或背面`)
    out.push({
      id: cardId(post.slug, front), series: series.id, kind: card.kind || '问答',
      front: inline(front), hint: card.hint ? inline(card.hint) : '', back: inline(back),
      post: { title: post.title, url: hexo.config.root + post.path }
    })
  }
  for (const series of SERIES) {
    for (const post of posts.filter(item => series.match.test(item.slug)).sort((a, b) => a.date - b.date)) {
      for (const card of fromTables(post)) add(series, post, card)
    }
    for (const entry of written[series.id] || []) {
      const post = bySlug.get(entry.post)
      if (!post) throw new Error(`review_cards: review-cards.yml 里写的文章 ${entry.post} 不存在`)
      for (const card of entry.cards || []) add(series, post, card)
    }
  }
  const ids = new Set()
  for (const card of out) { if (ids.has(card.id)) throw new Error('review_cards: 两张卡重复了：' + card.front); ids.add(card.id) }
  const series = SERIES.map(({ id, name }) => ({ id, name, count: out.filter(card => card.series === id).length })).filter(item => item.count)
  // </script> 不能出现在内嵌的 JSON 里；< 一律转成 <。
  const json = JSON.stringify({ series, cards: out }).replace(/</g, '\\u003c')
  return `<script type="application/json" id="review-cards">${json}</script>`
})
