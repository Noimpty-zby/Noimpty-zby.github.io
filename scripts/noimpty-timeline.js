'use strict'

/**
 * 学习时间线：/timeline/ 页面里的 {% study_timeline %}。
 *
 * 构建时从文章自动生成，每发一篇带 `series` 的学习文章，时间线就多一项，不用手动维护。
 * 渲染逻辑在 tools/study-timeline.cjs，这里只负责把文章整理成普通对象交过去。
 * 日期按站点时区（_config.yml 的 timezone）取，和文章页上显示的发布日期一致。
 */

const { render } = require('../tools/study-timeline.cjs')

hexo.extend.tag.register('study_timeline', () => {
  const zone = hexo.config.timezone
  const posts = hexo.locals.get('posts').toArray().map(post => {
    const date = zone && typeof post.date.clone().tz === 'function' ? post.date.clone().tz(zone) : post.date
    return { title: post.title, date: date.format('YYYY-MM-DD'), series: post.series || '', url: hexo.config.root + post.path }
  })
  return render(posts)
})
