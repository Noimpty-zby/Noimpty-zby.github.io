/* 解密 search.xml。
 *
 * search.xml 是全站所有文章的完整正文，一个 GET 就能下完 ——
 * 全站上锁之后它是最大的一个口子，所以构建时整体加密了
 * （见 scripts/noimpty-lockdown.js 里的第 3 节）。
 *
 * 密钥由暗号派生。派生参数必须和 Node 侧**逐字一致**，改一边就解不开：
 *   PBKDF2-SHA256，salt = 'noimpty-search-v1'，120000 轮，256 位
 *   AES-256-GCM，前 12 字节是 IV，最后 16 字节是认证标签
 *
 * 对外暴露两个：
 *   loadCorpus()   解密后的文章数组。娜娜莉的全站搜索用它，站点地图也用它数篇数。
 *   loadJournal()  她那几个分身共用的行动日志（谁在什么时候干了什么）。
 *                  同一把暗号、同一套派生参数，只是另一个文件。
 * 都是失败就抛，由调用方决定怎么跟主人解释。
 */
(() => {
  'use strict'

  if (window.NOIMPTY_SEARCH) return

  const SALT = 'noimpty-search-v1'
  const ITER = 120000

  const ROOT = () => ((window.GLOBAL_CONFIG_SITE && window.GLOBAL_CONFIG_SITE.root) || '/')

  const passphrase = () => {
    try { return (window.NOIMPTY_GATE && window.NOIMPTY_GATE.passphrase()) || '' }
    catch (_) { return '' }
  }

  const deriveKey = async pass => {
    const enc = new TextEncoder()
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITER, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )
  }

  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))

  const decrypt = async (payload, pass) => {
    const raw = b64(payload)
    const key = await deriveKey(pass)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      key,
      raw.slice(12)
    )
    return new TextDecoder().decode(plain)
  }

  const parse = xml => {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    if (doc.querySelector?.('parsererror')) throw new Error('SEARCH_BAD_FORMAT')
    return [...doc.querySelectorAll('entry')].map(e => ({
      title: (e.querySelector('title') || {}).textContent || '',
      url: (e.querySelector('url') || {}).textContent || '',
      text: ((e.querySelector('content') || {}).textContent || '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    })).filter(p => p.title)
  }

  const INDEX_PATH = () => `${ROOT()}search.xml`.replace(/\/{2,}/g, '/')

  /** 这个地址是不是那份索引。给下面接管主题搜索用。 */
  const isIndexUrl = url => {
    try {
      const target = new URL(String(url || ''), window.location.origin)
      return target.origin === window.location.origin && target.pathname === INDEX_PATH()
    }
    catch (_) { return false }
  }

  /* 原生 fetch 必须在打补丁之前抓住。
   * 下面会把 window.fetch 换掉，而解密自己也要 fetch 那个文件 ——
   * 用换过的那个就是无限递归。 */
  const nativeFetch = window.fetch.bind(window)

  // 共享请求有自己的期限；任何一个调用者取消，都不应影响其他正在等索引的人。
  // 期限覆盖响应正文读取，防止只收到 headers 后连接悬挂，pending 永久不能重试。
  const fetchResource = async url => {
    const controller = new AbortController()
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('SEARCH_TIMEOUT')
        controller.abort(error)
        reject(error)
      }, 20000)
    })
    try {
      return await Promise.race([(async () => {
        const res = await nativeFetch(url, { signal: controller.signal })
        return { ok: res.ok, status: res.status, body: await res.text() }
      })(), deadline])
    } finally { clearTimeout(timer) }
  }


  const decryptPayload = async envelope => {
    if (!envelope || typeof envelope !== 'object' || typeof envelope.data !== 'string' ||
        !envelope.data || (envelope.v != null && envelope.v !== 1) ||
        (envelope.alg != null && envelope.alg !== 'AES-GCM')) throw new Error('SEARCH_BAD_FORMAT')
    const pass = passphrase()
    if (!pass) throw new Error('SEARCH_LOCKED')
    try { return await decrypt(envelope.data, pass) }
    catch (_) { throw new Error('SEARCH_BAD_KEY') }
  }

  let generation = 0
  let xml = null
  let xmlPending = null

  /** 解密后的 search.xml 原文。主题的搜索要的是这个，loadCorpus 也从它来。 */
  const loadXml = async () => {
    if (xml != null) return xml
    if (xmlPending) return xmlPending

    const revision = generation
    const pending = (async () => {
      const res = await fetchResource(INDEX_PATH())
      if (!res.ok) throw new Error(`SEARCH_HTTP_${res.status}`)
      const body = res.body.trim()

      // 没配 NOIMPTY_PASSPHRASE 构建出来的是空壳，也可能是还没加密的旧产物
      if (body.startsWith('<')) {
        if (!parse(body).length) throw new Error('SEARCH_EMPTY')
        return body
      }

      let envelope
      try { envelope = JSON.parse(body) } catch (_) { throw new Error('SEARCH_BAD_FORMAT') }
      const plain = await decryptPayload(envelope)
      parse(plain)
      return plain
    })().then(body => {
      if (revision !== generation) throw new Error('SEARCH_RESET')
      return (xml = body)
    })
    xmlPending = pending
    try { return await pending } finally { if (xmlPending === pending) xmlPending = null }
  }

  let cache = null
  const loadCorpus = async () => {
    if (cache) return cache
    const revision = generation
    const body = await loadXml()
    if (revision !== generation) throw new Error('SEARCH_RESET')
    return (cache = parse(body))
  }

  /* ---------------- 接管主题自带的那个搜索 ----------------
   *
   * 导航栏那个放大镜到今天为止是**死的**：theme 的 local-search.js 直接
   *   DOMParser().parseFromString(res, 'text/xml').querySelectorAll('entry')
   * 而全站上锁之后 /search.xml 已经是密文信封（{"v":1,"alg":"AES-GCM",…}）。
   * 拿 JSON 当 XML 解析得到的是 parsererror 文档，entry 数为 0 —— 于是
   * this.datas = []，搜什么都是「没有找到」。整条路径不抛异常，
   * 所以控制台干净、catch 不到，没有任何人会发现。
   * 娜娜莉的 @@ACT{"do":"search"} 驱动的也是同一个框，同样搜不出东西。
   *
   * 修法是把它那一次 fetch 接管过来，还给它解密后的 XML。
   * 为什么不去改 local-search.js：那是主题文件，重装依赖就被覆盖
   * （README 第一节就写着别动 node_modules/hexo-theme-butterfly）。
   *
   * 只认那一个地址，别的一律原样放行 —— 娜娜莉调 DeepSeek/Tavily、
   * 日程页调 GitHub API 走的都是同一个 fetch。 */
  if (!window.__NOIMPTY_SEARCH_PATCHED__) {
    window.__NOIMPTY_SEARCH_PATCHED__ = true
    const EMPTY = '<?xml version="1.0" encoding="utf-8"?>\n<search></search>\n'
    const asXml = text => new Response(text, {
      status: 200, headers: { 'Content-Type': 'application/xml' }
    })
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && (input.url || input.href)) || ''
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
      if (method !== 'GET' || !isIndexUrl(url)) return nativeFetch(input, init)
      const signal = (init && init.signal) || (input && input.signal)
      if (signal && signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'))
      // 解不开（还没解锁、暗号不对、构建时没给暗号）就给一份合法但空的 XML。
      // 比把密文塞给它强：至少 DOMParser 不会产出 parsererror。
      const response = loadXml().then(asXml, () => asXml(EMPTY))
      if (!signal) return response
      // Cancelling one caller must not cancel the shared index load for other readers.
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'))
        signal.addEventListener('abort', abort, { once: true })
        response.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
    }
  }

  /* 行动日志。
   *
   * 和 search.xml 唯一的区别是：**取不到不算错**。
   * 没配暗号构建出来的站上压根没有这个文件（见 lockdown 第 3 节末尾），
   * 那时候 404 的正确含义是「她还没有日志」，不是「出故障了」——
   * 所以这里返回空数组，让对话窗口照常说话，而不是抛给主人一句看不懂的错。 */
  let journal = null
  let journalPending = null
  const loadJournal = async () => {
    if (journal) return journal
    if (journalPending) return journalPending
    const revision = generation
    const pending = (async () => {
      const res = await fetchResource(`${ROOT()}nanaly-journal.json`.replace(/\/{2,}/g, '/'))
      if (res.status === 404) return []
      if (!res.ok) throw new Error(`SEARCH_HTTP_${res.status}`)
      let envelope
      try { envelope = JSON.parse(res.body.trim()) } catch (_) { throw new Error('SEARCH_BAD_FORMAT') }
      if (Array.isArray(envelope)) return envelope
      if (envelope && Array.isArray(envelope.entries)) return envelope.entries
      const plain = await decryptPayload(envelope)
      let decoded
      try { decoded = JSON.parse(plain) } catch (_) { throw new Error('SEARCH_BAD_FORMAT') }
      if (!decoded || !Array.isArray(decoded.entries)) throw new Error('SEARCH_BAD_FORMAT')
      return decoded.entries
    })().then(entries => {
      if (revision !== generation) throw new Error('SEARCH_RESET')
      return (journal = entries.filter(e => e && typeof e === 'object'
        && typeof e.at === 'string' && typeof e.who === 'string' && typeof e.what === 'string'))
    })
    journalPending = pending
    try { return await pending } finally { if (journalPending === pending) journalPending = null }
  }

  const MESSAGES = {
    SEARCH_LOCKED: '还没解锁 —— 站内搜索要用暗号解密索引，先在任意一个板块页输一次暗号。',
    SEARCH_BAD_KEY: '索引解不开。多半是暗号改过、但站点还没重新构建（改暗号后必须重新部署一次）。',
    SEARCH_EMPTY: '索引是空的。构建时没有提供 NOIMPTY_PASSPHRASE，所以 search.xml 被清空了。',
    SEARCH_TIMEOUT: '读取站内索引超时，请检查网络后重试。',
    SEARCH_RESET: '站内索引已刷新，请重试。',
    SEARCH_BAD_FORMAT: '索引格式不对，可能是构建产物坏了 —— 重新部署一次试试。'
  }

  window.NOIMPTY_SEARCH = Object.freeze({
    loadCorpus,
    loadJournal,
    decryptPayload,
    isIndexUrl,
    explain: code => MESSAGES[code] || '站内索引读不出来。',
    reset: () => {
      generation++; cache = null; xml = null; journal = null; xmlPending = null; journalPending = null
      window.dispatchEvent?.(new Event('noimpty:search-reset'))
    }
  })
})()
