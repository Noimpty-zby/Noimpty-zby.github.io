'use strict'

/**
 * 内页统一去掉主题的大横幅和侧栏。
 *
 * Butterfly 给每个独立页面（资讯、日程、关于、分类……）默认配一条大色块横幅，
 * 正中一个大字标题，右边再挂作者卡、公告、网站信息三张侧栏卡片。
 * 每页都一样，看不出自己在哪；侧栏那三张卡对一个只有主人自己看的站也没有信息量。
 *
 * 所以页面（layout: page）一律：
 *   - top_img: false —— 不要横幅，标题交给页面自己的 .noimpty-hero，
 *     没写 hero 的页面由 interior.css 把主题的 .page-title 排成同一种样子
 *   - aside: false   —— 不要侧栏
 *
 * 文章（layout: post）不动：它们的封面横幅和目录侧栏是有用的。
 * 归档 / 分类 / 标签那几种生成页不走这里，横幅在 _config.butterfly.yml
 * 的 archive_img / tag_img / category_img 关掉，侧栏本来就关着。
 *
 * 写在 template_locals 里而不是逐个改 front-matter：资讯每期是娜娜莉生成的，
 * 靠「记得在模板里加一行」迟早会漏。
 */

hexo.extend.filter.register('template_locals', locals => {
  const page = locals.page
  if (!page || page.layout !== 'page') return locals
  page.top_img = false
  page.aside = false
  return locals
})
