// A dispatched task only checks published article links. No model, comments,
// repository mutation, arbitrary hosts, or credentials in the inspected requests.
import { readFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { listPosts } from './posts.mjs'
import { postPath } from './permalink.mjs'

export const SITE = 'https://noimpty-zby.cn'
export const LIMIT = 24
export const validRequestId = id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(id || ''))
export const normalizeArticlePath = value => {
  const path = String(value || '')
  if (!/^\/\d{4}\/\d{2}\/\d{2}\/[^/?#\\]+\/$/.test(path) || path.length > 512) throw new Error('只支持已发布文章的完整站内路径')
  let decoded
  try { decoded = decodeURIComponent(path) } catch (_) { throw new Error('文章路径编码无效') }
  if (!/^\/\d{4}\/\d{2}\/\d{2}\/[^/?#\\]+\/$/.test(decoded) || /[\u0000-\u001f]/.test(decoded)) throw new Error('文章路径无效')
  return decoded
}
export const publishedPaths = () => new Set(listPosts().map(post => postPath(post.file, readFileSync(post.file, 'utf8'))).filter(Boolean))

const decodedAttribute = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }
  const low = entity.toLowerCase()
  if (named[low]) return named[low]
  const n = low.startsWith('&#x') ? parseInt(low.slice(3, -1), 16) : Number(low.slice(2, -1))
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
})
export const collectTargets = (html, pageUrl) => {
  // Only the matching body container: copyright/footer/sidebar links are not
  // article links. Ignore comments and scripts before balancing nested divs.
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const tags = /<(\/?)([a-z][\w:-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi
  let start = -1, end = -1, rootTag = '', depth = 0
  for (const token of html.matchAll(tags)) {
    if (start < 0) {
      if (token[1] || !/\bid\s*=\s*["']article-container["']/i.test(token[0])) continue
      start = token.index + token[0].length
      rootTag = token[2].toLowerCase()
      depth = 1
      continue
    }
    if (token[2].toLowerCase() !== rootTag) continue
    if (token[1]) depth--
    else if (!/\/\s*>$/.test(token[0])) depth++
    if (!depth) { end = token.index; break }
  }
  if (start < 0 || end < start) throw new Error('线上页面没有完整文章正文，未检查')
  const article = html.slice(start, end)
  const targets = new Map()
  let skipped = 0
  for (const match of article.matchAll(/<(a|img)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = new Map()
    for (const attr of match[0].matchAll(/\s([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const name = attr[1].toLowerCase()
      if (!attrs.has(name)) attrs.set(name, attr[2] ?? attr[3] ?? attr[4] ?? '')
    }
    // Lazy loading markup often has a data: placeholder in src. Check the real
    // image even when its data-src attribute comes after that placeholder.
    const value = match[1].toLowerCase() === 'a' ? attrs.get('href')
      : attrs.get('data-src') || attrs.get('data-lazy-src') || attrs.get('src')
    if (value === undefined) continue
    const raw = decodedAttribute(value).trim()
    if (!raw || raw.startsWith('#') || /^(?:data:|mailto:|tel:)/i.test(raw)) continue
    let url
    try { url = new URL(raw, pageUrl) } catch (_) { skipped++; continue }
    if (url.origin !== new URL(SITE).origin || url.username || url.password || url.protocol !== 'https:') { skipped++; continue }
    url.hash = ''
    if (url.href.length > 2048) { skipped++; continue }
    targets.set(url.href, { url: url.href, kind: match[1].toLowerCase() === 'img' ? 'image' : 'link' })
  }
  return { targets: [...targets.values()].slice(0, LIMIT), skipped: skipped + Math.max(0, targets.size - LIMIT) }
}

// Redirects are followed manually and must stay on the one fixed public origin.
// A link to a private IP, localhost, another host, or a redirected external host
// is never requested, so inspecting content cannot turn the runner into a proxy.
export const safeFetch = async (url, { method = 'GET', fetchImpl = fetch, timeout = 8000 } = {}) => {
  let current = new URL(url)
  const signal = AbortSignal.timeout(timeout)
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (current.origin !== SITE || current.username || current.password) throw new Error('跳转到了检查范围之外')
    const response = await fetchImpl(current.href, { method, signal, redirect: 'manual', credentials: 'omit' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    await response.body?.cancel().catch(() => {})
    const location = response.headers.get('location')
    if (!location) throw new Error('跳转没有提供目标')
    current = new URL(location, current)
  }
  throw new Error('跳转次数过多')
}

export const checkTarget = async (target, fetchImpl = fetch) => {
  const hit = async () => {
    let response = await safeFetch(target.url, { method: 'HEAD', fetchImpl })
    if ([405, 501].includes(response.status)) {
      await response.body?.cancel().catch(() => {})
      response = await safeFetch(target.url, { fetchImpl })
    }
    await response.body?.cancel().catch(() => {})
    return response.status
  }
  try {
    let status = await hit()
    if (status >= 200 && status < 400) return { ...target, status, state: 'ok' }
    if ([404, 410].includes(status)) {
      status = await hit()
      if ([404, 410].includes(status)) return { ...target, status, state: 'broken' }
      if (status >= 200 && status < 400) return { ...target, status, state: 'ok' }
    }
    return { ...target, status, state: 'unknown', reason: `HTTP ${status}，未认定为坏链` }
  } catch (_) { return { ...target, state: 'unknown', reason: '超时、网络异常或跳转超出范围，无法确认' } }
}

export const checkArticle = async ({ path, requestId, paths = publishedPaths(), fetchImpl = fetch, sha = '' }) => {
  if (!validRequestId(requestId)) throw new Error('任务编号无效')
  path = normalizeArticlePath(path)
  if (!paths.has(path)) throw new Error('这篇文章不在已发布文章清单中')
  const response = await safeFetch(new URL(path, SITE).href, { fetchImpl })
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`文章页面读取失败：HTTP ${response.status}`) }
  const chunks = []
  let bytes = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > 1024 * 1024) throw new Error('文章页面过大，已停止检查')
      chunks.push(item.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const html = new TextDecoder().decode(Buffer.concat(chunks))
  const found = collectTargets(html, new URL(path, SITE).href)
  const results = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(3, found.targets.length) }, async () => {
    while (next < found.targets.length) { const index = next++; results[index] = await checkTarget(found.targets[index], fetchImpl) }
  }))
  return {
    v: 1, requestId, path, sha, at: new Date().toISOString(), state: 'completed',
    checked: results.length, broken: results.filter(row => row.state === 'broken').length,
    unknown: results.filter(row => row.state === 'unknown').length, skipped: found.skipped,
    results, scope: '仅检查当前已发布文章的站内链接与图片；站外地址和超出24项上限的内容未检查。'
  }
}

export const publishResult = async (result, { token, repo, sha, runId, fetchImpl = fetch }) => {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/i.test(sha) || !/^\d+$/.test(String(runId))) throw new Error('缺少合法的工作流结果发布上下文')
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/check-runs`, {
    method: 'POST', signal: AbortSignal.timeout(15000), redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({
      name: `nanaly-article-${result.requestId}`, head_sha: sha, external_id: result.requestId,
      status: 'completed', conclusion: result.state === 'failed' ? 'failure' : result.broken ? 'neutral' : 'success',
      completed_at: result.at, details_url: `https://github.com/${repo}/actions/runs/${runId}`,
      output: { title: result.state === 'failed' ? '文章检查未完成' : `已检查 ${result.checked} 项，坏链 ${result.broken} 项，待确认 ${result.unknown} 项`,
        summary: result.scope || result.message, text: JSON.stringify(result) }
    })
  })
  if (!response.ok) throw new Error(`任务结果发布失败：HTTP ${response.status}`)
  return response.json()
}

const main = async () => {
  const requestId = process.env.NANALY_TASK_ID || ''
  const path = process.env.NANALY_TASK_PATH || ''
  if (!validRequestId(requestId)) throw new Error('任务编号无效')
  let result
  try { result = await checkArticle({ path, requestId, sha: process.env.GITHUB_SHA }) }
  catch (error) {
    result = { v: 1, requestId, path: path.slice(0, 512), sha: process.env.GITHUB_SHA,
      at: new Date().toISOString(), state: 'failed', message: String(error.message).slice(0, 180) }
  }
  await publishResult(result, { token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID })
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    result.state === 'completed' ? `检查 ${result.checked} 项；坏链 ${result.broken} 项；未确认 ${result.unknown} 项。\n\n${result.scope}\n`
      : '本次文章检查未完成，请查看任务结果。\n')
  if (result.state === 'failed') process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(String(error.message).slice(0, 200)); process.exitCode = 1 })
}
