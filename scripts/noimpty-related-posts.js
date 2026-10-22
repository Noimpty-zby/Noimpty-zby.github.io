'use strict'

// 文章底部「相关文章」：按共同标签打分，越少见的标签分量越重。只在同为公开或同一私密板块的文章之间推荐。

const STRUCTURAL_TAGS = new Set(['study', 'ideas', 'life'])

const toArray = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (typeof collection.toArray === 'function') return collection.toArray()
  if (Array.isArray(collection.data)) return collection.data
  return []
}

const tagName = tag => String(tag && tag.name != null ? tag.name : tag || '').trim()
const isProtected = post => String(post && post.privacy || '').toLowerCase() === 'protected'
const privateSection = post => String(post && post.private_section || '').toLowerCase()

const canRecommend = (currentPost, candidate) => {
  if (!candidate || currentPost.path === candidate.path) return false

  const currentIsProtected = isProtected(currentPost)
  const candidateIsProtected = isProtected(candidate)

  if (!currentIsProtected) return !candidateIsProtected
  return candidateIsProtected && privateSection(currentPost) === privateSection(candidate)
}

const registerRelatedPostsHelper = () => {
  hexo.extend.helper.register('related_posts', function (currentPost) {
    const currentTags = toArray(currentPost.tags)
      .filter(tag => !STRUCTURAL_TAGS.has(tagName(tag).toLowerCase()))

    if (currentTags.length === 0) return ''

    const allPosts = toArray(hexo.locals.get('posts'))
    const visiblePool = allPosts.filter(post => canRecommend(currentPost, post))
    const relatedPosts = new Map()

    currentTags.forEach(tag => {
      const name = tagName(tag)
      if (!name) return

      const candidates = toArray(tag.posts).filter(post => canRecommend(currentPost, post))
      if (candidates.length === 0) return

      // Rare, more specific shared tags carry more weight than broad tags.
      const weight = 1 + Math.log((visiblePool.length + 1) / (candidates.length + 1))

      candidates.forEach(post => {
        let item = relatedPosts.get(post.path)
        if (!item) {
          item = {
            title: post.title,
            path: post.path,
            categories: toArray(post.categories).map(c => String(c.name || c)),
            created: post.date,
            score: 0,
            sharedTags: []
          }
          relatedPosts.set(post.path, item)
        }

        item.score += weight
        item.sharedTags.push({ name, weight })
      })
    })

    if (relatedPosts.size === 0) return ''

    const seriesTable = hexo.theme.config.series || {}
    const limitNum = 4
    const relatedPostsList = Array.from(relatedPosts.values())
      .map(item => {
        item.sharedTags.sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name, 'zh-CN'))
        return item
      })
      .sort((left, right) => {
        if (Math.abs(right.score - left.score) > 1e-9) return right.score - left.score
        if (right.sharedTags.length !== left.sharedTags.length) return right.sharedTags.length - left.sharedTags.length

        const dateDiff = Number(right.created || 0) - Number(left.created || 0)
        if (dateDiff !== 0) return dateDiff
        return String(left.title).localeCompare(String(right.title), 'zh-CN')
      })

    const { escape_html: escapeHtml, url_for: urlFor } = this
    let result = '<section class="related" data-recommendation-rule="shared-tags"><h2 class="related__head">相关文章<span>RELATED</span></h2><ul class="related__list">'
    for (const item of relatedPostsList.slice(0, limitNum)) {
      const tagLabel = escapeHtml(item.sharedTags.map(tag => tag.name).join(' · '))
      const key = item.categories.find(name => seriesTable[name])
      const series = key ? seriesTable[key] : null
      const tx = series ? ` style="--sc:${escapeHtml(series.color)}" data-sc="${escapeHtml(series.color)}" data-code="${escapeHtml(series.code)}"` : ''
      result += `<li><a href="${urlFor(item.path)}" title="推荐依据：共同标签 ${tagLabel}" data-related-score="${item.score.toFixed(6)}" data-shared-tags="${tagLabel}" data-title="${escapeHtml(item.title)}"${tx}>` +
        `<span class="related__series">${series ? escapeHtml(series.name) : ''}</span>` +
        `<span class="related__title">${escapeHtml(item.title)}</span>` +
        `<span class="related__tags">共同标签：${tagLabel}</span></a></li>`
    }
    result += '</ul></section>'
    return result
  })
}

// Theme and project scripts may load in parallel. Registering immediately before
// generation guarantees that this deterministic helper replaces the theme default.
hexo.extend.filter.register('before_generate', registerRelatedPostsHelper)
