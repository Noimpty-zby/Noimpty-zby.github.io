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

const field = (raw, key) => {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) return ''
  const m = fm[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

const buildList = () => {
  let dirs = []
  try {
    dirs = fs.readdirSync(NEWS_DIR)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .filter(d => fs.existsSync(path.join(NEWS_DIR, d, 'index.md')))
      .sort().reverse()
  } catch (_) {
    return '（还没有内容，等第一期生成）'
  }
  if (!dirs.length) return '（还没有内容，等第一期生成）'

  return dirs.map(d => {
    let desc = ''
    try { desc = field(fs.readFileSync(path.join(NEWS_DIR, d, 'index.md'), 'utf8'), 'description') } catch (_) {}
    return `- [**资讯速览 · ${d}**](/news/${d}/)${desc ? `\n  ${desc}` : ''}`
  }).join('\n')
}

let filled = 0

// before_post_render 在 markdown 还没被渲染成 HTML 之前触发，
// 所以这里塞进去的 markdown 列表会被正常渲染成带链接的 <ul>。
hexo.extend.filter.register('before_post_render', data => {
  if (typeof data.content !== 'string' || data.content.indexOf(MARK) === -1) return data
  data.content = data.content.replace(MARK, buildList())
  filled++
  return data
})

hexo.extend.filter.register('before_exit', () => {
  if (filled) {
    let n = 0
    try {
      n = fs.readdirSync(NEWS_DIR)
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(NEWS_DIR, d, 'index.md'))).length
    } catch (_) {}
    hexo.log.info(`资讯列表：${n} 期`)
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
