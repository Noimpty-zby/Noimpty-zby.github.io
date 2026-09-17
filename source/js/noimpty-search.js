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
    try { return new URL(String(url || ''), window.location.origin).pathname === INDEX_PATH() }
    catch (_) { return false }
  }

  /* 原生 fetch 必须在打补丁之前抓住。
   * 下面会把 window.fetch 换掉，而解密自己也要 fetch 那个文件 ——
   * 用换过的那个就是无限递归。 */
  const nativeFetch = window.fetch.bind(window)

  let xml = null
  let xmlPending = null

  /** 解密后的 search.xml 原文。主题的搜索要的是这个，loadCorpus 也从它来。 */
  const loadXml = async () => {
    if (xml != null) return xml
    if (xmlPending) return xmlPending

    xmlPending = (async () => {
      const res = await nativeFetch(INDEX_PATH())
      if (!res.ok) throw new Error(`SEARCH_HTTP_${res.status}`)
      const body = (await res.text()).trim()

      // 没配 NOIMPTY_PASSPHRASE 构建出来的是空壳，也可能是还没加密的旧产物
      if (body.startsWith('<')) {
        if (!parse(body).length) throw new Error('SEARCH_EMPTY')
        return (xml = body)
      }

      let envelope
      try { envelope = JSON.parse(body) } catch (_) { throw new Error('SEARCH_BAD_FORMAT') }
      if (!envelope || !envelope.data) throw new Error('SEARCH_BAD_FORMAT')

      const pass = passphrase()
      if (!pass) throw new Error('SEARCH_LOCKED')

      try { return (xml = await decrypt(envelope.data, pass)) }
      catch (_) { throw new Error('SEARCH_BAD_KEY') }
    })()

    try { return await xmlPending } finally { xmlPending = null }
  }

  let cache = null
  const loadCorpus = async () => {
    if (cache) return cache
    return (cache = parse(await loadXml()))
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
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      if (!isIndexUrl(url)) return nativeFetch(input, init)
      // 解不开（还没解锁、暗号不对、构建时没给暗号）就给一份合法但空的 XML。
      // 比把密文塞给它强：至少 DOMParser 不会产出 parsererror。
      return loadXml().then(asXml, () => asXml(EMPTY))
    }
  }

  /* 行动日志。
   *
   * 和 search.xml 唯一的区别是：**取不到不算错**。
   * 没配暗号构建出来的站上压根没有这个文件（见 lockdown 第 3 节末尾），
   * 那时候 404 的正确含义是「她还没有日志」，不是「出故障了」——
   * 所以这里返回空数组，让对话窗口照常说话，而不是抛给主人一句看不懂的错。 */
  let journal = null
  const loadJournal = async () => {
    if (journal) return journal
    const res = await fetch(`${ROOT()}nanaly-journal.json`.replace(/\/{2,}/g, '/'))
    if (res.status === 404) return (journal = [])
    if (!res.ok) throw new Error(`SEARCH_HTTP_${res.status}`)

    let envelope
    try { envelope = JSON.parse((await res.text()).trim()) } catch (_) { throw new Error('SEARCH_BAD_FORMAT') }
    // 没加密的产物（本地不带暗号手工放的）也认，省得调试时一头雾水
    if (Array.isArray(envelope)) return (journal = envelope)
    if (Array.isArray(envelope.entries)) return (journal = envelope.entries)
    if (!envelope.data) throw new Error('SEARCH_BAD_FORMAT')

    const pass = passphrase()
    if (!pass) throw new Error('SEARCH_LOCKED')
    let text
    try { text = await decrypt(envelope.data, pass) }
    catch (_) { throw new Error('SEARCH_BAD_KEY') }
    try { return (journal = (JSON.parse(text).entries || [])) }
    catch (_) { throw new Error('SEARCH_BAD_FORMAT') }
  }

  const MESSAGES = {
    SEARCH_LOCKED: '还没解锁 —— 站内搜索要用暗号解密索引，先在任意一个板块页输一次暗号。',
    SEARCH_BAD_KEY: '索引解不开。多半是暗号改过、但站点还没重新构建（改暗号后必须重新部署一次）。',
    SEARCH_EMPTY: '索引是空的。构建时没有提供 NOIMPTY_PASSPHRASE，所以 search.xml 被清空了。',
    SEARCH_BAD_FORMAT: '索引格式不对，可能是构建产物坏了 —— 重新部署一次试试。'
  }

  window.NOIMPTY_SEARCH = Object.freeze({
    loadCorpus,
    loadJournal,
    isIndexUrl,
    explain: code => MESSAGES[code] || '站内索引读不出来。',
    reset: () => { cache = null; xml = null; journal = null }
  })
})()
