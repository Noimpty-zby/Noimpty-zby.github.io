'use strict'

/**
 * 复习卡的数据（/review/ 页面里的 {% review_cards %}）。
 *
 * 卡片写在 source/_data/review-cards.yml，按系列分组，每张卡就是一个知识点。
 * 只收课内和课外 AI Infra 两块的文章，别的板块（比如游戏开发）的卡构建时直接报错。
 * 复习页每天从这些知识点里挑 5 个，题目由娜娜莉按卡片现场换问法，见 source/js/review.js。
 *
 * 数据直接嵌在复习页的 HTML 里，不单独生成 JSON 文件。复习页和文章一样受软锁保护，
 * 不会多出一个「一个 GET 就能拿到全部内容」的口子（见 noimpty-lockdown.js 开头的说明）。
 *
 * 每张卡的 id 由「文章 + 正面文字」算出来，正面改了字就算一张新卡，复习进度从头来。
 * 复习进度只存在浏览器本地，见 source/js/review.js。
 */

const crypto = require('crypto')

// 新写一个系列的卡（比如 CSAPP、Python）时，在这里加一行，id 和 review-cards.yml 里的键一致。
const SERIES = [
  { id: 'dsa', name: 'DSA', match: /^DSA-/ },
  { id: 'linux', name: 'Linux', match: /^Linux-/ },
  { id: 'git', name: 'Git', match: /^Git-/ }
]

// 卡片文字只认三种写法：`代码`、**加粗**、换行。先整体转义，再把这三种换回标签。
// 不用 hexo-util 的 escapeHTML：它连反引号也转义，后面就认不出 `代码` 了。
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const inline = text => escape(String(text == null ? '' : text).trim())
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\n/g, '<br>')

const cardId = (slug, front) => crypto.createHash('sha1').update(slug + '\n' + front).digest('hex').slice(0, 12)

// 文章属于课内还是课外的 AI Infra，看 front-matter 的 categories。
const inScope = post => post.categories.toArray().some(category => category.name === '课内' || category.name === 'AI Infra')

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
  for (const key of Object.keys(written)) {
    if (!SERIES.some(series => series.id === key)) throw new Error(`review_cards: review-cards.yml 里的 ${key} 不在 SERIES 里`)
  }
  for (const series of SERIES) {
    for (const entry of written[series.id] || []) {
      const post = bySlug.get(entry.post)
      if (!post) throw new Error(`review_cards: review-cards.yml 里写的文章 ${entry.post} 不存在`)
      if (!series.match.test(post.slug)) throw new Error(`review_cards: ${entry.post} 不属于 ${series.name} 系列`)
      if (!inScope(post)) throw new Error(`review_cards: ${entry.post} 不在课内或 AI Infra 板块里`)
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
