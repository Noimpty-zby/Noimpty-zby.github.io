'use strict'

/**
 * 把文章底部的「上一篇 / 下一篇」限制在同一个系列（或同一个分类）之内。
 *
 * Hexo 默认按全站发表时间串联所有文章，于是会出现
 * 「UE5 第一章 → 下一篇：GAMES101 作业四」这种跨板块跳转。
 *
 * 分组规则（从严到宽）：
 *   1. 有 series 字段        → 同 series 内串联
 *   2. 没有 series           → 同分类路径内串联（如 Study/GAMES101）
 *   3. 组内只有自己          → 不显示上/下篇
 *
 * 另外：加密文章与公开文章互不串联，避免从公开文章一路点进加密内容，
 * 也避免加密文章的标题、封面出现在公开页面上。
 */

const toArray = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (typeof collection.toArray === 'function') return collection.toArray()
  if (Array.isArray(collection.data)) return collection.data
  return []
}

const isProtected = post => String(post && post.privacy || '').toLowerCase() === 'protected'

// 分组键：优先 series，其次完整分类路径
const groupKeyOf = post => {
  if (post.series) return `series:${String(post.series).trim()}`
  const cats = toArray(post.categories).map(c => String(c.name || c))
  return `category:${cats.join('/') || '未分类'}`
}

let cache = null

const buildGroups = () => {
  const groups = new Map()
  toArray(hexo.locals.get('posts')).forEach(post => {
    const key = `${groupKeyOf(post)}|${isProtected(post) ? 'private' : 'public'}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(post)
  })
  // 组内按时间升序：数组顺序 = 阅读顺序
  groups.forEach(list => list.sort((a, b) => Number(a.date || 0) - Number(b.date || 0)))
  return groups
}

hexo.extend.filter.register('before_generate', () => { cache = null })

hexo.extend.filter.register('template_locals', locals => {
  const page = locals && locals.page
  if (!page || !page.__post) return locals

  if (!cache) cache = buildGroups()

  const key = `${groupKeyOf(page)}|${isProtected(page) ? 'private' : 'public'}`
  const list = cache.get(key)
  if (!list || list.length < 2) {
    page.prev = null
    page.next = null
    return locals
  }

  const i = list.findIndex(p => p.path === page.path)
  if (i === -1) return locals

  // 与 Hexo 语义保持一致：next = 时间上更新的一篇，prev = 更旧的一篇。
  // 配合 _config.butterfly.yml 里的 post_pagination: 2，
  // 页面上「下一篇」就会指向系列的下一章，而不是更旧的文章。
  page.prev = i > 0 ? list[i - 1] : null
  page.next = i < list.length - 1 ? list[i + 1] : null

  return locals
})
