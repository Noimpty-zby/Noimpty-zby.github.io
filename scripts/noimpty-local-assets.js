'use strict'

// 第三方文件本地化：主题配置里的 vendor 列表（pjax、KaTeX 样式、Font Awesome、Fancybox）
// 从 node_modules 原样复制到 /pluginsSrc/<包名>/<文件>，不走 CDN。
// 每一项要么是包里的一个文件（file），要么再带上它的样式要用到的整个目录（dirs，例如字体）。
const fs = require('node:fs')
const path = require('node:path')

hexo.extend.generator.register('noimpty-local-assets', () => {
  const vendor = Array.isArray(hexo.theme.config.vendor) ? hexo.theme.config.vendor : []
  const routes = new Map()

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
      throw new Error('[local-assets] Cannot read ' + name + '/' + file + '. Install it as a direct dependency.', { cause: error })
    }
  }

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

  for (const item of vendor) {
    if (!item || !item.name) throw new Error('[local-assets] Vendor entry needs a package name')
    if (item.file) addFile(item.name, item.file)
    for (const dir of Array.isArray(item.dirs) ? item.dirs : []) copyDirectory(item.name, dir)
  }

  return [...routes.values()]
})
