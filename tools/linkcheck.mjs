/* 站内死链全量检查。
 *
 * 板块结构一改，最容易漏的就是「正文里、模板里、配置里那些手写的站内链接」——
 * 它们不会报错，只会在你点下去的时候 404，而且你多半永远不会点到。
 *
 * 所以这里直接扫构建产物：每一个 HTML 里的每一个 href/src，
 * 只要是站内的，就去 public/ 下面找对应的文件，找不到就报出来。
 *
 * ⚠️ 路径分隔符：磁盘上的路径在 Windows 是反斜杠（public\css\custom.css），
 *    而网页里的链接永远是正斜杠（/css/custom.css）。
 *    第一版没做归一化，结果在 Windows 上**每一条链接都对不上**，
 *    报了 179 条死链而站本身完全正常。所以下面 walk 出来的路径
 *    立刻就转成「站内路径」形态（前导 /、正斜杠），后面全程只用这一种。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, posix, sep } from 'node:path'

// 相对于仓库根目录跑：node tools/linkcheck.mjs
const ROOT = process.env.LINKCHECK_ROOT || join(process.cwd(), 'public')
// 站点自己的绝对地址也要当站内链接查 —— 有些模板会输出全路径
const SITE = (process.env.LINKCHECK_SITE || 'https://noimpty-zby.github.io').replace(/\/$/, '')

if (!existsSync(ROOT)) {
  console.error(`没有找到构建产物：${ROOT}\n先跑 npm run build。`)
  process.exit(1)
}

/** 磁盘路径 → 站内路径（永远是 /a/b/c 这种形态，和 HTML 里的写法一致） */
const toWebPath = abs => {
  let p = abs.slice(ROOT.length)
  if (sep !== '/') p = p.split(sep).join('/')
  return p.startsWith('/') ? p : '/' + p
}

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    /* statSync 可能抛：旧产物里存在过名字结尾带空格的目录
     * （Windows 解析路径时会把结尾空格吃掉，于是「存在但打不开」）。
     * 跳过就好 —— 为一个畸形目录让整个检查崩掉不划算。 */
    let st
    try { st = statSync(p) } catch (_) { continue }
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(ROOT).map(toWebPath)
const htmlPaths = files.filter(f => f.endsWith('.html'))
const have = new Set(files)

console.log(`扫 ${htmlPaths.length} 个 HTML，产物共 ${files.length} 个文件\n`)

/** 这个站内路径在产物里找不找得到 */
const resolves = raw => {
  let p = raw.split('#')[0].split('?')[0]
  if (!p) return true                      // 纯锚点
  try { p = decodeURI(p) } catch (_) {}
  if (!p.startsWith('/')) return null      // 相对路径由调用方先解析好
  return have.has(p) ||
    have.has(posix.join(p, 'index.html')) ||
    have.has(p + '.html') ||
    have.has(p + '/index.html')
}

const dead = new Map()   // 目标 → 出现在哪些页面
let checked = 0

for (const webPath of htmlPaths) {
  const where = webPath.replace(/\/index\.html$/, '/') || '/'
  const body = readFileSync(join(ROOT, webPath.slice(1).split('/').join(sep)), 'utf8')

  for (const m of body.matchAll(/(?:href|src)="([^"]+)"/g)) {
    let url = m[1].trim()
    if (!url || url.startsWith('#') || url.startsWith('data:') ||
        url.startsWith('mailto:') || url.startsWith('javascript:')) continue

    // 绝对 URL：只查指向本站的
    if (/^https?:\/\//i.test(url)) {
      if (!url.startsWith(SITE)) continue
      url = url.slice(SITE.length) || '/'
    } else if (url.startsWith('//')) {
      continue                              // 协议相对的外链
    }

    if (!url.startsWith('/')) {
      // 相对路径：按当前页面所在目录解析
      const base = where.endsWith('/') ? where : posix.dirname(where) + '/'
      url = posix.normalize(base + url)
    }

    checked++
    if (resolves(url) === false) {
      if (!dead.has(url)) dead.set(url, new Set())
      dead.get(url).add(where)
    }
  }
}

console.log(`检查了 ${checked} 个站内链接\n`)

if (!dead.size) {
  console.log('✓ 没有死链')
  process.exit(0)
}

/* 全站的不同链接目标一共也就一两百个。如果「死链」多到接近这个量级，
 * 那不是站坏了，是这个工具本身没跑对（路径分隔符、ROOT 指错了之类）。
 * 真的站内死链从来是零星几条 —— 一次冒出上百条，先怀疑工具。 */
const distinctTargets = new Set()
for (const webPath of htmlPaths) {
  const body = readFileSync(join(ROOT, webPath.slice(1).split('/').join(sep)), 'utf8')
  for (const m of body.matchAll(/(?:href|src)="(\/[^"/][^"]*)"/g)) distinctTargets.add(m[1])
}
if (distinctTargets.size && dead.size / distinctTargets.size > 0.5) {
  console.log('⚠️ 等一下 —— 全站一共只有', distinctTargets.size, '个不同的链接目标，')
  console.log('   而「死链」有', dead.size, '个，等于几乎全死。这种比例几乎不可能是站的问题。')
  console.log('   先怀疑这个检查工具：ROOT 指对了吗？是不是在仓库根目录之外跑的？')
  console.log(`   当前 ROOT = ${ROOT}\n`)
}

console.log(`✗ ${dead.size} 个目标解析不到：\n`)
for (const [target, wheres] of [...dead].sort((a, b) => b[1].size - a[1].size)) {
  const list = [...wheres]
  console.log(`  ${target}`)
  console.log(`      出现在 ${list.length} 个页面：${list.slice(0, 4).join('、')}${list.length > 4 ? ' …' : ''}`)
}
process.exit(1)
