'use strict'

/**
 * 学习时间线：/timeline/ 页面里的 {% study_timeline %}。
 *
 * 构建时从文章自动生成，每发一篇带 `series` 的学习文章，时间线就多一项，不用手动维护。
 * 渲染逻辑在 tools/study-timeline.cjs，这里只负责把文章整理成普通对象交过去。
 * 日期按站点时区（_config.yml 的 timezone）取，和文章页上显示的发布日期一致。
 */

const { render } = require('../tools/study-timeline.cjs')

// Hexo 会缓存没有修改过的页面正文；其他文章的增删改不会使时间线页面失效。
// 在内置 render_post（优先级 10）之前，只清掉使用本标签的页面缓存。
// 每次生成都重算这些聚合页，也能覆盖从 db.json 恢复的增量构建。
hexo.extend.filter.register('before_generate', () => Promise.all(
  hexo.model('Page').toArray()
    .filter(page => page.content != null && !page.disableNunjucks && /\{%\s*study_timeline\s*%\}/.test(page._content))
    .map(page => {
      page.content = undefined
      return page.save()
    })
), 5)

hexo.extend.tag.register('study_timeline', () => {
  const zone = hexo.config.timezone
  const posts = hexo.locals.get('posts').toArray().map(post => {
    const date = zone && typeof post.date.clone().tz === 'function' ? post.date.clone().tz(zone) : post.date
    return { title: post.title, date: date.format('YYYY-MM-DD'), series: post.series || '', url: hexo.config.root + post.path }
  })
  return render(posts)
})
