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
 * 对外只暴露 loadCorpus()：拿到解密后的文章数组，失败就抛。
 * 娜娜莉的全站搜索用它，站点地图也用它数文章篇数。
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

  let cache = null
  let pending = null

  const loadCorpus = async () => {
    if (cache) return cache
    if (pending) return pending

    pending = (async () => {
      const res = await fetch(`${ROOT()}search.xml`.replace(/\/{2,}/g, '/'))
      if (!res.ok) throw new Error(`SEARCH_HTTP_${res.status}`)
      const body = (await res.text()).trim()

      // 没配 NOIMPTY_PASSPHRASE 构建出来的是空壳
      if (body.startsWith('<')) {
        const posts = parse(body)
        if (!posts.length) throw new Error('SEARCH_EMPTY')
        return (cache = posts)     // 兼容还没加密的旧产物
      }

      let envelope
      try { envelope = JSON.parse(body) } catch (_) { throw new Error('SEARCH_BAD_FORMAT') }
      if (!envelope || !envelope.data) throw new Error('SEARCH_BAD_FORMAT')

      const pass = passphrase()
      if (!pass) throw new Error('SEARCH_LOCKED')

      let xml
      try { xml = await decrypt(envelope.data, pass) }
      catch (_) { throw new Error('SEARCH_BAD_KEY') }

      return (cache = parse(xml))
    })()

    try { return await pending } finally { pending = null }
  }

  const MESSAGES = {
    SEARCH_LOCKED: '还没解锁 —— 站内搜索要用暗号解密索引，先在任意一个板块页输一次暗号。',
    SEARCH_BAD_KEY: '索引解不开。多半是暗号改过、但站点还没重新构建（改暗号后必须重新部署一次）。',
    SEARCH_EMPTY: '索引是空的。构建时没有提供 NOIMPTY_PASSPHRASE，所以 search.xml 被清空了。',
    SEARCH_BAD_FORMAT: '索引格式不对，可能是构建产物坏了 —— 重新部署一次试试。'
  }

  window.NOIMPTY_SEARCH = Object.freeze({
    loadCorpus,
    explain: code => MESSAGES[code] || '站内索引读不出来。',
    reset: () => { cache = null }
  })
})()
