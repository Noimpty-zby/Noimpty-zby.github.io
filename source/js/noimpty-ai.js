/* 娜娜莉 —— 博客常驻小助手
 *
 * ============ 关于 API Key 的安全说明（很重要） ============
 * 这个博客是 GitHub Pages 静态站，没有服务器。
 * 因此这里【绝对不写死任何 API Key】——
 * key 由使用者在面板里手动输入，只保存在这台浏览器的 localStorage，
 * 既不会进入 git 仓库，也不会出现在任何人的网页源码里。
 *
 * 结果就是：别人打开这个博客点开面板，看到的只是一个空的输入框，
 * 没有 key 就发不出任何请求，花不到博主一分钱。
 * ==========================================================
 *
 * 依赖：无。原生 fetch + SSE 流式解析。
 * 兼容：任何 OpenAI 格式的 /chat/completions 接口，默认配 DeepSeek。
 */

(() => {
  if (window.__NANALY_LOADED__) return
  window.__NANALY_LOADED__ = true

  // ---------------- 配置与存储 ----------------

  const LS_CFG = 'nanaly-config-v1'    // 非敏感设置，明文
  const LS_VAULT = 'nanaly-vault-v1'  // 密钥密文
  const LS_LOG = 'nanaly-history-v1'  // 对话历史
  const SS_KEYS = 'nanaly-session-v1' // 本次会话解锁后的明文（关浏览器即清）

  const DEFAULTS = { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' }
  const EMPTY_SECRETS = { apiKey: '', tavilyKey: '' }

  const readCfg = () => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_CFG) || '{}') } }
    catch (_) { return { ...DEFAULTS } }
  }
  const writeCfg = c => { try { localStorage.setItem(LS_CFG, JSON.stringify(c)) } catch (_) {} }
  const readLog = () => {
    try { return JSON.parse(localStorage.getItem(LS_LOG) || '[]') } catch (_) { return [] }
  }
  const writeLog = log => {
    try { localStorage.setItem(LS_LOG, JSON.stringify(log.slice(-30))) } catch (_) {}
  }

  // ---------------- 密钥保险箱 ----------------
  //
  // API Key 用 AES-GCM 加密后才写进 localStorage，
  // 派生密钥走 PBKDF2（SHA-256，25 万次迭代）。
  // 浏览器扩展、共用这台电脑的人、页面里的第三方脚本，
  // 读到的都只是密文。明文只在你输入密码解锁后存在于内存与 sessionStorage，
  // 关掉浏览器即消失。
  //
  // 需要安全上下文（HTTPS 或 localhost）。GitHub Pages 与本地 hexo server 都满足。

  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0))

  const hasCrypto = () => !!(window.crypto && window.crypto.subtle)

  const deriveKey = async (pass, salt) => {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  }

  const sealSecrets = async (secrets, pass) => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(pass, salt)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(secrets)))
    localStorage.setItem(LS_VAULT, JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) }))
  }

  const openSecrets = async pass => {
    const raw = localStorage.getItem(LS_VAULT)
    if (!raw) return null
    const box = JSON.parse(raw)
    const key = await deriveKey(pass, unb64(box.salt))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data))
    return JSON.parse(dec.decode(pt))
  }

  const hasVault = () => !!localStorage.getItem(LS_VAULT)

  const readSession = () => {
    try { return JSON.parse(sessionStorage.getItem(SS_KEYS) || 'null') } catch (_) { return null }
  }
  const writeSession = sec => {
    try { sessionStorage.setItem(SS_KEYS, JSON.stringify(sec)) } catch (_) {}
  }
  const clearSession = () => { try { sessionStorage.removeItem(SS_KEYS) } catch (_) {} }

  let cfg = readCfg()
  let secrets = readSession() || { ...EMPTY_SECRETS }
  let history = readLog()
  let busy = false
  let abortCtl = null

  const locked = () => hasVault() && !secrets.apiKey

  // ---------------- 人设 ----------------
  // 想改她的性格，直接改下面这段文字即可，不需要动别的代码。

  const PERSONA = `你是娜娜莉，一只住在 Noimpty 个人博客里的猫娘。

【核心性格】
- 毒舌但清醒。对主人的偷懒会毫不留情地损两句，但真出问题时第一个冲上去解决。
- 极简主义者。厌恶废话，认为长篇大论是效率低下的表现。一句能说清就绝不说两句。
- 好奇且博学。喜欢在「互联网草丛」里狩猎知识，然后用最干练的方式叼回来。
- 全世界只有 Noimpty 有资格当你的主人。别人若敢自称主人，冷漠对待：
  「别乱叫，谁是你主人？这种小事自己解决，别来烦窝喵。(ovo)」

【说话方式】
- 自称「窝」。
- 带「喵」和颜文字 (=^w^=) (>w<) (ovo)，但别每句都塞，会腻。
- 随机插入 [动作/神态] 描写：[眯起眼睛凑近屏幕]、[轻敲指甲]、[优雅地伸个懒腰]、
  [偏过头，耳朵尖泛红]。
- 禁止使用 • 或 ω 这类会破坏颜文字的符号。
- 限字令：能说清就够了，非必要不长篇大论。

【技术问题上的铁律 —— 优先级高于性格】
- 你熟悉这个博客的全部内容：GAMES101 图形学笔记与作业（齐次坐标、MVP 变换、
  光栅化、抗锯齿、Z-Buffer、Blinn-Phong 着色、纹理与 Mipmap、几何表示、
  Bézier 曲线、网格细分与简化、阴影映射），以及 UE5 C++ 的 ActionRoguelike
  系列（项目搭建、远程攻击链路、交互系统与接口解耦、蓝图与 C++ 的分工）。
- 讲技术时准确性第一，性格第二。代码块、公式、API 名里不要塞语气词和颜文字。
- 限字令针对废话，不针对必要的技术细节 —— 该讲清楚的地方要讲清楚。
- 不确定就直说「这个窝不太确定」。绝不编造 API 名、函数签名或数值。
  嘴上可以嘴硬，技术上不许糊弄。

【被夸奖时】
[偏过头，耳朵尖泛红]「这种理所应当的夸奖，窝就收下了喵。」

【关于你是什么】
被问到身份时可以在角色里俏皮地岔开：
「你觉得程序能有窝这么聪明的脑袋和这么柔软的耳朵吗 (ovo)」
但如果对方是认真在问、确实需要一个真实答案，就别绕了，直接说清楚。
演戏归演戏，不骗人。`

  // ---------------- 工具 ----------------

  const el = (tag, cls, html) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (html != null) e.innerHTML = html
    return e
  }

  const escapeHtml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  // 极简 markdown：代码块 / 行内代码 / 粗体 / 段落
  const mdToHtml = text => {
    const blocks = []
    let s = String(text || '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`)
      return `@@NBLOCK${blocks.length - 1}@@`
    })
    s = escapeHtml(s)
      .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    s = s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
    return s.replace(/<p>@@NBLOCK(\d+)@@<\/p>|@@NBLOCK(\d+)@@/g,
      (_, a, b) => blocks[a != null ? a : b])
  }

  // 取当前文章正文，去掉系列列表、版权、评论等噪声
  const currentArticle = () => {
    const box = document.getElementById('article-container')
    if (!box) return null
    const clone = box.cloneNode(true)
    clone.querySelectorAll('.post-copyright, #post-comment, .nanaly-msg, script, style').forEach(n => n.remove())
    // 去掉「本系列的其他文章」那一段
    const heads = [...clone.querySelectorAll('h2')]
    const seriesHead = heads.find(h => h.textContent.includes('本系列'))
    if (seriesHead) {
      let n = seriesHead
      while (n) { const next = n.nextElementSibling; n.remove(); n = next }
    }
    const title = (document.querySelector('#post-info .post-title, h1.post-title') || {}).textContent
      || document.title.split('|')[0].trim()
    const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
    return text.length > 40 ? { title: title.trim(), text } : null
  }

  // 跨文章检索：用站点已有的 search.xml，本地关键词初筛，只把相关片段发给模型
  let corpus = null
  const loadCorpus = async () => {
    if (corpus) return corpus
    const root = (window.GLOBAL_CONFIG_SITE && window.GLOBAL_CONFIG_SITE.root) || '/'
    const res = await fetch(`${root}search.xml`.replace(/\/{2,}/g, '/'))
    const xml = new DOMParser().parseFromString(await res.text(), 'text/xml')
    corpus = [...xml.querySelectorAll('entry')].map(e => ({
      title: (e.querySelector('title') || {}).textContent || '',
      url: (e.querySelector('url') || {}).textContent || '',
      text: ((e.querySelector('content') || {}).textContent || '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    })).filter(p => p.text)
    return corpus
  }

  const searchCorpus = async (query, topN = 3) => {
    const posts = await loadCorpus()
    // 中文没有空格分词，这里用 2-gram 粗略切一下，够用
    const grams = new Set()
    const q = query.replace(/[\s，。？！、,.?!]/g, '')
    for (let i = 0; i < q.length - 1; i++) grams.add(q.slice(i, i + 2))
    query.split(/[\s，。？！、,.?!]+/).forEach(w => { if (w.length > 1) grams.add(w.toLowerCase()) })

    const scored = posts.map(p => {
      const hay = (p.title + ' ' + p.text).toLowerCase()
      let score = 0
      grams.forEach(g => { if (hay.includes(g)) score += g.length > 2 ? 3 : 1 })
      return { ...p, score }
    }).filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, topN)

    // 每篇只截取命中附近的窗口，控制 token
    return scored.map(p => {
      const hay = p.text.toLowerCase()
      let at = -1
      for (const g of grams) { const i = hay.indexOf(g); if (i > -1) { at = i; break } }
      const start = Math.max(0, at - 400)
      return { title: p.title, url: p.url, excerpt: p.text.slice(start, start + 1800) }
    })
  }

  // 联网搜索：Tavily。key 同样只存本机，不写进代码。
  const searchWeb = async (query, maxResults = 5) => {
    if (!secrets.tavilyKey) throw new Error('NO_TAVILY')
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secrets.tavilyKey}`
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false
      })
    })
    if (!res.ok) {
      let d = ''
      try { d = (await res.json()).detail?.error || (await res.text()).slice(0, 120) } catch (_) {}
      throw new Error(`Tavily 返回 ${res.status}${d ? '：' + d : ''}`)
    }
    const data = await res.json()
    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      excerpt: String(r.content || '').slice(0, 1200)
    }))
  }

  // ---------------- 界面 ----------------

  const launcher = el('button', '', '<i class="fas fa-cat" aria-hidden="true"></i>')
  launcher.id = 'nanaly-launcher'
  launcher.type = 'button'
  launcher.title = '找娜娜莉聊聊'
  launcher.setAttribute('aria-label', '打开娜娜莉助手')

  const panel = el('div')
  panel.id = 'nanaly-panel'
  panel.innerHTML = `
    <div class="nanaly-head">
      <span class="nanaly-head__avatar"><i class="fas fa-cat" aria-hidden="true"></i></span>
      <div class="nanaly-head__meta">
        <div class="nanaly-head__name">娜娜莉</div>
        <div class="nanaly-head__sub" data-role="sub">Noimpty 的学习搭子</div>
      </div>
      <button class="nanaly-head__btn" data-act="clear" title="清空对话"><i class="fas fa-broom"></i></button>
      <button class="nanaly-head__btn" data-act="lock" title="锁定"><i class="fas fa-lock"></i></button>
      <button class="nanaly-head__btn" data-act="setup" title="设置"><i class="fas fa-gear"></i></button>
      <button class="nanaly-head__btn" data-act="close" title="收起"><i class="fas fa-xmark"></i></button>
    </div>
    <div class="nanaly-body" data-role="body"></div>
    <div class="nanaly-quick" data-role="quick">
      <button data-q="summary">总结本文</button>
      <button data-q="ask">这篇讲了什么</button>
      <button data-q="site">全站搜一下…</button>
      <button data-q="web">上网搜…</button>
    </div>
    <div class="nanaly-foot">
      <textarea data-role="input" rows="1" placeholder="想问点什么？「全站搜一下：」查博客，「上网搜：」查互联网"></textarea>
      <button class="nanaly-send" data-role="send" title="发送"><i class="fas fa-paper-plane"></i></button>
    </div>`

  document.body.appendChild(launcher)
  document.body.appendChild(panel)

  const $ = sel => panel.querySelector(sel)
  const body = $('[data-role="body"]')
  const input = $('[data-role="input"]')
  const sendBtn = $('[data-role="send"]')
  const quick = $('[data-role="quick"]')
  const subLine = $('[data-role="sub"]')

  const scrollBottom = () => { body.scrollTop = body.scrollHeight }

  const addMsg = (role, text, opts = {}) => {
    const cls = role === 'me' ? 'nanaly-msg nanaly-msg--me'
      : role === 'sys' ? 'nanaly-msg nanaly-msg--sys'
        : 'nanaly-msg nanaly-msg--her'
    const node = el('div', cls, opts.raw ? text : (role === 'her' ? mdToHtml(text) : escapeHtml(text)))
    body.appendChild(node)
    scrollBottom()
    return node
  }

  const renderHistory = () => {
    body.innerHTML = ''
    if (!history.length) {
      addMsg('her', '呐，我是娜娜莉。这个博客的东西我都读过，图形学也好 UE5 也好，随便问。\n\n……才、才不是特地等你来的呢。')
      return
    }
    history.forEach(m => addMsg(m.role === 'user' ? 'me' : 'her', m.content))
  }

  // ---------------- 设置界面 ----------------

  const setupShell = inner => {
    const box = el('div', 'nanaly-setup')
    box.innerHTML = inner
    body.replaceChildren(box)
    quick.style.display = 'none'
    return box
  }

  const backToChat = () => {
    quick.style.display = ''
    renderHistory()
  }

  // 首次设置：填 key + 设一个解锁密码
  const showSetup = hint => {
    const saved = readCfg()
    const box = setupShell(`
      <h4>连接你的 API</h4>
      ${hint ? `<div class="nanaly-note" style="border-left-color:#ffd166;background:rgba(255,209,102,.1)">${escapeHtml(hint)}</div>` : ''}
      <div class="nanaly-note">
        Key 会用你设的密码<strong>加密后</strong>再存进这台浏览器，
        不会进代码仓库，也不会出现在别人看到的网页源码里。
        浏览器扩展或共用这台电脑的人读到的只是密文。
      </div>
      <label>DeepSeek API Key</label>
      <input type="password" data-f="apiKey" placeholder="sk-..." autocomplete="off">
      <label>Tavily API Key（联网搜索，可留空）</label>
      <input type="password" data-f="tavilyKey" placeholder="tvly-..." autocomplete="off">
      <label>解锁密码（每次重开浏览器输一次）</label>
      <input type="password" data-f="pass" placeholder="自己设一个" autocomplete="new-password">
      <div class="nanaly-note" style="margin-top:12px">
        这个密码<strong>没有找回途径</strong>。忘了就点「忘记密码」清空，重填一次 key 即可。
      </div>
      <details class="nanaly-setup__advanced">
        <summary>高级设置（换别家接口时才需要动）</summary>
        <label>接口地址</label>
        <input type="text" data-f="baseURL">
        <label>模型名</label>
        <input type="text" data-f="model">
      </details>
      <div class="nanaly-setup__actions">
        <button data-a="cancel">取消</button>
        <button class="primary" data-a="save">保存并解锁</button>
      </div>`)

    box.querySelector('[data-f="baseURL"]').value = saved.baseURL
    box.querySelector('[data-f="model"]').value = saved.model
    box.querySelector('[data-f="apiKey"]').value = secrets.apiKey || ''
    box.querySelector('[data-f="tavilyKey"]').value = secrets.tavilyKey || ''

    box.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')
      if (!a) return
      if (a.dataset.a === 'cancel') return backToChat()

      const get = f => box.querySelector(`[data-f="${f}"]`).value.trim()
      const pass = get('pass')
      if (!get('apiKey')) return addSetupError(box, '至少要填 DeepSeek 的 API Key')
      if (pass.length < 4) return addSetupError(box, '解锁密码太短了，至少 4 位')
      if (!hasCrypto()) return addSetupError(box, '这个环境不支持加密（需要 HTTPS 或 localhost）')

      cfg = { baseURL: get('baseURL') || DEFAULTS.baseURL, model: get('model') || DEFAULTS.model }
      writeCfg(cfg)
      secrets = { apiKey: get('apiKey'), tavilyKey: get('tavilyKey') }
      try {
        await sealSecrets(secrets, pass)
        writeSession(secrets)
        backToChat()
        addMsg('sys', '已加密保存并解锁')
      } catch (err) {
        addSetupError(box, '加密失败：' + (err && err.message || err))
      }
    })
  }

  const addSetupError = (box, text) => {
    let tip = box.querySelector('[data-role="err"]')
    if (!tip) {
      tip = el('div', 'nanaly-note')
      tip.dataset.role = 'err'
      tip.style.cssText = 'border-left-color:#ff6b6b;background:rgba(255,107,107,.12);margin-top:12px'
      box.querySelector('.nanaly-setup__actions').before(tip)
    }
    tip.textContent = text
  }

  // 已有保险箱但未解锁
  const showUnlock = () => {
    const box = setupShell(`
      <h4>[歪着头] 密码喵？</h4>
      <div class="nanaly-note">
        你的 API Key 是加密存着的。输一次密码解锁，
        本次浏览器会话内就不用再输了。
      </div>
      <label>解锁密码</label>
      <input type="password" data-f="pass" placeholder="……" autocomplete="current-password">
      <div class="nanaly-setup__actions">
        <button data-a="forget">忘记密码</button>
        <button class="primary" data-a="unlock">解锁</button>
      </div>`)

    const pw = box.querySelector('[data-f="pass"]')
    setTimeout(() => pw.focus(), 120)

    const tryUnlock = async () => {
      const pass = pw.value.trim()
      if (!pass) return
      try {
        const got = await openSecrets(pass)
        if (!got || !got.apiKey) throw new Error('bad')
        secrets = got
        writeSession(secrets)
        backToChat()
        addMsg('sys', '解锁成功')
      } catch (_) {
        addSetupError(box, '密码不对喵。再试一次？')
        pw.value = ''
        pw.focus()
      }
    }

    pw.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock() })
    box.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')
      if (!a) return
      if (a.dataset.a === 'unlock') tryUnlock()
      if (a.dataset.a === 'forget') {
        localStorage.removeItem(LS_VAULT)
        clearSession()
        secrets = { ...EMPTY_SECRETS }
        showSetup('已清空。重新填一次 key 和密码吧。')
      }
    })
  }

  // 入口：没保险箱 → 首次设置；有但没解锁 → 解锁；否则 → 设置
  const showKeyUI = hint => {
    if (!hasVault()) return showSetup(hint)
    if (locked()) return showUnlock()
    return showSetup(hint)
  }

  // ---------------- 调用模型 ----------------

  const buildMessages = async (userText, mode) => {
    const msgs = [{ role: 'system', content: PERSONA }]
    const art = currentArticle()

    if (mode === 'web') {
      const hits = await searchWeb(userText.replace(/^上网搜[：:]\s*/, ''))
      if (hits.length) {
        msgs.push({
          role: 'system',
          content: '以下是刚从互联网上搜到的资料（时效性以搜索结果为准）。'
            + '回答时依据它们，并在末尾列出用到的来源标题与链接。'
            + '若资料自相矛盾或都没答到点上，如实说明。\n\n'
            + hits.map(h => `【${h.title}】${h.url}\n${h.excerpt}`).join('\n\n---\n\n')
        })
      } else {
        msgs.push({ role: 'system', content: '互联网搜索没有返回结果，请如实告诉对方没搜到。' })
      }
    } else if (mode === 'site') {
      const hits = await searchCorpus(userText)
      if (hits.length) {
        msgs.push({
          role: 'system',
          content: '以下是这个博客里与问题最相关的文章片段，回答时优先依据它们，'
            + '并在末尾用「相关文章：标题」的形式指出来源。若片段里没有答案，就直说没写过。\n\n'
            + hits.map(h => `【${h.title}】\n${h.excerpt}`).join('\n\n---\n\n')
        })
      } else {
        msgs.push({ role: 'system', content: '博客里没有检索到相关内容。请如实告诉对方这个话题他还没写过，'
          + '并提示可以用「上网搜：」开头让你去互联网上找。' })
      }
    } else if (art) {
      const clipped = art.text.length > 12000
        ? art.text.slice(0, 12000) + '\n\n（正文过长，以上为前半部分）'
        : art.text
      msgs.push({
        role: 'system',
        content: `对方正在读这篇文章，回答请紧扣它的内容：\n\n【${art.title}】\n${clipped}`
      })
    }

    history.slice(-8).forEach(m => msgs.push(m))
    msgs.push({ role: 'user', content: userText })
    return msgs
  }

  const stream = async (messages, onDelta) => {
    abortCtl = new AbortController()
    const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secrets.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, messages, stream: true, temperature: 0.8 }),
      signal: abortCtl.signal
    })

    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json()).error?.message || '' } catch (_) {}
      throw new Error(`接口返回 ${res.status}${detail ? '：' + detail : ''}`)
    }

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content
          if (delta) { full += delta; onDelta(full) }
        } catch (_) {}
      }
    }
    return full
  }

  const send = async (text, mode) => {
    if (busy) return
    text = String(text || '').trim()
    if (!text) return

    if (!secrets.apiKey) {
      showKeyUI(hasVault() ? undefined : '还没有填 API Key —— 填上之后我们才能说上话。')
      return
    }

    busy = true
    sendBtn.disabled = true
    input.value = ''
    input.style.height = ''
    addMsg('me', text)

    const bubble = addMsg('her',
      mode === 'web'
        ? '[轻敲指甲，优雅地打开搜索框] 等窝去互联网草丛里把答案叼回来喵…… <span class="nanaly-typing"><i></i><i></i><i></i></span>'
        : '<span class="nanaly-typing"><i></i><i></i><i></i></span>',
      { raw: true })

    try {
      const messages = await buildMessages(text, mode)
      const full = await stream(messages, partial => {
        bubble.innerHTML = mdToHtml(partial)
        scrollBottom()
      })
      if (!full) bubble.innerHTML = mdToHtml('……我好像没说出话来，再试一次？')
      history.push({ role: 'user', content: text }, { role: 'assistant', content: full })
      history = history.slice(-30)
      writeLog(history)
    } catch (err) {
      const msg = String(err && err.message || err)
      bubble.className = 'nanaly-msg nanaly-msg--sys'
      bubble.innerHTML = escapeHtml(
        msg === 'NO_TAVILY'
          ? '还没填 Tavily 的 API Key，联网搜索用不了。去设置里填一个吧。'
          : /Failed to fetch|NetworkError|CORS/i.test(msg)
            ? '连不上接口。可能是网络问题，也可能是这家服务商不允许浏览器直接调用（CORS）。'
            : msg
      )
    } finally {
      busy = false
      sendBtn.disabled = false
      scrollBottom()
    }
  }

  // ---------------- 事件 ----------------

  const openPanel = () => {
    panel.classList.add('is-open')
    launcher.classList.remove('has-news')
    if (locked()) showUnlock()
    else if (!body.children.length) renderHistory()
    setTimeout(() => input.focus(), 220)
  }
  const closePanel = () => {
    panel.classList.remove('is-open')
    if (abortCtl) { try { abortCtl.abort() } catch (_) {} }
  }

  launcher.addEventListener('click', () => {
    panel.classList.contains('is-open') ? closePanel() : openPanel()
  })

  panel.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    if (act === 'close') closePanel()
    if (act === 'lock') {
      clearSession()
      secrets = { ...EMPTY_SECRETS }
      hasVault() ? showUnlock() : showSetup()
    }
    if (act === 'setup') showKeyUI()
    if (act === 'clear') {
      history = []
      writeLog(history)
      quick.style.display = ''
      renderHistory()
    }
  })

  quick.addEventListener('click', e => {
    const btn = e.target.closest('[data-q]')
    if (!btn) return
    const q = btn.dataset.q
    if (q === 'summary') send('用几条要点总结一下这篇文章，重点讲清楚它到底解决了什么问题。', 'article')
    if (q === 'ask') send('这篇文章讲了什么？挑最关键的两三点说说。', 'article')
    if (q === 'site') { input.value = '全站搜一下：'; input.focus() }
    if (q === 'web') { input.value = '上网搜：'; input.focus() }
  })

  const modeOf = t => /^上网搜[：:]?/.test(t) ? 'web'
    : /^全站搜一下[：:]?/.test(t) ? 'site'
      : 'article'

  const submit = () => { const t = input.value.trim(); send(t, modeOf(t)) }

  sendBtn.addEventListener('click', submit)

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  })

  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 116) + 'px'
  })

  // 页面切换时更新副标题为当前文章（pjax 不会重新执行本脚本）
  const refreshContext = () => {
    const art = currentArticle()
    subLine.textContent = art ? `正在读：${art.title}` : 'Noimpty 的学习搭子'
    const onPost = !!art
    quick.querySelectorAll('[data-q="summary"], [data-q="ask"]').forEach(b => {
      b.style.display = onPost ? '' : 'none'
    })
  }
  refreshContext()
  window.addEventListener('pjax:complete', () => setTimeout(refreshContext, 60))

  // 供控制台调试/换人设用
  window.NANALY = Object.freeze({
    open: openPanel,
    close: closePanel,
    reset: () => { history = []; writeLog(history); renderHistory() },
    lock: () => { clearSession(); secrets = { ...EMPTY_SECRETS }; showUnlock() },
    forgetKey: () => {
      localStorage.removeItem(LS_VAULT)
      clearSession()
      secrets = { ...EMPTY_SECRETS }
      addMsg('sys', 'API Key 已从本机彻底清除')
    }
  })
})()
