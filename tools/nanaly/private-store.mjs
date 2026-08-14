/* 私密仓库的读写。
 *
 * 为什么需要这么一层：
 *
 * 博客仓库是公开的 —— 它必须公开，免费的 GitHub Pages 只能从公开仓库发布。
 * 所以放进博客仓库的任何东西（哪怕文章标了 privacy: protected）都是公开的：
 * 前端那把「暗号」锁挡的是眼睛，不是爬虫，更不是任何一个会点「查看源代码」的人。
 *
 * 比赛方案和围绕它的点子不能这么放。所以它们完全不进博客仓库 ——
 * 单独存在一个**私有仓库**里，三方各自凭 token 访问：
 *
 *   娜娜莉（GitHub Actions）  用 IDEAS_TOKEN 读方案、写点子
 *   主人（浏览器）            用保险箱里那把 token 读，页面上解出来看
 *   博客里的娜娜莉            读的是页面上已经解出来的内容，所以能回答
 *
 * 别人拿不到 token，就什么都看不到 —— 不是「看不见」，是拿不到数据。
 * token 万一泄漏，去 GitHub 上点一下撤销即可，不像「公开的密文」那样覆水难收。
 */

const API = 'https://api.github.com'

export const IDEAS_REPO = process.env.IDEAS_REPO || ''
const TOKEN = process.env.IDEAS_TOKEN || ''

export const hasPrivateStore = () => !!(IDEAS_REPO && TOKEN)

const call = async (path, init = {}) => {
  if (!hasPrivateStore()) throw new Error('NO_PRIVATE_STORE')
  const res = await fetch(`${API}/repos/${IDEAS_REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'nanaly',
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(30000)
  })
  const body = await res.json().catch(() => ({}))
  // 404 是「还没有这个文件」，属于正常情况，交给调用方判断
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`${res.status} ${body.message || ''}`.trim())
  return body
}

const b64decode = b64 => Buffer.from(String(b64 || '').replace(/\s+/g, ''), 'base64').toString('utf8')
const b64encode = str => Buffer.from(str, 'utf8').toString('base64')

/** 读一个文本文件。不存在返回 null。 */
export const readPrivate = async path => {
  const r = await call(`contents/${encodeURI(path)}`)
  if (r.notFound) return null
  if (r.encoding !== 'base64' || !r.content) return null
  return { text: b64decode(r.content), sha: r.sha }
}

/** 写一个文本文件。已存在就带 sha 覆盖。 */
export const writePrivate = async (path, text, message) => {
  const cur = await call(`contents/${encodeURI(path)}`)
  const body = {
    message: message || `更新 ${path}`,
    content: b64encode(text),
    committer: {
      name: process.env.NANALY_GIT_NAME || '娜娜莉',
      email: process.env.NANALY_GIT_EMAIL || 'nanaly@noimpty-zby.github.io'
    }
  }
  if (!cur.notFound && cur.sha) body.sha = cur.sha
  await call(`contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify(body) })
  return true
}

/** 列一个目录下的文件名。目录不存在返回空数组。 */
export const listPrivate = async dir => {
  const r = await call(`contents/${encodeURI(dir)}`)
  if (r.notFound || !Array.isArray(r)) return []
  return r.filter(x => x.type === 'file').map(x => x.name)
}
