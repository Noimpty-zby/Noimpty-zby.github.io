'use strict'

/**
 * /news/ 列表页的期数清单，构建时现扫现生成。
 *
 * 为什么不让娜娜莉写好再提交：
 *
 * 她生成一期资讯之后，要（1）写 source/news/<日期>/index.md，
 * （2）重写 source/news/index.md 这个列表页，（3）两个一起提交。
 * 只要这三步里任何一环没走到，就会出现「内容页在线上、列表页却说『还没有内容』」
 * 这种自相矛盾的状态 —— 而且你从列表页根本点不进去，等于白生成了。
 * 这类错法太多了：她挂了、推送被拒、你本地 robocopy 覆盖回旧版本、
 * 或者你手工删了一期忘了改列表。
 *
 * 所以干脆让列表页别再是一份需要维护的数据：
 * source/news/index.md 里放一个 <!-- NEWS_LIST --> 占位符，
 * 每次 hexo generate 的时候由这里照着 source/news/ 底下真实存在的目录填进去。
 * 目录在，列表里就有；目录没了，列表里自动消失。不可能对不上。
 */

const fs = require('fs')
const path = require('path')

const NEWS_DIR = path.join(hexo.source_dir, 'news')
const MARK = '<!-- NEWS_LIST -->'
// 页头上那句「共 N 期」，和列表同一次扫描出来，不会对不上
const COUNT_MARK = '<!-- NEWS_COUNT -->'

const field = (raw, key) => {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) return ''
  const m = fm[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

const listDirs = () => {
  try {
    return fs.readdirSync(NEWS_DIR)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .filter(d => fs.existsSync(path.join(NEWS_DIR, d, 'index.md')))
      .sort().reverse()
  } catch (_) {
    return []
  }
}

/* 方向是 2026-08-26 换的（游戏客户端 → AI Infra），但搜索用的选题表 09-05 才跟上，
 * 所以 09-04 及更早的每一期搜的都还是 UE5、引擎和游戏（按内容核对过）。
 * 旧期数留着没删，在列表里调暗、挂一个「旧方向」，不用再写一段话解释。 */
const PIVOT = '2026-09-05'
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const escapeHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// 「娜娜莉整理的三日资讯：A、B、C。」→ [A, B, C]
const topicsOf = desc => {
  const tail = String(desc || '').split(/[:：]/).slice(1).join('：').replace(/[。.\s]+$/, '')
  return tail ? tail.split(/[、，,]/).map(t => t.trim()).filter(Boolean) : []
}

/* 整块输出成一段不带空行的 HTML：markdown 渲染器遇到 HTML 块会原样放过，
 * 但块里只要出现空行，后半截就会被当成 markdown 重新解析。 */
const buildList = () => {
  const dirs = listDirs()
  if (!dirs.length) return '<p class="noimpty-news-empty">还没有内容，等第一期生成。</p>'

  const months = new Map()
  for (const d of dirs) {
    const key = d.slice(0, 7)
    if (!months.has(key)) months.set(key, [])
    months.get(key).push(d)
  }

  const row = (d, latest) => {
    let desc = ''
    try { desc = field(fs.readFileSync(path.join(NEWS_DIR, d, 'index.md'), 'utf8'), 'description') } catch (_) {}
    const [y, m, day] = d.split('-').map(Number)
    const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]
    const legacy = d < PIVOT
    const cls = ['noimpty-issue', latest && 'is-latest', legacy && 'is-legacy'].filter(Boolean).join(' ')
    const tags = topicsOf(desc).map(t => `<i>${escapeHtml(t)}</i>`).join('')
    const flag = latest ? '<em class="noimpty-issue__flag">最新</em>' : legacy ? '<em class="noimpty-issue__flag">旧方向</em>' : ''
    return `<a class="${cls}" href="/news/${d}/" aria-label="资讯速览 ${d}">` +
      `<span class="noimpty-issue__date"><b>${String(day).padStart(2, '0')}</b><small>${weekday}</small></span>` +
      `<span class="noimpty-issue__body">${flag}<span class="noimpty-issue__topics">${tags}</span></span>` +
      '<span class="noimpty-issue__go" aria-hidden="true">→</span></a>'
  }

  let first = true
  return '<div class="noimpty-news">' + [...months].map(([key, list]) => {
    const [y, m] = key.split('-')
    const rows = list.map(d => { const r = row(d, first); first = false; return r }).join('')
    return `<section class="noimpty-news__month"><h2 class="noimpty-news__label"><b>${Number(m)} 月</b><small>${y}</small></h2>` +
      `<div class="noimpty-news__rows">${rows}</div></section>`
  }).join('') + '</div>'
}

let filled = 0

// before_post_render 在 markdown 还没被渲染成 HTML 之前触发。
// 塞进去的是一整段不带空行的 HTML，markdown 渲染器会原样放过。
hexo.extend.filter.register('before_post_render', data => {
  if (typeof data.content !== 'string' || data.content.indexOf(MARK) === -1) return data
  data.content = data.content
    .replace(MARK, buildList())
    .replace(COUNT_MARK, String(listDirs().length))
  filled++
  return data
})

hexo.extend.filter.register('before_exit', () => {
  if (filled) {
    hexo.log.info(`资讯列表：${listDirs().length} 期`)
  }
})

/* 保险：page 上不该出现 layout: post。
 *
 * Butterfly 的文章头部模板会读 page.categories.data —— Hexo 的 page 上没有这个字段，
 * 直接抛 TypeError。而 hexo generate 照常退出 0，只是把那个页面写成 0 字节的
 * index.html：工作流全绿、文件也在仓库里，点进去一片空白。
 *
 * 生成器那边已经不写这一行了，但仓库里可能还留着旧的（我就漏改过一次）。
 * 与其指望每个文件都记得改，不如在构建时兜住：page 的 layout 一律拨回 page。
 */
hexo.extend.filter.register('before_post_render', data => {
  if (data.layout === 'post' && !data.published && data.source && !data.source.startsWith('_posts/')) {
    hexo.log.warn(`${data.source} 是 page 却写了 layout: post，已自动改回 page（否则会渲染成 0 字节）`)
    data.layout = 'page'
  }
  return data
})
