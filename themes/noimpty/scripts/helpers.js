'use strict'

/**
 * 主题模板用的小工具。系列、板块的配置在 _config.noimpty.yml（series / hubs），
 * 这里负责把文章、页面对上去：属于哪个系列、这个系列有几篇、换页时的角色卡用什么颜色和代号。
 */

const toArray = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (typeof collection.toArray === 'function') return collection.toArray()
  if (Array.isArray(collection.data)) return collection.data
  return []
}

const names = collection => toArray(collection).map(item => String(item && item.name != null ? item.name : item))

const webPath = value => {
  let path = '/' + String(value || '').replace(/^\/+/, '')
  path = path.replace(/index\.html$/, '').replace(/\.html$/, '/')
  return path.endsWith('/') ? path : path + '/'
}

const seriesTable = () => hexo.theme.config.series || {}
const hubTable = () => hexo.theme.config.hubs || {}

const seriesInfo = key => {
  const info = seriesTable()[key]
  return info ? { key, ...info } : null
}

// 文章属于哪个系列：分类里第一个在 series 表里有登记的叶子
const seriesOfPost = post => {
  const table = seriesTable()
  const key = names(post && post.categories).find(name => table[name])
  return key ? seriesInfo(key) : null
}

const postsOf = key => toArray(hexo.locals.get('posts'))
  .filter(post => names(post.categories).includes(key))
  .sort((a, b) => Number(a.date || 0) - Number(b.date || 0))

// 对外公开的只有课内、课外两块（life 和娜娜莉的周报不算）
const isPublicPost = post => {
  const cats = names(post.categories)
  return cats.includes('课内') || cats.includes('课外')
}

hexo.extend.helper.register('nm_series', key => seriesInfo(key))
hexo.extend.helper.register('nm_series_of', post => seriesOfPost(post))
hexo.extend.helper.register('nm_posts_of', key => postsOf(key))
hexo.extend.helper.register('nm_web_path', value => webPath(value))

hexo.extend.helper.register('nm_is_public', post => isPublicPost(post))

hexo.extend.helper.register('nm_public_posts', () => toArray(hexo.locals.get('posts'))
  .filter(isPublicPost)
  .sort((a, b) => Number(b.date || 0) - Number(a.date || 0)))

// 首页「系列」一栏：有文章的公开系列，按最近更新排
hexo.extend.helper.register('nm_public_series', () => Object.keys(seriesTable())
  .map(key => {
    const info = seriesInfo(key)
    const posts = postsOf(key)
    return { ...info, posts, count: posts.length, latest: posts[posts.length - 1] }
  })
  .filter(item => item.count > 0 && (item.area === '课内' || item.area === '课外'))
  .sort((a, b) => Number(b.latest.date) - Number(a.latest.date)))

// 页面路径 → 系列或板块（系列页、板块页靠它认出自己是谁）
hexo.extend.helper.register('nm_place_of', page => {
  if (page && page.track && seriesTable()[page.track]) return { kind: 'series', ...seriesInfo(page.track) }
  const path = webPath(page && page.path)
  const hub = hubTable()[path]
  if (hub) return { kind: 'hub', path, ...hub }
  const key = Object.keys(seriesTable()).find(name => seriesTable()[name].path === path)
  return key ? { kind: 'series', ...seriesInfo(key) } : null
})

// 面包屑：当前路径上面每一级登记过的板块
hexo.extend.helper.register('nm_crumbs', path => {
  const parts = webPath(path).split('/').filter(Boolean)
  const out = []
  for (let i = 1; i < parts.length; i++) {
    const p = '/' + parts.slice(0, i).join('/') + '/'
    if (hubTable()[p]) out.push(p)
  }
  return out
})

hexo.extend.helper.register('nm_hub_children', path => {
  const hub = hubTable()[path]
  if (!hub) return []
  return toArray(hub.children).map(child => {
    if (String(child).startsWith('/')) {
      const sub = hubTable()[child]
      if (!sub) return null
      const leaves = toArray(sub.children).flatMap(c => String(c).startsWith('/') ? toArray((hubTable()[c] || {}).children) : [c])
      const posts = leaves.flatMap(postsOf).sort((a, b) => Number(a.date || 0) - Number(b.date || 0))
      return { kind: 'hub', path: child, ...sub, count: posts.length, latest: posts[posts.length - 1], parts: toArray(sub.children).length }
    }
    const info = seriesInfo(child)
    if (!info) return null
    const posts = postsOf(child)
    return { kind: 'series', ...info, count: posts.length, latest: posts[posts.length - 1] }
  }).filter(Boolean)
})

// 换页时角色卡要用的颜色、代号、标题，写在链接的 data-* 上
hexo.extend.helper.register('nm_tx', function (info, title) {
  if (!info) return ''
  const esc = this.escape_html
  const attrs = [`data-sc="${esc(info.color || '')}"`, `data-code="${esc(info.code || '')}"`]
  if (title || info.name) attrs.push(`data-title="${esc(title || info.name)}"`)
  return ' ' + attrs.join(' ')
})

// 页头那一行导语：description 往往是一整段摘要，只取开头一两句
hexo.extend.helper.register('nm_lead', (text, limit = 110) => {
  const s = String(text || '').trim()
  if (s.length <= limit) return s
  const stops = [...s.matchAll(/[。！？]/g)].map(m => m.index + 1).filter(i => i >= 24)
  const cut = stops.filter(i => i <= limit).pop()
  return cut ? s.slice(0, cut) : s.slice(0, limit - 1) + '…'
})

// 顶栏哪一项是「当前」：文章按分类算到课内 / 课外
hexo.extend.helper.register('nm_nav_current', function (itemPath, page, isHome) {
  const target = webPath(itemPath)
  if (target === '/') return !!isHome
  const here = webPath(page && page.path)
  if (here.startsWith(target)) return true
  const cats = names(page && page.categories)
  if (target === '/in-class/' && cats.includes('课内')) return true
  if (target === '/extra/' && cats.includes('课外')) return true
  if (target === '/archives/' && /^\/(archives|categories|tags)\//.test(here)) return true
  return false
})

// 页面的大类，决定外层布局
hexo.extend.helper.register('nm_kind', function (page, isHome) {
  if (isHome || page.__index) return 'home'
  if (page.__post || page.layout === 'post') return 'post'
  if (page.archive || page.category || page.tag) return 'list'
  const type = String(page.type || '')
  if (type === 'noimpty-hub' || type === 'noimpty-track') return 'place'
  if (['schedule', 'review', 'learning', 'news-index', 'categories', 'tags'].includes(type)) return 'app'
  return 'page'
})

hexo.extend.helper.register('nm_count_words', content => {
  const text = String(content || '')
    .replace(/<figure class="highlight[\s\S]*?<\/figure>/g, '')
    .replace(/<[^>]+>/g, '')
  const cjk = (text.match(/[一-鿿]/g) || []).length
  const latin = (text.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
  return cjk + latin
})

// 本地预览开放后的首页：NOIMPTY_HOME_LISTS=1 npm run build（配置里的 home.lists 在开放之前一直是 false）
hexo.extend.filter.register('before_generate', () => {
  if (process.env.NOIMPTY_HOME_LISTS === '1') hexo.theme.config.home = { ...hexo.theme.config.home, lists: true }
})
