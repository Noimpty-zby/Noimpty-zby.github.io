/* 给主题生成、改不到模板的几处补上读屏软件能念的名字（axe 查出来的）：
 *
 * - 文章底部的分享按钮只有图标（share.js 运行时生成，不支持写文字），读屏只会念「链接」；
 * - 顶部导航、上一篇/下一篇、搜索框顶部都是 <nav>，没有名字就分不清哪个是哪个；
 * - 手机侧边菜单不在任何区域标记里，按区域跳转时会被漏掉。
 *
 * PJAX 换页后主题会重新生成分享按钮和翻页导航，所以换页后再补一次。 */
(() => {
  'use strict'
  if (window.NOIMPTY_A11Y_LABELS) return
  window.NOIMPTY_A11Y_LABELS = true

  const NAMES = {
    facebook: '分享到 Facebook', x: '分享到 X', twitter: '分享到 X', wechat: '分享到微信（扫码）',
    weibo: '分享到微博', qq: '分享到 QQ', qzone: '分享到 QQ 空间', douban: '分享到豆瓣', linkedin: '分享到 LinkedIn'
  }
  const REGIONS = [
    ['#nav', null, '站点导航'], ['#pagination', null, '上一篇与下一篇'], ['#local-search .search-nav', null, '搜索'],
    ['#sidebar-menus', 'navigation', '侧边菜单']
  ]
  const label = () => {
    for (const [selector, role, name] of REGIONS) {
      const node = document.querySelector(selector)
      if (!node || node.hasAttribute('aria-label')) continue
      if (role && !node.hasAttribute('role')) node.setAttribute('role', role)
      node.setAttribute('aria-label', name)
    }
    for (const link of document.querySelectorAll('.social-share a.social-share-icon')) {
      if (link.hasAttribute('aria-label')) continue
      const site = [...link.classList].find(name => name.startsWith('icon-'))?.slice(5)
      if (site && NAMES[site]) link.setAttribute('aria-label', NAMES[site])
    }
  }
  // share.js 自己也挂在 DOMContentLoaded 上，顺序不定，等它跑完再补。
  const later = () => setTimeout(label, 60)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later)
  else later()
  window.addEventListener('load', later)
  document.addEventListener('pjax:complete', () => setTimeout(label, 120))
})()
