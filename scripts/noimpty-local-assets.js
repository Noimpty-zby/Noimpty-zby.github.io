'use strict'

// Butterfly local assets used by this site. Keep its plugins.yml as the source of
// filenames, but do not install/copy every optional comment system and renderer.
// Output paths deliberately match the theme's existing CDN local URL format.
const fs = require('node:fs')
const path = require('node:path')

const selectedKeys = (theme, config) => {
  // InfiniteGrid is referenced by GLOBAL_CONFIG on every page and loaded lazily
  // for galleries/waterfalls, even though it has no global enable flag.
  const keys = new Set(['fontawesome', 'egjs_infinitegrid'])
  const add = (enabled, ...names) => { if (enabled) names.forEach(name => keys.add(name)) }
  add(theme.lightbox === 'fancybox', 'fancybox', 'fancybox_css')
  add(theme.lightbox === 'medium_zoom', 'medium_zoom')
  add(theme.pjax?.enable, 'pjax')
  add(theme.instantpage, 'instantpage')
  add(theme.subtitle?.enable && theme.subtitle?.effect, 'typed')
  add(theme.snackbar?.enable, 'snackbar', 'snackbar_css')
  add(theme.lazyload?.enable && !theme.lazyload?.native, 'lazyload')
  add(theme.share?.use === 'sharejs', 'sharejs', 'sharejs_css')
  add(theme.math?.use === 'katex', 'katex')
  add(theme.math?.use === 'katex' && theme.math?.katex?.copy_tex, 'katex_copytex')
  add(theme.mermaid?.enable, 'mermaid')
  add(theme.chartjs?.enable, 'chartjs')
  add(theme.abcjs?.enable, 'abcjs_basic_js')
  add(theme.search?.use === 'algolia_search', 'algolia_search')
  add(theme.search?.use === 'docsearch', 'docsearch_js', 'docsearch_css')
  add(theme.preloader?.enable && theme.preloader?.source === 2, 'pace_js')
  add(theme.preloader?.enable && theme.preloader?.source === 2 && !theme.preloader?.pace_css_url, 'pace_default_css')

  for (const key of ['activate_power_mode', 'canvas_ribbon', 'canvas_fluttering_ribbon', 'canvas_nest', 'fireworks', 'click_heart', 'clickShowText']) {
    add(theme[key]?.enable, key)
  }

  const comments = Array.isArray(theme.comments?.use) ? theme.comments.use : String(theme.comments?.use || '').split(',')
  const commentAssets = {
    gitalk: ['gitalk', 'gitalk_css'], valine: ['valine'],
    waline: ['waline_js', 'waline_css'], twikoo: ['twikoo'],
    artalk: ['artalk_js', 'artalk_css'], disqusjs: ['disqusjs', 'disqusjs_css']
  }
  for (const comment of comments) {
    const name = String(comment).trim().toLowerCase()
    add(true, ...(commentAssets[name] || []))
    add(name === 'valine' && theme.aside?.card_newest_comments?.enable, 'blueimp_md5')
  }

  const prism = config.prismjs || {}
  add((config.syntax_highlighter === 'prismjs' || prism.enable) && !prism.preprocess, 'prismjs_js', 'prismjs_autoloader')
  add((config.syntax_highlighter === 'prismjs' || prism.enable) && !prism.preprocess && prism.line_number, 'prismjs_lineNumber_js')
  if (theme.math?.use === 'mathjax' && !theme.CDN?.option?.mathjax) {
    throw new Error('[local-assets] MathJax requires its dynamic font/data bundles; configure CDN.option.mathjax before enabling it.')
  }
  return [...keys].filter(key => !theme.CDN?.option?.[key])
}

hexo.extend.generator.register('noimpty-local-assets', () => {
  const theme = hexo.theme.config
  if (theme.CDN?.third_party_provider && theme.CDN.third_party_provider !== 'local') return []

  const plugins = hexo.render.renderSync({
    path: path.join(hexo.theme_dir, 'plugins.yml'), engine: 'yaml'
  })
  const routes = new Map()
  const packages = new Set()

  const packageRoot = name => {
    if (typeof name !== 'string' || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) {
      throw new Error('[local-assets] Invalid package name: ' + name)
    }
    return path.resolve(hexo.base_dir, 'node_modules', ...name.split('/'))
  }

  const addFile = (name, file) => {
    const base = packageRoot(name)
    if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      throw new Error('[local-assets] Invalid asset path: ' + file)
    }
    const absolute = path.resolve(base, ...file.split(/[\\/]/))
    if (!absolute.startsWith(base + path.sep)) throw new Error('[local-assets] Asset escapes its package: ' + file)
    const route = path.posix.join('pluginsSrc', name, file.replace(/\\/g, '/'))
    if (routes.has(route)) return
    try {
      routes.set(route, { path: route, data: fs.readFileSync(absolute) })
    } catch (error) {
      throw new Error('[local-assets] Cannot read ' + name + '/' + file +
        '. Install this enabled plugin as a direct dependency or configure CDN.option for it.', { cause: error })
    }
  }

  for (const key of selectedKeys(theme, hexo.config)) {
    const plugin = plugins && plugins[key]
    if (!plugin) throw new Error('[local-assets] Theme plugins.yml is missing: ' + key)
    addFile(plugin.name, plugin.file)
    packages.add(plugin.name)
  }

  // Only recurse through the small font/component directories that their CSS or
  // autoloader actually needs. The chosen Mermaid and Fancybox UMDs are standalone.
  const copyDirectory = (name, directory) => {
    const absolute = path.join(packageRoot(name), ...directory.split('/'))
    let entries
    try { entries = fs.readdirSync(absolute, { withFileTypes: true }) }
    catch (error) { throw new Error('[local-assets] Missing asset directory: ' + name + '/' + directory, { cause: error }) }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.posix.join(directory, entry.name)
      if (entry.isDirectory()) copyDirectory(name, file)
      else if (entry.isFile()) addFile(name, file)
      else throw new Error('[local-assets] Unsupported asset entry: ' + name + '/' + file)
    }
  }

  if (packages.has('@fortawesome/fontawesome-free')) copyDirectory('@fortawesome/fontawesome-free', 'webfonts')
  if (packages.has('katex')) copyDirectory('katex', 'dist/fonts')
  if (routes.has('pluginsSrc/butterfly-extsrc/sharejs/dist/css/share.min.css')) copyDirectory('butterfly-extsrc', 'sharejs/dist/fonts')
  if (packages.has('prismjs')) copyDirectory('prismjs', 'components')

  return [...routes.values()]
})
