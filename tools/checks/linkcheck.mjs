/* Check generated href/src links against files in public/, using browser URL
 * resolution. This is an offline check: external URLs are never requested. */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'

const ROOT = resolve(process.env.LINKCHECK_ROOT || join(process.cwd(), 'public'))
const SITE = new URL(process.env.LINKCHECK_SITE || 'https://noimpty-zby.cn')

if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) {
  console.error('没有找到构建目录：' + ROOT + '\n先跑 npm run build。')
  process.exit(1)
}

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = join(dir, entry.name)
  if (entry.isDirectory()) return walk(file)
  if (!entry.isFile()) throw new Error('构建产物包含不支持的文件类型：' + file)
  return [file]
})
const toWebPath = file => '/' + relative(ROOT, file).split(sep).join('/')
const files = walk(ROOT).map(toWebPath)
const htmlPaths = files.filter(file => /\.html$/i.test(file))
const have = new Set(files)
if (!htmlPaths.length) {
  console.error('构建产物没有 HTML 页面，不能通过死链检查')
  process.exit(1)
}
console.log('扫 ' + htmlPaths.length + ' 个 HTML，产物共 ' + files.length + ' 个文件\n')

const decodeAttribute = value => value.replace(/&(?:#(x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (entity, code) => {
  if (!code) return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[entity.slice(1, -1).toLowerCase()]
  const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd'
})
const attributes = body => {
  // Comments and script/style text are not HTML elements with usable links.
  const html = body.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    match => /^<!--/.test(match) ? '' : match.slice(0, match.indexOf('>') + 1))
  return [...html.matchAll(/<[a-z][\w:-]*\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)].flatMap(tag => {
    const attrs = new Map()
    for (const attr of tag[0].matchAll(/\s([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const name = attr[1].toLowerCase()
      if (!attrs.has(name)) attrs.set(name, attr[2] ?? attr[3] ?? attr[4] ?? '')
    }
    return ['href', 'src', 'data-src', 'data-lazy-src']
      .filter(name => attrs.has(name)).map(name => decodeAttribute(attrs.get(name)))
  })
}
const resolves = pathname => {
  let file
  try { file = decodeURIComponent(pathname) } catch (_) { return false }
  return have.has(file) || have.has(posix.join(file, 'index.html')) || have.has(file + '.html')
}

const dead = new Map()
const distinctTargets = new Set()
let checked = 0, empty = 0
for (const webPath of htmlPaths) {
  const where = webPath.replace(/\/index\.html$/i, '/') || '/'
  const body = readFileSync(join(ROOT, webPath.slice(1).split('/').join(sep)), 'utf8')
  if (!body.trim()) {
    console.error('空页面：' + where)
    empty++
    continue
  }
  for (const raw of attributes(body)) {
    const value = raw.trim()
    if (!value || value.startsWith('#')) continue
    let url
    try { url = new URL(value, new URL(webPath, SITE)) } catch (_) { continue }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== SITE.origin) continue
    checked++
    distinctTargets.add(url.pathname)
    if (!resolves(url.pathname)) {
      if (!dead.has(url.pathname)) dead.set(url.pathname, new Set())
      dead.get(url.pathname).add(where)
    }
  }
}
console.log('检查了 ' + checked + ' 个站内链接\n')
if (!dead.size && !empty) {
  console.log('✓ 没有死链')
  process.exit(0)
}
if (distinctTargets.size && dead.size / distinctTargets.size > 0.5) {
  console.log('⚠️ 大量链接无法解析，请同时检查构建是否完整以及 ROOT 是否正确：' + ROOT + '\n')
}
console.log('✗ ' + dead.size + ' 个目标解析不到，' + empty + ' 个空页面：\n')
for (const [target, wheres] of [...dead].sort((a, b) => b[1].size - a[1].size)) {
  const list = [...wheres]
  console.log('  ' + target)
  console.log('      出现在 ' + list.length + ' 个页面：' + list.slice(0, 4).join('、') + (list.length > 4 ? ' …' : ''))
}
process.exit(1)
